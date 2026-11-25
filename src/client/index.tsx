import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginConfigViewProps, PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  Button,
  IconChevronRightOutlineRegular,
  IconChevronsUpDownOutlineMedium,
  IconRightUpOutlineRegular,
  IconTrashOutlineRegular,
  Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  renderDynamicFactorySlot,
  useAggregateSettingsMap,
} from './aggregate-settings.js'
import {
  ATLAS_BUNDLES,
  canUninstallAtlas,
  ENTRY_ID,
  normalizeWorkspaceDir,
  PACKAGE,
  setAtlasEnabled,
  uninstallAtlas,
  type Atlas,
  type Notice,
  type Progress,
} from '../lib/atlas.js'
import type {
  BundleLocalDevStatus,
  LocalDevConfig,
  LocalDevErrorCode,
  LocalDevOverview,
  LocalDevRequest,
} from '../lib/local-dev-types.js'
import { LABELS, localDevErrorKey, type AtlasLabelKey } from './labels.js'
import { fetchLocalDevOverview, requestLocalDev } from './local-dev-api.js'
import { LocalDevBadge, LocalDevDetailSection } from './local-dev-detail.js'
import { ATLAS_ICONS } from './published-icons.js'
import { CSS } from './styles.js'

const NS = 'dsh-atlas-atlas'
const CONFIG_SLOT = 'plugins.bundle.config'
const DETAIL_BADGE_SLOT = 'plugins.detail.badge'
const DETAIL_SECTION_SLOT = 'plugins.detail.section'
const ATLASES = Object.keys(ATLAS_BUNDLES) as Atlas[]
const OFFICIAL_ATLAS_SET = new Set<string>(Object.values(ATLAS_BUNDLES))
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager', 'configForms']

type ClientContext = Pick<Context, 'effect' | 'on'> & Partial<Pick<Context, 'get'>> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
  configForms: Context['configForms']
}
type PanelProps = PluginConfigViewProps
  & Pick<PropsRuntime<typeof CONFIG_SLOT>, 'useRemoteAccess'>
  & Partial<PropsRenderFactories>
type DetailBadgeSlotProps = PluginDetailProps
type DetailSectionSlotProps = PluginDetailProps & Pick<PropsRuntime<typeof DETAIL_SECTION_SLOT>, 'useRemoteAccess'>
type Inventory = readonly BundleInfo[] | 'failed' | undefined
interface Snapshot {
  readonly inventory: Inventory
  readonly activity?: { atlas: Atlas; stage: Progress }
  readonly notices: Partial<Record<Atlas, { enabled: boolean; notice: Notice }>>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-atlas-atlas': AtlasLabelKey
  }
}

function isAbsoluteDirInput(path: string): boolean {
  return normalizeWorkspaceDir(path) !== undefined
}

export function apply(ctx: ClientContext): void {
  const manager = ctx.remote.pluginManager
  const localDevForm = ctx.configForms.get<LocalDevConfig>(ENTRY_ID)
  const subscribeForm = (listener: () => void) => localDevForm.subscribe(listener)
  const formSnapshot = () => localDevForm.getSnapshot()
  const listeners = new Set<() => void>()
  const localDevListeners = new Set<() => void>()
  let snapshot: Snapshot = { inventory: undefined, notices: {} }
  let refreshId = 0
  let observing = false
  let disposed = false

  function emitLocalDevUpdate(): void {
    for (const listener of localDevListeners) listener()
  }

  function subscribeLocalDevUpdate(listener: () => void): () => void {
    localDevListeners.add(listener)
    return () => { localDevListeners.delete(listener) }
  }

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
        if (action === undefined || action.notice.kind === 'restart' || action.notice.kind === 'rollbackFailed'
          || action.notice.kind === 'enableFailed'
          || action.notice.kind === 'uninstallFailed' || action.notice.kind === 'uninstallUnavailable') continue
        const bundle = inventory.find(item => item.name === ATLAS_BUNDLES[atlas])
        const selected = bundle?.enabled === true
        if (selected === action.enabled && (!selected || (bundle.availability !== 'missing' && bundle.error === undefined))) {
          delete notices[atlas]
        }
      }
    }
    update({ inventory, notices })
    emitLocalDevUpdate()
  }

  async function toggle(atlas: Atlas, enabled: boolean): Promise<void> {
    if (snapshot.activity !== undefined || disposed) return
    const progress = (stage: Progress) => update({ activity: { atlas, stage } })
    progress(enabled ? 'enabling' : 'disabling')
    update({ notices: { ...snapshot.notices, [atlas]: undefined } })
    const cfg = localDevForm.getSnapshot().value
    const notice = await setAtlasEnabled(manager, atlas, enabled, progress, {
      localDevEnabled: cfg?.localDevEnabled === true,
      localWorkspaceDir: cfg?.localWorkspaceDir,
    })
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
  const getPluginNavigation = () => (typeof ctx.get === 'function' ? ctx.get('pluginNavigation') : undefined)

  function NoticeLine({ notice }: { notice: Notice }) {
    const { kind } = notice
    const error = kind.endsWith('Failed') || kind === 'bundleMissing' || kind === 'localWorkspaceRequired'
      || kind === 'conflict' || kind === 'continuityConflict' || kind === 'uninstallUnavailable'
    const message = notice.kind === 'conflict'
      ? t('conflict', { bundle: notice.bundle, row: notice.row })
      : t(kind)
    return <p className="dsh-atlas-manager-status" data-atlas-status={kind} data-error={error ? '' : undefined}>{message}</p>
  }

  function LocalDevControls({
    status,
    busy,
    canSwitch,
    onAction,
  }: {
    status: BundleLocalDevStatus
    busy: boolean
    canSwitch: boolean
    onAction: (request: LocalDevRequest) => void
  }) {
    if (!status.installed) return null
    return (
      <div className="dsh-atlas-local-actions">
        {status.drifted ? (
          <button
            type="button"
            className="dsh-atlas-local-btn"
            disabled={busy || !canSwitch}
            onClick={() => onAction({ action: 'reset-drift', packageName: status.packageName })}
          >
            {t('resetDrift')}
          </button>
        ) : (
          <>
            {status.selfMode === 'baseline' ? (
              <button
                type="button"
                className="dsh-atlas-local-btn"
                disabled={busy || !canSwitch || !status.canSwitchSelfToLocal}
                onClick={() => onAction({ action: 'set-self-mode', packageName: status.packageName, mode: 'local' })}
              >
                {t('switchToLocal')}
              </button>
            ) : (
              <button
                type="button"
                className="dsh-atlas-local-btn"
                disabled={busy || !canSwitch || !status.canRestoreSelf}
                onClick={() => onAction({ action: 'set-self-mode', packageName: status.packageName, mode: 'baseline' })}
              >
                {t('restoreBaseline')}
              </button>
            )}
            {status.isAggregate && (status.membersMode === 'bundled' ? (
              <button
                type="button"
                className="dsh-atlas-local-btn"
                disabled={busy || !canSwitch || !status.canSwitchMembersToLocal}
                onClick={() => onAction({ action: 'set-members-mode', packageName: status.packageName, mode: 'local' })}
              >
                {t('switchMembersToLocal')}
              </button>
            ) : (
              <button
                type="button"
                className="dsh-atlas-local-btn"
                disabled={busy || !canSwitch || !status.canRestoreMembers}
                onClick={() => onAction({ action: 'set-members-mode', packageName: status.packageName, mode: 'bundled' })}
              >
                {t('restoreMembersBundled')}
              </button>
            ))}
          </>
        )}
      </div>
    )
  }

  function BundleRowIcon({
    src,
    size,
    className,
    onPress,
  }: {
    src: string
    size: number
    className?: string
    onPress?: () => void
  }) {
    const img = <img src={src} width={size} height={size} alt="" />
    const iconClass = className ? `dsh-atlas-manager-icon ${className}` : 'dsh-atlas-manager-icon'
    if (!onPress) {
      return <span className={iconClass} aria-hidden="true">{img}</span>
    }
    return (
      <button
        type="button"
        className={`${iconClass} dsh-atlas-manager-icon-btn`}
        tabIndex={-1}
        aria-hidden="true"
        onClick={onPress}
      >
        {img}
      </button>
    )
  }

  function ChevronArrow({ className }: { className: string }) {
    return <IconChevronRightOutlineRegular size={12} className={className} aria-hidden />
  }

  function CollapseAllIcon() {
    // Inward chevron mirror of IconChevronsUpDownOutlineMedium in @deepseek-ai/dsh-client-ui-primitives@0.2.2-rc.5.
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5.1 3.5 2.9 2.9 2.9-2.9" />
        <path d="m5.1 12.5 2.9-2.9 2.9 2.9" />
      </svg>
    )
  }

  function ExpandAllIcon({ expanded }: { expanded: boolean }) {
    return expanded ? <CollapseAllIcon /> : <IconChevronsUpDownOutlineMedium size={14} aria-hidden />
  }

  function OpenDetailsIcon() {
    return <IconRightUpOutlineRegular size={12} aria-hidden />
  }

  function AtlasPanel({ useRemoteAccess, renderFactorySlot }: PanelProps) {
    const canList = useRemoteAccess('pluginManager/listBundles')
    const canToggle = useRemoteAccess('pluginManager/setBundleEnabled')
    const canToggleMembers = useRemoteAccess('pluginManager/setPluginEnabled')
    const canInstall = useRemoteAccess('pluginManager/installBundle')
    const canInspect = useRemoteAccess('pluginManager/inspect')
    const canRemove = useRemoteAccess('pluginManager/removeBundle')
    const settings = useSyncExternalStore(subscribeForm, formSnapshot, formSnapshot)
    const [draft, setDraft] = useState<string>()
    const [uninstallTarget, setUninstallTarget] = useState<Atlas>()
    const uninstallDialog = useRef<HTMLDialogElement>(null)
    const cancelUninstall = useRef<HTMLButtonElement>(null)
    const memberStatus = useRef<Partial<Record<Atlas, HTMLDivElement | null>>>({})
    const [saving, setSaving] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)
    const [overview, setOverview] = useState<LocalDevOverview>()
    const [localDevBusy, setLocalDevBusy] = useState(false)
    const [localDevError, setLocalDevError] = useState<{ packageName: string; code: LocalDevErrorCode; detail?: string }>()
    const [expandedBundles, setExpandedBundles] = useState<Readonly<Record<string, true>>>({})
    const [expandCommand, setExpandCommand] = useState<{ readonly action: 'expand' | 'collapse'; readonly seq: number }>()
    const { inventory, activity, notices } = useSyncExternalStore(subscribe, () => snapshot)
    useSyncExternalStore(subscribeLocale, localeSnapshot)
    const listId = useId()

    const localDevEnabled = settings.value?.localDevEnabled === true
    const workspaceDir = draft ?? settings.value?.localWorkspaceDir ?? ''
    const discoveredAggregates = (overview?.aggregateBundles ?? []).filter(item => !OFFICIAL_ATLAS_SET.has(item.packageName))
    const trackedPackages = [
      ...Object.values(ATLAS_BUNDLES),
      ...discoveredAggregates.map(item => item.packageName),
    ]
    const settingsByPackage = useAggregateSettingsMap(ctx.slots, trackedPackages)
    const canNavigate = typeof getPluginNavigation()?.openBundle === 'function'

    useEffect(() => {
      if (!canList) return
      observing = true
      void refresh()
      return () => { observing = false }
    }, [canList])

    useEffect(() => {
      if (!canList) return
      let cancelled = false
      const loadOverview = async () => {
        const res = await fetchLocalDevOverview()
        if (!cancelled && res.ok) setOverview(res.value)
      }
      void loadOverview()
      const off = subscribeLocalDevUpdate(() => { void loadOverview() })
      return () => {
        cancelled = true
        off()
      }
    }, [canList, localDevEnabled, settings.value?.localWorkspaceDir])

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

    const busy = saving || localDevBusy || activity !== undefined
    const canEdit = settings.status === 'ready' && settings.writable
    const canSwitchLocal = canInstall && canRemove
    const savedWorkspaceDir = normalizeWorkspaceDir(settings.value?.localWorkspaceDir)
    const pathValid = workspaceDir.trim() === '' || isAbsoluteDirInput(workspaceDir)
    const pathDirty = settings.status === 'ready' && workspaceDir.trim() !== (settings.value?.localWorkspaceDir ?? '')
    const pathId = `${listId}-workspace-dir`

    async function toggleLocalDev(next: boolean) {
      if (busy || !canEdit) return
      setSaving(true)
      setSaveFailed(false)
      try {
        const saved = await localDevForm.mutate([
          { op: 'set', path: ['localDevEnabled'], value: next },
        ], settings.revision)
        if (!saved) {
          setSaveFailed(true)
          return
        }
        emitLocalDevUpdate()
      } catch {
        setSaveFailed(true)
      } finally {
        setSaving(false)
      }
    }

    async function saveWorkspaceDir() {
      const trimmed = workspaceDir.trim()
      if (busy || !canEdit || (trimmed !== '' && !isAbsoluteDirInput(trimmed))) return
      setSaving(true)
      setSaveFailed(false)
      try {
        const saved = await localDevForm.mutate([
          { op: 'set', path: ['localWorkspaceDir'], value: trimmed },
        ], settings.revision)
        if (!saved) {
          setSaveFailed(true)
          return
        }
        setDraft(undefined)
        emitLocalDevUpdate()
      } catch {
        setSaveFailed(true)
      } finally {
        setSaving(false)
      }
    }

    async function runLocalDevAction(request: LocalDevRequest) {
      if (busy || !canSwitchLocal) return
      setLocalDevBusy(true)
      setLocalDevError(undefined)
      try {
        const res = await requestLocalDev<BundleLocalDevStatus>(request)
        if (!res.ok) {
          const pkgName = 'packageName' in request ? request.packageName : PACKAGE
          setLocalDevError({ packageName: pkgName, code: res.error, detail: res.detail })
        }
        await refresh()
      } finally {
        setLocalDevBusy(false)
      }
    }

    const statusByPackage = new Map((overview?.aggregateBundles ?? []).map(item => [item.packageName, item]))
    const openBundle = (packageName: string) => { getPluginNavigation()?.openBundle(packageName) }
    const expandablePackages = typeof renderFactorySlot === 'function'
      ? [
        ...ATLASES.map(atlas => {
          const packageName = ATLAS_BUNDLES[atlas]
          const bundle = inventory.find(item => item.name === packageName)
          return bundle?.enabled === true && settingsByPackage.has(packageName) ? packageName : undefined
        }),
        ...discoveredAggregates.map(item =>
          item.enabled && settingsByPackage.has(item.packageName) ? item.packageName : undefined,
        ),
      ].filter((pkg): pkg is string => pkg !== undefined)
      : []
    const allExpanded = expandablePackages.length > 0 && expandablePackages.every(pkg => Boolean(expandedBundles[pkg]))

    const toggleExpanded = (packageName: string) => {
      setExpandCommand(undefined)
      setExpandedBundles(prev => {
        const next = { ...prev }
        if (next[packageName]) delete next[packageName]
        else next[packageName] = true
        return next
      })
    }

    const toggleExpandAll = () => {
      if (expandablePackages.length === 0) return
      const nextAction = allExpanded ? 'collapse' : 'expand'
      setExpandCommand(prev => ({ action: nextAction, seq: (prev?.seq ?? 0) + 1 }))
      if (nextAction === 'collapse') {
        setExpandedBundles({})
        return
      }
      const nextExpanded: Record<string, true> = {}
      for (const pkg of expandablePackages) nextExpanded[pkg] = true
      setExpandedBundles(nextExpanded)
    }

    const countBundleMembers = (bundle: BundleInfo | undefined, fallbackCount?: number): number | undefined => {
      if (bundle !== undefined) {
        const count = bundle.rows.filter(
          row => row.moduleName !== bundle.name && !row.moduleName.startsWith(`${bundle.name}/`),
        ).length
        if (count > 0) return count
      }
      return fallbackCount
    }

    const renderBundleHeading = (
      packageName: string,
      displayName: string,
      canExpand: boolean,
      isExpanded: boolean,
      memberCount: number | undefined,
      settingsBodyId: string,
      canOpenBundle: boolean,
    ) => (
      <>
        {canExpand ? (
          <button
            type="button"
            className="dsh-atlas-settings-toggle"
            data-atlas-settings-toggle={packageName}
            aria-expanded={isExpanded}
            aria-controls={settingsBodyId}
            onClick={() => toggleExpanded(packageName)}
          >
            <ChevronArrow className="dsh-atlas-chevron" />
            <span>{displayName}</span>
            {typeof memberCount === 'number' && <span className="dsh-atlas-section-count">{memberCount}</span>}
          </button>
        ) : (
          <span>{displayName}</span>
        )}
        {canOpenBundle && (
          <Tooltip label={t('openBundleDetails', { name: displayName })} side="top" portal delayMs={200}>
            <Button
              variant="ghost"
              size="sm"
              className="dsh-atlas-detail-open"
              data-atlas-open={packageName}
              aria-label={t('openBundleDetails', { name: displayName })}
              icon={<OpenDetailsIcon />}
              onClick={() => openBundle(packageName)}
            />
          </Tooltip>
        )}
      </>
    )

    return (
      <div data-atlas-manager="">
        <section className="dsh-atlas-manager-repositories" aria-busy={saving || localDevBusy}>
          <div className="dsh-atlas-manager-repository-row">
            <span className="dsh-atlas-manager-label" id={`${pathId}-mode`}>{t('localDevToggle')}</span>
            <Switch
              checked={localDevEnabled}
              label={t('localDevToggle')}
              disabled={!canEdit || busy}
              onChange={next => { void toggleLocalDev(next) }}
            />
          </div>
          <p id={`${pathId}-mode-help`} className="dsh-atlas-manager-status">{t('localDevHelp')}</p>
          {localDevEnabled && (
            <div className="dsh-atlas-manager-path">
              <label htmlFor={pathId}>{t('localWorkspaceDir')}</label>
              <div className="dsh-atlas-manager-path-controls">
                <input
                  type="text"
                  id={pathId}
                  value={workspaceDir}
                  placeholder="/path/to/plugins"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={`${pathId}-help`}
                  aria-invalid={!pathValid}
                  disabled={!canEdit || busy}
                  onChange={event => { setDraft(event.currentTarget.value); setSaveFailed(false) }}
                  onKeyDown={event => { if (event.key === 'Enter') void saveWorkspaceDir() }}
                />
                <button
                  type="button"
                  className="dsh-atlas-manager-retry"
                  disabled={!canEdit || busy || !pathValid || !pathDirty}
                  onClick={() => { void saveWorkspaceDir() }}
                >
                  {t('saveWorkspaceDir')}
                </button>
              </div>
              <p id={`${pathId}-help`} className="dsh-atlas-manager-status" data-error={!pathValid || overview?.workspaceDirIssue ? '' : undefined}>
                {!pathValid
                  ? t('invalidWorkspaceDir')
                  : overview?.workspaceDirIssue ?? t('localWorkspaceDirHelp')}
              </p>
            </div>
          )}
          {settings.status !== 'loading' && !canEdit && <p className="dsh-atlas-manager-status">{t('writeDenied')}</p>}
          {saveFailed && <p className="dsh-atlas-manager-status" data-error="" role="alert">{t('localDevApplyFailed')}</p>}
        </section>

        <div className="dsh-atlas-manager-heading-row">
          <h4 className="dsh-atlas-manager-heading" id={listId}>{t('atlasBundles')}</h4>
          {expandablePackages.length > 0 && (
            <Tooltip label={t(allExpanded ? 'collapseAll' : 'expandAll')} side="right" portal delayMs={300} focusDelayMs={300}>
              <Button
                variant="ghost"
                size="sm"
                className="dsh-atlas-expand-all"
                data-atlas-expand-all=""
                aria-label={t(allExpanded ? 'collapseAll' : 'expandAll')}
                icon={<ExpandAllIcon expanded={allExpanded} />}
                onClick={toggleExpandAll}
              />
            </Tooltip>
          )}
        </div>
        <ul className="dsh-atlas-manager-list" data-atlas-panel="bundles" aria-labelledby={listId}>
          {ATLASES.map(atlas => {
            const packageName = ATLAS_BUNDLES[atlas]
            const bundle = inventory.find(item => item.name === packageName)
            const localStatus = statusByPackage.get(packageName)
            const enabled = bundle?.enabled ?? false
            const notInstalled = bundle === undefined || (bundle.availability === 'missing' && !bundle.installed)
            const localWorkspaceRequired = notInstalled && localDevEnabled && savedWorkspaceDir === undefined
            const denied = !canToggle || bundle?.readOnlyReason !== undefined
              || (!enabled && notInstalled && (!canInstall || (localDevEnabled && !canInspect)))
            const showUninstall = canRemove && canUninstallAtlas(bundle)
            const stage = activity?.atlas === atlas ? activity.stage : undefined
            const notice = stage === undefined ? notices[atlas]?.notice : undefined
            const detail = stage === undefined ? notice && 'detail' in notice ? notice.detail : bundle?.error?.diagnostic : undefined
            const status = stage ?? (bundle?.error !== undefined ? 'bundleError'
              : enabled ? 'enabled' : notInstalled ? 'notInstalled' : 'disabled')
            const statusId = `${listId}-${atlas}`
            const rowError = localDevError?.packageName === packageName ? localDevError : undefined
            const canOpenBundle = !notInstalled && canNavigate
            const settingsEntry = enabled && typeof renderFactorySlot === 'function'
              ? settingsByPackage.get(packageName)
              : undefined
            const canExpand = settingsEntry !== undefined
            const isExpanded = canExpand && Boolean(expandedBundles[packageName])
            const settingsBodyId = `${statusId}-settings`
            const memberCount = countBundleMembers(bundle, settingsEntry?.count)
            const onIconPress = canExpand ? () => toggleExpanded(packageName) : undefined
            const routineStatus = status === 'enabled' || status === 'disabled'
            return (
              <li
                key={atlas}
                className="dsh-atlas-manager-row"
                data-atlas={atlas}
                data-atlas-state={enabled ? 'on' : 'off'}
              >
                <div className="dsh-atlas-manager-row-main">
                  {/* Artwork sizing follows PackageArtwork in @deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.5, src/client/PluginManagerPage.tsx. */}
                  <BundleRowIcon
                    src={ATLAS_ICONS[atlas]}
                    size={24}
                    onPress={onIconPress}
                  />
                  <div className="dsh-atlas-manager-copy">
                    <div className="dsh-atlas-manager-label">
                      {renderBundleHeading(
                        packageName,
                        t(atlas),
                        canExpand,
                        isExpanded,
                        memberCount,
                        settingsBodyId,
                        canOpenBundle,
                      )}
                      {localDevEnabled && localStatus && (localStatus.selfMode === 'local' || localStatus.membersMode === 'local') && (
                        <span className="dsh-atlas-manager-tags">
                          {localStatus.selfMode === 'local' && <span className="dsh-atlas-local-tag">{t('localPackageTag')}</span>}
                          {localStatus.membersMode === 'local' && <span className="dsh-atlas-local-tag">{t('localMembersTag')}</span>}
                        </span>
                      )}
                    </div>
                    <div id={statusId} role="status" tabIndex={-1} ref={node => { memberStatus.current[atlas] = node }}>
                      <p
                        className={routineStatus ? 'dsh-atlas-sr-only' : 'dsh-atlas-manager-status'}
                        data-atlas-status={status}
                        data-error={status === 'bundleError' ? '' : undefined}
                      >
                        {t(status)}
                      </p>
                      {denied && <p className="dsh-atlas-manager-status">{t('writeDenied')}</p>}
                      {localWorkspaceRequired && <p className="dsh-atlas-manager-status">{t('localWorkspaceRequired')}</p>}
                      {notice && <NoticeLine notice={notice} />}
                    </div>
                    {localDevEnabled && localStatus && (
                      <LocalDevControls
                        status={localStatus}
                        busy={busy}
                        canSwitch={canSwitchLocal}
                        onAction={req => { void runLocalDevAction(req) }}
                      />
                    )}
                    {rowError && (
                      <p className="dsh-atlas-manager-status" data-error="" role="alert">
                        {t(localDevErrorKey(rowError.code))}
                        {rowError.detail ? ` (${rowError.detail})` : ''}
                      </p>
                    )}
                    {detail && <details className="dsh-atlas-manager-status dsh-atlas-manager-detail">
                      <summary>{t('details')}</summary>
                      <code>{detail}</code>
                    </details>}
                  </div>
                  <div className="dsh-atlas-manager-control">
                    {stage && <span className="dsh-atlas-manager-spinner" aria-hidden="true" />}
                    {showUninstall && (
                      <Tooltip label={t('uninstall')} side="top" portal delayMs={200}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="dsh-atlas-manager-trash"
                          aria-haspopup="dialog"
                          aria-label={t('uninstallLabel', { name: t(atlas) })}
                          disabled={busy}
                          icon={<IconTrashOutlineRegular size={14} />}
                          onClick={() => setUninstallTarget(atlas)}
                        />
                      </Tooltip>
                    )}
                    <Switch
                      checked={enabled}
                      label={t(atlas)}
                      disabled={busy || denied || localWorkspaceRequired}
                      onChange={next => {
                        if (!busy && !denied && !localWorkspaceRequired) {
                          void toggle(atlas, next)
                        }
                      }}
                    />
                  </div>
                </div>
                {isExpanded && (
                  <div id={settingsBodyId} className="dsh-atlas-settings-body" data-atlas-settings-body={packageName}>
                    {renderDynamicFactorySlot(renderFactorySlot!, settingsEntry.factoryName, {
                      view: 'page',
                      canToggle: canToggleMembers,
                      ...(expandCommand !== undefined ? { expandCommand } : {}),
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {discoveredAggregates.length > 0 && (
          <>
            <h5 className="dsh-atlas-manager-subheading">{t('otherAggregates')}</h5>
            <ul className="dsh-atlas-manager-list" data-discovered-aggregates="">
              {discoveredAggregates.map((item, index) => {
                const rowError = localDevError?.packageName === item.packageName ? localDevError : undefined
                const canOpenBundle = item.installed && canNavigate
                const settingsEntry = item.enabled && typeof renderFactorySlot === 'function'
                  ? settingsByPackage.get(item.packageName)
                  : undefined
                const canExpand = settingsEntry !== undefined
                const isExpanded = canExpand && Boolean(expandedBundles[item.packageName])
                const settingsBodyId = `${listId}-discovered-${index}-settings`
                const memberCount = item.members.length > 0 ? item.members.length : settingsEntry?.count
                const onIconPress = canExpand ? () => toggleExpanded(item.packageName) : undefined
                return (
                  <li
                    key={item.packageName}
                    className="dsh-atlas-manager-row"
                    data-atlas-state={item.enabled ? 'on' : 'off'}
                  >
                    <div className="dsh-atlas-manager-row-main">
                      <BundleRowIcon
                        src={ATLAS_ICONS.plugin}
                        size={24}
                        onPress={onIconPress}
                      />
                      <div className="dsh-atlas-manager-copy">
                        <div className="dsh-atlas-manager-label">
                          {renderBundleHeading(
                            item.packageName,
                            item.packageName,
                            canExpand,
                            isExpanded,
                            memberCount,
                            settingsBodyId,
                            canOpenBundle,
                          )}
                          {localDevEnabled && (item.selfMode === 'local' || item.membersMode === 'local') && (
                            <span className="dsh-atlas-manager-tags">
                              {item.selfMode === 'local' && <span className="dsh-atlas-local-tag">{t('localPackageTag')}</span>}
                              {item.membersMode === 'local' && <span className="dsh-atlas-local-tag">{t('localMembersTag')}</span>}
                            </span>
                          )}
                        </div>
                        <p className="dsh-atlas-manager-status">
                          {t(item.enabled ? 'enabled' : 'disabled')} · {item.members.length}
                        </p>
                        {localDevEnabled && (
                          <LocalDevControls
                            status={item}
                            busy={busy}
                            canSwitch={canSwitchLocal}
                            onAction={req => { void runLocalDevAction(req) }}
                          />
                        )}
                        {rowError && (
                          <p className="dsh-atlas-manager-status" data-error="" role="alert">
                            {t(localDevErrorKey(rowError.code))}
                            {rowError.detail ? ` (${rowError.detail})` : ''}
                          </p>
                        )}
                      </div>
                      <div className="dsh-atlas-manager-control" />
                    </div>
                    {isExpanded && (
                      <div id={settingsBodyId} className="dsh-atlas-settings-body" data-atlas-settings-body={item.packageName}>
                        {renderDynamicFactorySlot(renderFactorySlot!, settingsEntry.factoryName, {
                          view: 'page',
                          canToggle: canToggleMembers,
                          ...(expandCommand !== undefined ? { expandCommand } : {}),
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}

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
    const refreshIfObserved = () => {
      if (observing) void refresh()
      else emitLocalDevUpdate()
    }
    const changed = ctx.remote.$on('plugin-manager/changed', refreshIfObserved)
    const reset = ctx.on('connection/reset', refreshIfObserved)
    const panel = ctx.slots.inject(CONFIG_SLOT, () => ctx.slots.register({ name: CONFIG_SLOT, key: PACKAGE }, (props: PanelProps) => (
      <>
        <style>{CSS}</style>
        <AtlasPanel {...props} />
      </>
    )))
    const detailBadge = ctx.slots.inject(DETAIL_BADGE_SLOT, () => ctx.slots.register({
      name: DETAIL_BADGE_SLOT,
      id: PACKAGE,
      locale: NS,
    }, ({ subject, t: slotT }: DetailBadgeSlotProps & { t: AtlasPanelLocale }) => (
      <LocalDevBadge
        subject={subject}
        form={localDevForm}
        t={slotT}
        subscribeUpdates={subscribeLocalDevUpdate}
      />
    )))
    const detailSection = ctx.slots.inject(DETAIL_SECTION_SLOT, () => ctx.slots.register({
      name: DETAIL_SECTION_SLOT,
      id: PACKAGE,
      locale: NS,
    }, ({ subject, t: slotT, useRemoteAccess }: DetailSectionSlotProps & { t: AtlasPanelLocale }) => {
      const canInstall = useRemoteAccess('pluginManager/installBundle')
      const canRemove = useRemoteAccess('pluginManager/removeBundle')
      return (
        <LocalDevDetailSection
          subject={subject}
          form={localDevForm}
          t={slotT}
          canSwitch={canInstall && canRemove}
          subscribeUpdates={subscribeLocalDevUpdate}
          notifyUpdate={() => {
            emitLocalDevUpdate()
            if (observing) void refresh()
          }}
        />
      )
    }))
    return () => {
      disposed = true
      detailSection()
      detailBadge()
      panel()
      reset()
      changed()
    }
  }, `${NS}: detail panel`)
}

type AtlasPanelLocale = PropsLocale<typeof NS>['t']
