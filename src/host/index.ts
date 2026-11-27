import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-settings'
// Bundled from @deepseek-ai/schemastery 3.19.0, src/index.ts (object, boolean, string).
import Schema from '@deepseek-ai/schemastery'
import { LocalDevService } from '../lib/local-dev-service.js'
import { LOCAL_DEV_ROUTE, LocalDevError, parseLocalDevRequest } from '../lib/local-dev-types.js'

// @deepseek-ai/dsh-app-boot@0.2.2-rc.5 exposes ctx.profileContext.dir on Host profiles.
declare module '@deepseek-ai/cordis' {
  interface Context {
    profileContext: {
      readonly dir: string
    }
  }
}

export const Config = Schema.object({
  localDevEnabled: Schema.boolean().default(false).volatile(),
  localWorkspaceDir: Schema.string().default('').volatile(),
})

type Configuration = ReturnType<typeof Config>

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

export function apply(ctx: Context, config: Configuration): void {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })

  ctx.inject(['connection', 'pluginManager', 'profileContext'], scope => {
    const profileDir = scope.profileContext.dir
    const service = new LocalDevService({
      manager: scope.pluginManager,
      profileDir,
      isEnabled: () => config.localDevEnabled.get(),
      getWorkspaceDir: () => config.localWorkspaceDir.get(),
    })

    scope.effect(() => scope.connection.fetch.register({
      path: LOCAL_DEV_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const admitted = scope.connection.admit(request)
        if ('rejection' in admitted || admitted.peer !== scope.connection.browserPeer) {
          return reply({ ok: false, error: 'forbidden' }, 'rejection' in admitted ? admitted.rejection : 403)
        }
        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          return reply({ ok: false, error: 'invalid-request' }, 415)
        }
        const body = await request.text()
        if (Buffer.byteLength(body) > 8192) {
          return reply({ ok: false, error: 'invalid-request' }, 413)
        }
        try {
          let raw: unknown
          try {
            raw = JSON.parse(body)
          } catch {
            throw new LocalDevError('invalid-request', 'Invalid JSON body')
          }
          const parsed = parseLocalDevRequest(raw)
          const value = await service.handle(parsed)
          return reply({ ok: true, value })
        } catch (error) {
          if (error instanceof LocalDevError) {
            const status = error.code === 'invalid-request' ? 400
              : error.code === 'forbidden' ? 403
              : 409
            return reply({ ok: false, error: error.code, detail: error.detail }, status)
          }
          return reply({
            ok: false,
            error: 'switch-failed',
            detail: error instanceof Error ? error.message : String(error),
          }, 500)
        }
      },
    }), `${LOCAL_DEV_ROUTE}: browser operation`)
  })
}
