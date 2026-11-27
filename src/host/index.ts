import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { AGGREGATES_ROUTE } from '../lib/atlas.js'
import { discoverInstalledAggregates } from '../lib/discover-aggregates.js'

// @deepseek-ai/dsh-app-boot@0.2.2-rc.5 exposes ctx.profileContext.dir on Host profiles.
declare module '@deepseek-ai/cordis' {
  interface Context {
    profileContext: {
      readonly dir: string
    }
  }
}

const reply = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

export function apply(ctx: Context): void {
  ctx.inject(['connection', 'pluginManager', 'profileContext'], scope => {
    const profileDir = scope.profileContext.dir
    scope.effect(() => scope.connection.fetch.register({
      path: AGGREGATES_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        const admitted = scope.connection.admit(request)
        if ('rejection' in admitted || admitted.peer !== scope.connection.browserPeer) {
          return reply({ ok: false, error: 'forbidden' }, 'rejection' in admitted ? admitted.rejection : 403)
        }
        try {
          const aggregates = await discoverInstalledAggregates(scope.pluginManager, profileDir)
          return reply({ ok: true, value: aggregates })
        } catch (error) {
          return reply({
            ok: false,
            error: 'discovery-failed',
            detail: error instanceof Error ? error.message : String(error),
          }, 500)
        }
      },
    }), `${AGGREGATES_ROUTE}: browser read`)
  })
}
