import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { BundleInfo, ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  Button,
  IconChevronRightOutlineRegular,
  IconChevronsUpDownOutlineMedium,
  IconRightUpOutlineRegular,
  IconTrashOutlineRegular,
  Modal,
  StateDot,
  Switch,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  renderDynamicFactorySlot,
  useAggregateSettingsMap,
} from './aggregate-settings.js'
import {
  AGGREGATES_ROUTE,
  ATLAS_BUNDLES,
  canUninstallAtlas,
  PACKAGE,
  setAtlasEnabled,
  uninstallAtlas,
  type Atlas,
  type DiscoveredAggregate,
  type Notice,
  type Progress,
} from '../lib/atlas.js'
import { LABELS, type AtlasLabelKey } from './labels.js'
import { ATLAS_ICONS } from './published-icons.js'
import { CSS } from './styles.js'

const NS = 'dsh-atlas-atlas'
const CONFIG_SLOT = 'plugins.bundle.config'
const ATLASES = Object.keys(ATLAS_BUNDLES) as Atlas[]
const OFFICIAL_ATLAS_SET = new Set<string>(Object.values(ATLAS_BUNDLES))
export const inject = ['locale', 'slots', 'remote', 'remote.pluginManager']

type ClientContext = Pick<Context, 'effect' | 'on'> & Partial<Pick<Context, 'get'>> & {
  locale: LocaleRuntime
  slots: SlotRegistry
  remote: ClientRemote
}
type PanelProps = PluginConfigViewProps
  & Pick<PropsRuntime<typeof CONFIG_SLOT>, 'useRemoteAccess'>
  & Partial<PropsRenderFactories>
type Inventory = readonly BundleInfo[] | 'failed' | undefined
interface Snapshot {
  readonly inventory: Inventory
  readonly discovered: readonly DiscoveredAggregate[]
  readonly activity?: { atlas: Atlas; stage: Progress }
  readonly notices: Partial<Record<Atlas, { enabled: boolean; notice: Notice }>>
}

type TransportFetch = (input: string, init?: RequestInit) => Promise<Response>

function resolveFetch(): TransportFetch | undefined {
  const hostWindow = globalThis as { __DSH_TRANSPORT__?: { fetch?: TransportFetch }; fetch?: TransportFetch }
  if (typeof hostWindow.__DSH_TRANSPORT__?.fetch === 'function') return hostWindow.__DSH_TRANSPORT__.fetch
  if (typeof hostWindow.fetch === 'function') return hostWindow.fetch.bind(globalThis)
  return undefined
}

async function fetchDiscoveredAggregates(signal?: AbortSignal): Promise<readonly DiscoveredAggregate[]> {
  const fetchImpl = resolveFetch()
  if (fetchImpl === undefined) return []
  try {
    const response = await fetchImpl(AGGREGATES_ROUTE, {
      method: 'GET',
      ...(signal !== undefined ? { signal } : {}),
    })
    const payload = await response.json() as { ok?: boolean; value?: unknown }
    if (!payload?.ok || !Array.isArray(payload.value)) return []
    return payload.value.filter(
      (item): item is DiscoveredAggregate => item !== null
        && typeof item === 'object'
        && typeof (item as DiscoveredAggregate).packageName === 'string'
        && typeof (item as DiscoveredAggregate).memberCount === 'number',
    )
  } catch {
    return []
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-atlas-atlas': AtlasLabelKey
  }
}

export function apply(ctx: ClientContext): void {
  const manager = ctx.remote.pluginManager
  const listeners = new Set<() => void>()
  let snapshot: Snapshot = { inventory: undefined, discovered: [], notices: {} }
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
    let discovered: readonly DiscoveredAggregate[] = []
    try {
      const [bundleResult, discoveredList] = await Promise.all([
        manager.listBundles(),
        fetchDiscoveredAggregates(),
      ])
      if (bundleResult.ok) inventory = bundleResult.value
      discovered = discoveredList
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
    update({ inventory, discovered, notices })
  }

  async function toggle(atlas: Atlas, enabled: boolean): Promise<void> {
    if (snapshot.activity !== undefined || disposed) return
    const progress = (stage: Progress) => update({ activity: { atlas, stage } })
    progress(enabled ? 'enabling' : 'disabling')
    update({ notices: { ...snapshot.notices, [atlas]: undefined } })
    const notice = await setAtlasEnabled(manager, atlas, enabled, progress)
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
    const error = kind.endsWith('Failed') || kind === 'bundleMissing'
      || kind === 'conflict' || kind === 'continuityConflict' || kind === 'uninstallUnavailable'
    const message = notice.kind === 'conflict'
      ? t('conflict', { bundle: notice.bundle, row: notice.row })
      : t(kind)
    return <p className="dsh-atlas-manager-status" data-atlas-status={kind} data-error={error ? '' : undefined}>{message}</p>
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
    const canRemove = useRemoteAccess('pluginManager/removeBundle')
    const [uninstallTarget, setUninstallTarget] = useState<Atlas>()
    const memberStatus = useRef<Partial<Record<Atlas, HTMLDivElement | null>>>({})
    const [expandedBundles, setExpandedBundles] = useState<Readonly<Record<string, true>>>({})
    const [expandCommand, setExpandCommand] = useState<{ readonly action: 'expand' | 'collapse'; readonly seq: number }>()
    const { inventory, discovered, activity, notices } = useSyncExternalStore(subscribe, () => snapshot)
    useSyncExternalStore(subscribeLocale, localeSnapshot)
    const listId = useId()

    const otherAggregates = discovered.filter(item => !OFFICIAL_ATLAS_SET.has(item.packageName))
    const trackedPackages = [
      ...Object.values(ATLAS_BUNDLES),
      ...otherAggregates.map(item => item.packageName),
    ]
    const settingsByPackage = useAggregateSettingsMap(ctx.slots, trackedPackages)
    const canNavigate = typeof getPluginNavigation()?.openBundle === 'function'

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
        <Button variant="outline" size="sm" className="dsh-atlas-manager-retry" onClick={() => { void refresh() }}>{t('retry')}</Button>
      </div>
    )

    const busy = activity !== undefined
    const discoveredRows = otherAggregates
      .map(item => ({
        discovered: item,
        bundle: inventory.find(bundle => bundle.name === item.packageName),
      }))
      .filter((entry): entry is { discovered: DiscoveredAggregate; bundle: BundleInfo } =>
        entry.bundle !== undefined && entry.bundle.installed)

    const openBundle = (packageName: string) => { getPluginNavigation()?.openBundle(packageName) }
    const expandablePackages = typeof renderFactorySlot === 'function'
      ? [
        ...ATLASES.map(atlas => {
          const packageName = ATLAS_BUNDLES[atlas]
          const bundle = inventory.find(item => item.name === packageName)
          return bundle?.enabled === true && settingsByPackage.has(packageName) ? packageName : undefined
        }),
        ...discoveredRows.map(item =>
          item.bundle.enabled && settingsByPackage.has(item.bundle.name) ? item.bundle.name : undefined,
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
            const enabled = bundle?.enabled ?? false
            const notInstalled = bundle === undefined || (bundle.availability === 'missing' && !bundle.installed)
            const denied = !canToggle || bundle?.readOnlyReason !== undefined || (!enabled && notInstalled && !canInstall)
            const showUninstall = canRemove && canUninstallAtlas(bundle)
            const stage = activity?.atlas === atlas ? activity.stage : undefined
            const notice = stage === undefined ? notices[atlas]?.notice : undefined
            const detail = stage === undefined ? notice && 'detail' in notice ? notice.detail : bundle?.error?.diagnostic : undefined
            const status = stage ?? (bundle?.error !== undefined ? 'bundleError'
              : enabled ? 'enabled' : notInstalled ? 'notInstalled' : 'disabled')
            const statusId = `${listId}-${atlas}`
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
                      {notice && <NoticeLine notice={notice} />}
                    </div>
                    {detail && <details className="dsh-atlas-manager-status dsh-atlas-manager-detail">
                      <summary>{t('details')}</summary>
                      <code>{detail}</code>
                    </details>}
                  </div>
                  <div className="dsh-atlas-manager-control">
                    {stage && <StateDot state="ongoing" size={14} className="dsh-atlas-manager-spinner" />}
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
                      disabled={busy || denied}
                      onChange={next => {
                        if (!busy && !denied) {
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

        {discoveredRows.length > 0 && (
          <>
            <h5 className="dsh-atlas-manager-subheading">{t('otherAggregates')}</h5>
            <ul className="dsh-atlas-manager-list" data-discovered-aggregates="">
              {discoveredRows.map(({ discovered: item, bundle }, index) => {
                const displayName = bundle.meta?.title ? ctx.locale.resolveText(bundle.meta.title) : bundle.name
                const canOpenBundle = bundle.installed && canNavigate
                const settingsEntry = bundle.enabled && typeof renderFactorySlot === 'function'
                  ? settingsByPackage.get(bundle.name)
                  : undefined
                const canExpand = settingsEntry !== undefined
                const isExpanded = canExpand && Boolean(expandedBundles[bundle.name])
                const settingsBodyId = `${listId}-discovered-${index}-settings`
                const memberCount = countBundleMembers(bundle, item.memberCount)
                const onIconPress = canExpand ? () => toggleExpanded(bundle.name) : undefined
                return (
                  <li
                    key={bundle.name}
                    className="dsh-atlas-manager-row"
                    data-atlas-state={bundle.enabled ? 'on' : 'off'}
                  >
                    <div className="dsh-atlas-manager-row-main">
                      <BundleRowIcon
                        src={bundle.meta?.icon || ATLAS_ICONS.plugin}
                        size={24}
                        onPress={onIconPress}
                      />
                      <div className="dsh-atlas-manager-copy">
                        <div className="dsh-atlas-manager-label">
                          {renderBundleHeading(
                            bundle.name,
                            displayName,
                            canExpand,
                            isExpanded,
                            memberCount,
                            settingsBodyId,
                            canOpenBundle,
                          )}
                        </div>
                        <p className="dsh-atlas-manager-status">
                          {t(bundle.enabled ? 'enabled' : 'disabled')} · {memberCount ?? item.memberCount}
                        </p>
                      </div>
                      <div className="dsh-atlas-manager-control" />
                    </div>
                    {isExpanded && (
                      <div id={settingsBodyId} className="dsh-atlas-settings-body" data-atlas-settings-body={bundle.name}>
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

        <Modal
          open={uninstallTarget !== undefined}
          onClose={() => setUninstallTarget(undefined)}
          title={uninstallTarget ? t('uninstallLabel', { name: t(uninstallTarget) }) : ''}
          tone="warning"
          description={t('uninstallConfirm')}
          closeLabel={t('closeDialog')}
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                data-modal-autofocus=""
                onClick={() => setUninstallTarget(undefined)}
              >
                {t('cancelUninstall')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="dsh-atlas-manager-danger"
                disabled={!canRemove || busy || uninstallTarget === undefined}
                onClick={() => {
                  if (uninstallTarget === undefined || !canRemove || busy) return
                  const target = uninstallTarget
                  setUninstallTarget(undefined)
                  memberStatus.current[target]?.focus()
                  void uninstall(target)
                }}
              >
                {t('uninstall')}
              </Button>
            </>
          }
        />
      </div>
    )
  }

  ctx.effect(() => ctx.locale.register(NS, LABELS), `${NS}: locale`)
  ctx.effect(() => {
    const refreshIfObserved = () => {
      if (observing) void refresh()
    }
    const changed = ctx.remote.$on('plugin-manager/changed', refreshIfObserved)
    const reset = ctx.on('connection/reset', refreshIfObserved)
    const panel = ctx.slots.inject(CONFIG_SLOT, () => ctx.slots.register({ name: CONFIG_SLOT, key: PACKAGE }, (props: PanelProps) => (
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
