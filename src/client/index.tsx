import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  absoluteRepositoryParent, ATLAS_BUNDLES, canUninstallAtlas, ENTRY_ID, linkAtlas, localAtlasSpec, PACKAGE,
  setAtlasEnabled, uninstallAtlas,
  type Atlas, type Notice, type Progress, type RepositorySettings,
} from '../lib/atlas.js'
import { LABELS } from './labels.js'
import { ATLAS_ICONS } from './published-icons.js'
import { CSS } from './styles.js'

const NS = 'dsh-atlas-atlas'
const SLOT = 'plugins.bundle.config'
const ATLASES = Object.keys(ATLAS_BUNDLES) as Atlas[]
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager', 'configForms']

type ClientContext = Pick<Context, 'effect' | 'on'> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
  configForms: Context['configForms']
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
  const repositoryForm = ctx.configForms.get<RepositorySettings>(ENTRY_ID)
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
        if (action === undefined || action.notice.kind === 'restart' || action.notice.kind === 'rollbackFailed' ||
          action.notice.kind === 'localLinkFailed' || action.notice.kind === 'enableFailed' ||
          action.notice.kind === 'uninstallFailed' || action.notice.kind === 'uninstallUnavailable') continue
        const bundle = inventory.find(item => item.name === ATLAS_BUNDLES[atlas])
        const selected = bundle?.enabled === true
        if (selected === action.enabled && (!selected || (bundle.availability !== 'missing' && bundle.error === undefined))) {
          delete notices[atlas]
        }
      }
    }
    update({ inventory, notices })
  }

  async function toggle(atlas: Atlas, enabled: boolean, needsInstall: boolean, localParent?: string): Promise<void> {
    if (snapshot.activity !== undefined || disposed) return
    const progress = (stage: Progress) => update({ activity: { atlas, stage } })
    progress(enabled ? needsInstall ? 'installing' : 'enabling' : 'disabling')
    update({ notices: { ...snapshot.notices, [atlas]: undefined } })
    const notice = await setAtlasEnabled(manager, atlas, enabled, progress, localParent)
    update({ notices: { ...snapshot.notices, [atlas]: notice && { enabled, notice } } })
    await refresh()
    update({ activity: undefined })
  }

  async function uninstall(atlas: Atlas): Promise<void> {
    if (snapshot.activity !== undefined || disposed) return
    update({ activity: { atlas, stage: 'uninstalling' }, notices: { ...snapshot.notices, [atlas]: undefined } })
    const notice = await uninstallAtlas(manager, atlas)
    update({ notices: { ...snapshot.notices, [atlas]: notice && { enabled: false, notice } } })
    await refresh()
    update({ activity: undefined })
  }

  const t = ctx.locale.bind(NS)
  const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener)
  const localeSnapshot = () => ctx.locale.getSnapshot()

  function NoticeLine({ notice }: { notice: Notice }) {
    const { kind } = notice
    const error = kind.endsWith('Failed') || kind === 'bundleMissing' || kind === 'conflict' || kind === 'uninstallUnavailable'
    const message = notice.kind === 'conflict' ? t('conflict', { bundle: notice.bundle, row: notice.row }) : t(kind)
    return <p className="dsh-atlas-manager-status" data-atlas-status={kind} data-error={error ? '' : undefined}>{message}</p>
  }

  function AtlasPanel({ useRemoteAccess }: PanelProps) {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const canToggle = useRemoteAccess('pluginManager/setBundleEnabled')
    const canInstall = useRemoteAccess('pluginManager/installBundle')
    const canInspect = useRemoteAccess('pluginManager/inspect')
    const canRemove = useRemoteAccess('pluginManager/removeBundle')
    const settings = useSyncExternalStore(repositoryForm.subscribe, repositoryForm.getSnapshot)
    const [draft, setDraft] = useState<string>()
    const [uninstallTarget, setUninstallTarget] = useState<Atlas>()
    const uninstallDialog = useRef<HTMLDialogElement>(null)
    const cancelUninstall = useRef<HTMLButtonElement>(null)
    const memberStatus = useRef<Partial<Record<Atlas, HTMLDivElement | null>>>({})
    const [saving, setSaving] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)
    const { inventory, activity, notices } = useSyncExternalStore(subscribe, () => snapshot)
    useSyncExternalStore(subscribeLocale, localeSnapshot)
    const listId = useId()

    useEffect(() => {
      if (!canList) return
      observing = true
      void refresh()
      return () => { observing = false }
    }, [canList])

    useEffect(() => {
      const dialog = uninstallDialog.current
      if (uninstallTarget === undefined || !dialog || dialog.open) return
      dialog.showModal()
      cancelUninstall.current?.focus()
    }, [uninstallTarget])

    if (!canList) return <p className="dsh-atlas-manager-status">{t('readDenied')}</p>
    if (inventory === undefined) return <p className="dsh-atlas-manager-status" role="status">{t('loading')}</p>
    if (inventory === 'failed') return (
      <div>
        <div role="status">
          <p className="dsh-atlas-manager-status" data-error="">{t('inventoryFailed')}</p>
          {ATLASES.map(atlas => {
            const notice = notices[atlas]?.notice
            if (notice?.kind !== 'uninstallFailed' && notice?.kind !== 'uninstallUnavailable') return null
            return <div key={atlas}>
              <div className="dsh-atlas-manager-label">{t(atlas)}</div>
              <NoticeLine notice={notice} />
              {'detail' in notice && notice.detail && <code className="dsh-atlas-manager-status">{notice.detail}</code>}
            </div>
          })}
        </div>
        <button type="button" className="dsh-atlas-manager-retry" onClick={() => { void refresh() }}>{t('retry')}</button>
      </div>
    )

    const local = settings.value?.useLocalRepositories === true
    const path = draft ?? settings.value?.localRepositoryParent ?? ''
    const parent = absoluteRepositoryParent(path)
    const showPath = local || draft !== undefined
    const busy = saving || activity !== undefined
    const canEdit = settings.status === 'ready' && settings.writable
    const needsRemoval = ATLASES.some(atlas => inventory.some(bundle =>
      bundle.name === ATLAS_BUNDLES[atlas] && bundle.installed &&
      (bundle.availability === 'missing' || bundle.source !== localAtlasSpec(path, atlas))))
    const canLink = canInstall && canInspect && canToggle && (!needsRemoval || canRemove)
    const pathId = `${listId}-repository-parent`

    async function saveRepositoryMode(next: boolean) {
      if (busy || !canEdit || (next && (parent === undefined || !canLink))) return
      setSaving(true)
      setSaveFailed(false)
      try {
        const saved = await repositoryForm.mutate([
          { op: 'set', path: ['useLocalRepositories'], value: next },
          ...next && parent !== undefined ? [{ op: 'set' as const, path: ['localRepositoryParent'], value: parent }] : [],
        ], settings.revision)
        if (!saved) { setSaveFailed(true); return }
        setDraft(undefined)
        if (!next || parent === undefined) return
        const current = await manager.listBundles()
        if (!current.ok) { setSaveFailed(true); return }
        for (const atlas of ATLASES) {
          const bundle = current.value.find(item => item.name === ATLAS_BUNDLES[atlas])
          const previous = snapshot.notices[atlas]
          const retry = previous?.notice.kind === 'localLinkFailed'
          if ((!bundle?.installed && !retry) ||
            (bundle?.source === localAtlasSpec(parent, atlas) && bundle?.availability === 'profile' && !retry)) continue
          const enabled = retry ? previous.enabled : bundle?.enabled === true
          const progress = (stage: Progress) => update({ activity: { atlas, stage } })
          progress('installing')
          const notice = enabled
            ? await setAtlasEnabled(manager, atlas, true, progress, parent)
            : await linkAtlas(manager, atlas, parent, bundle)
          update({ notices: { ...snapshot.notices, [atlas]: notice && { enabled, notice } } })
        }
        await refresh()
      } catch {
        setSaveFailed(true)
      } finally {
        update({ activity: undefined })
        setSaving(false)
      }
    }

    return (
      <div data-atlas-manager="">
        <section className="dsh-atlas-manager-repositories" aria-busy={saving}>
          <div className="dsh-atlas-manager-repository-row">
            <span className="dsh-atlas-manager-label" id={`${pathId}-mode`}>{t('useLocalRepositories')}</span>
            <button type="button" role="switch" className="dsh-atlas-manager-switch"
              aria-labelledby={`${pathId}-mode`} aria-checked={showPath} aria-disabled={!canEdit || busy}
              aria-describedby={showPath ? `${pathId}-mode-help` : undefined}
              disabled={!canEdit || busy} onClick={() => {
                setSaveFailed(false)
                if (local) void saveRepositoryMode(false)
                else setDraft(showPath ? undefined : path)
              }}>
              <span className="dsh-atlas-manager-thumb" />
            </button>
          </div>
          {showPath && <div className="dsh-atlas-manager-path">
            <label htmlFor={pathId}>{t('localRepositoryParent')}</label>
            <div className="dsh-atlas-manager-path-controls">
              <input type="text" id={pathId} value={path} placeholder="/path/to/plugins" spellCheck={false}
                autoComplete="off" aria-describedby={`${pathId}-help`}
                aria-invalid={path !== '' && parent === undefined} disabled={!canEdit || busy}
                onChange={event => { setDraft(event.currentTarget.value); setSaveFailed(false) }}
                onKeyDown={event => { if (event.key === 'Enter') void saveRepositoryMode(true) }} />
              <button type="button" className="dsh-atlas-manager-retry" disabled={!canEdit || !canLink || busy || parent === undefined}
                onClick={() => { void saveRepositoryMode(true) }}>{t('saveAndLink')}</button>
            </div>
            <p id={`${pathId}-help`} className="dsh-atlas-manager-status" data-error={path !== '' && parent === undefined ? '' : undefined}>
              {t(path !== '' && parent === undefined ? 'invalidRepositoryParent' : 'localRepositoryHelp')}
            </p>
            <p id={`${pathId}-mode-help`} className="dsh-atlas-manager-status">{t('localRepositoryImpact')}</p>
            {canEdit && !canLink && <p className="dsh-atlas-manager-status">{t('writeDenied')}</p>}
          </div>}
          {settings.status !== 'loading' && !canEdit && <p className="dsh-atlas-manager-status">{t('writeDenied')}</p>}
          {saveFailed && <p className="dsh-atlas-manager-status" data-error="" role="alert">{t('repositoryApplyFailed')}</p>}
        </section>
        <h4 className="dsh-atlas-manager-heading" id={listId}>{t('atlasBundles')}</h4>
        <ul className="dsh-atlas-manager-list" aria-labelledby={listId}>
          {ATLASES.map(atlas => {
            const bundle = inventory.find(item => item.name === ATLAS_BUNDLES[atlas])
            const enabled = bundle?.enabled ?? false
            const localParent = local ? settings.value?.localRepositoryParent : undefined
            const notInstalled = bundle === undefined || (bundle.availability === 'missing' && !bundle.installed)
            const needsInstall = notInstalled ||
              (local && (bundle.availability === 'missing' || bundle.source !== localAtlasSpec(localParent ?? '', atlas)))
            const denied = !canToggle || bundle?.readOnlyReason !== undefined || (!enabled && needsInstall &&
              (!canInstall || settings.status !== 'ready' || (local && (!canInspect || (bundle?.installed && !canRemove)))))
            const showUninstall = canRemove && canUninstallAtlas(bundle)
            const stage = activity?.atlas === atlas ? activity.stage : undefined
            const notice = stage === undefined ? notices[atlas]?.notice : undefined
            const detail = stage === undefined ? notice && 'detail' in notice ? notice.detail : bundle?.error?.diagnostic : undefined
            const status = stage ?? (bundle?.error !== undefined ? 'bundleError'
              : enabled ? 'enabled' : notInstalled ? 'notInstalled' : 'disabled')
            const statusId = `${listId}-${atlas}`
            return (
              <li key={atlas} className="dsh-atlas-manager-row" data-atlas={atlas}>
                {/* Artwork sizing follows PackageArtwork in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5, src/client/PluginManagerPage.tsx. */}
                <span className="dsh-atlas-manager-icon" aria-hidden="true">
                  <img src={ATLAS_ICONS[atlas]} width={30} height={30} alt="" />
                </span>
                <div className="dsh-atlas-manager-copy">
                  <div className="dsh-atlas-manager-label">{t(atlas)}</div>
                  <div id={statusId} role="status" tabIndex={-1} ref={node => { memberStatus.current[atlas] = node }}>
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
                  {showUninstall && <button type="button" className="dsh-atlas-manager-trash"
                    aria-haspopup="dialog" aria-label={t('uninstallLabel', { name: t(atlas) })} title={t('uninstall')}
                    disabled={busy || draft !== undefined} onClick={() => setUninstallTarget(atlas)}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.5 4.5h11M6 4.5V2.75h4V4.5M4 4.5l.55 8.15c.04.52.47.85 1 .85h4.9c.53 0 .96-.33 1-.85L12 4.5M6.75 7v4M9.25 7v4" />
                    </svg>
                  </button>}
                  <button type="button" role="switch" className="dsh-atlas-manager-switch"
                    aria-label={t(atlas)} aria-checked={enabled} aria-describedby={statusId}
                    aria-busy={stage !== undefined} aria-disabled={busy || draft !== undefined || denied}
                    disabled={denied}
                    onClick={() => {
                      if (!busy && draft === undefined && !denied) void toggle(atlas, !enabled, needsInstall, localParent)
                    }}>
                    <span className="dsh-atlas-manager-thumb" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <dialog ref={uninstallDialog} className="dsh-atlas-manager-uninstall-dialog"
          aria-labelledby={`${listId}-uninstall-title`} aria-describedby={`${listId}-uninstall-description`}
          onClose={() => setUninstallTarget(undefined)}>
          <h4 id={`${listId}-uninstall-title`}>{uninstallTarget && t('uninstallLabel', { name: t(uninstallTarget) })}</h4>
          <p id={`${listId}-uninstall-description`}>{t('uninstallConfirm')}</p>
          <div>
            <button type="button" ref={cancelUninstall} className="dsh-atlas-manager-retry"
              onClick={() => uninstallDialog.current?.close()}>{t('cancelUninstall')}</button>
            <button type="button" className="dsh-atlas-manager-retry dsh-atlas-manager-danger"
              disabled={!canRemove || busy || uninstallTarget === undefined} onClick={() => {
                if (uninstallTarget === undefined || !canRemove || busy) return
                uninstallDialog.current?.close()
                memberStatus.current[uninstallTarget]?.focus()
                void uninstall(uninstallTarget)
              }}>{t('uninstall')}</button>
          </div>
        </dialog>
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
