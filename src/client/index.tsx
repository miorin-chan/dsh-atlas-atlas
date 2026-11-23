import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { useEffect, useId, useSyncExternalStore } from 'react'
import { ATLAS_BUNDLES, PACKAGE, setAtlasEnabled, type Atlas, type Notice, type Progress } from '../lib/atlas.js'
import { LABELS } from './labels.js'
import { ATLAS_ICONS } from './published-icons.js'
import { CSS } from './styles.js'

const NS = 'dsh-atlas-atlas'
const SLOT = 'plugins.bundle.config'
const ATLASES = Object.keys(ATLAS_BUNDLES) as Atlas[]
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager']

type ClientContext = Pick<Context, 'effect' | 'on'> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
}
type PanelProps = PluginConfigViewProps & Pick<PropsRuntime<typeof SLOT>, 'useRemoteAccess'>
type Inventory = readonly BundleInfo[] | 'failed' | undefined
interface Snapshot {
  readonly inventory: Inventory
  readonly activity?: { atlas: Atlas; stage: Progress }
  readonly notices: Partial<Record<Atlas, { enabled: boolean; notice: Notice }>>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-atlas-atlas': keyof typeof LABELS.en
  }
}

export function apply(ctx: ClientContext): void {
  const manager = ctx.remote.pluginManager
  const listeners = new Set<() => void>()
  let snapshot: Snapshot = { inventory: undefined, notices: {} }
  let refreshId = 0
  let observing = false
  let disposed = false

  function update(change: Partial<Snapshot>): void {
    if (disposed) return
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  async function refresh(): Promise<void> {
    const id = ++refreshId
    let inventory: Inventory = 'failed'
    try {
      const result = await manager.listBundles()
      if (result.ok) inventory = result.value
    } catch {
      // A failed or disconnected read is retried on request or reconnection.
    }
    if (id !== refreshId) return
    const notices = { ...snapshot.notices }
    if (inventory !== 'failed') {
      for (const atlas of ATLASES) {
        const action = notices[atlas]
        if (action === undefined || action.notice.kind === 'restart' || action.notice.kind === 'rollbackFailed') continue
        const bundle = inventory.find(item => item.name === ATLAS_BUNDLES[atlas])
        const selected = bundle?.enabled === true
        if (selected === action.enabled && (!selected || (bundle.availability !== 'missing' && bundle.error === undefined))) {
          delete notices[atlas]
        }
      }
    }
    update({ inventory, notices })
  }

  async function toggle(atlas: Atlas, enabled: boolean, needsInstall: boolean): Promise<void> {
    if (snapshot.activity !== undefined || disposed) return
    const progress = (stage: Progress) => update({ activity: { atlas, stage } })
    progress(enabled ? needsInstall ? 'installing' : 'enabling' : 'disabling')
    update({ notices: { ...snapshot.notices, [atlas]: undefined } })
    const notice = await setAtlasEnabled(manager, atlas, enabled, progress)
    update({ notices: { ...snapshot.notices, [atlas]: notice && { enabled, notice } } })
    await refresh()
    update({ activity: undefined })
  }

  const t = ctx.locale.bind(NS)
  const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener)
  const localeSnapshot = () => ctx.locale.getSnapshot()

  function NoticeLine({ notice }: { notice: Notice }) {
    const { kind } = notice
    const error = kind.endsWith('Failed') || kind === 'bundleMissing' || kind === 'conflict'
    const message = notice.kind === 'conflict' ? t('conflict', { bundle: notice.bundle, row: notice.row }) : t(kind)
    return <p className="dsh-atlas-manager-status" data-atlas-status={kind} data-error={error ? '' : undefined}>{message}</p>
  }

  function AtlasPanel({ useRemoteAccess }: PanelProps) {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const canToggle = useRemoteAccess('pluginManager/setBundleEnabled')
    const canInstall = useRemoteAccess('pluginManager/installBundle')
    const { inventory, activity, notices } = useSyncExternalStore(subscribe, () => snapshot)
    useSyncExternalStore(subscribeLocale, localeSnapshot)
    const listId = useId()

    useEffect(() => {
      if (!canList) return
      observing = true
      void refresh()
      return () => { observing = false }
    }, [canList])

    if (!canList) return <p className="dsh-atlas-manager-status">{t('readDenied')}</p>
    if (inventory === undefined) return <p className="dsh-atlas-manager-status" role="status">{t('loading')}</p>
    if (inventory === 'failed') return (
      <div>
        <p className="dsh-atlas-manager-status" data-error="" role="status">{t('inventoryFailed')}</p>
        <button type="button" className="dsh-atlas-manager-retry" onClick={() => { void refresh() }}>{t('retry')}</button>
      </div>
    )

    return (
      <div data-atlas-manager="">
        <h4 className="dsh-atlas-manager-heading" id={listId}>{t('atlasBundles')}</h4>
        <ul className="dsh-atlas-manager-list" aria-labelledby={listId}>
          {ATLASES.map(atlas => {
            const bundle = inventory.find(item => item.name === ATLAS_BUNDLES[atlas])
            const enabled = bundle?.enabled ?? false
            const needsInstall = bundle === undefined || (bundle.availability === 'missing' && !bundle.installed)
            const denied = !canToggle || bundle?.readOnlyReason !== undefined || (!enabled && needsInstall && !canInstall)
            const stage = activity?.atlas === atlas ? activity.stage : undefined
            const notice = stage === undefined ? notices[atlas]?.notice : undefined
            const detail = stage === undefined ? notice && 'detail' in notice ? notice.detail : bundle?.error?.diagnostic : undefined
            const status = stage ?? (bundle?.error !== undefined ? 'bundleError'
              : enabled ? 'enabled' : needsInstall && !bundle?.installed ? 'notInstalled' : 'disabled')
            const statusId = `${listId}-${atlas}`
            return (
              <li key={atlas} className="dsh-atlas-manager-row" data-atlas={atlas}>
                {/* Artwork sizing follows PackageArtwork in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5, src/client/PluginManagerPage.tsx. */}
                <span className="dsh-atlas-manager-icon" aria-hidden="true">
                  <img src={ATLAS_ICONS[atlas]} width={30} height={30} alt="" />
                </span>
                <div className="dsh-atlas-manager-copy">
                  <div className="dsh-atlas-manager-label">{t(atlas)}</div>
                  <div id={statusId} role="status">
                    <p className="dsh-atlas-manager-status" data-atlas-status={status}
                      data-error={status === 'bundleError' ? '' : undefined}>{t(status)}</p>
                    {denied && <p className="dsh-atlas-manager-status">{t('writeDenied')}</p>}
                    {notice && <NoticeLine notice={notice} />}
                  </div>
                  {detail && <details className="dsh-atlas-manager-status dsh-atlas-manager-detail">
                    <summary>{t('details')}</summary>
                    <code>{detail}</code>
                  </details>}
                </div>
                <div className="dsh-atlas-manager-control">
                  {stage && <span className="dsh-atlas-manager-spinner" aria-hidden="true" />}
                  <button type="button" role="switch" className="dsh-atlas-manager-switch"
                    aria-label={t(atlas)} aria-checked={enabled} aria-describedby={statusId}
                    aria-busy={stage !== undefined} aria-disabled={activity !== undefined || denied}
                    disabled={denied}
                    onClick={() => { if (!denied) void toggle(atlas, !enabled, needsInstall) }}>
                    <span className="dsh-atlas-manager-thumb" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  ctx.effect(() => ctx.locale.register(NS, LABELS), `${NS}: locale`)
  ctx.effect(() => {
    const refreshIfObserved = () => { if (observing) void refresh() }
    const changed = ctx.remote.$on('plugin-manager/changed', refreshIfObserved)
    const reset = ctx.on('connection/reset', refreshIfObserved)
    const panel = ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, key: PACKAGE }, (props: PanelProps) => (
      <>
        <style>{CSS}</style>
        <AtlasPanel {...props} />
      </>
    )))
    return () => {
      disposed = true
      panel()
      reset()
      changed()
    }
  }, `${NS}: detail panel`)
}
