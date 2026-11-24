import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
// Bundled from @deepseek-ai/schemastery 3.19.0, src/index.ts (object, boolean, string).
import Schema from '@deepseek-ai/schemastery'

export const Config = Schema.object({
  useLocalRepositories: Schema.boolean().default(false).volatile(),
  localRepositoryParent: Schema.string().default('').volatile(),
})

export function apply(ctx: Context): void {
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
}
