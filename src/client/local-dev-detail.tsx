import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  PACKAGE,
  type BundleLocalDevStatus,
  type LocalDevConfig,
  type LocalDevErrorCode,
  type LocalDevRequest,
  type MemberLocalStatus,
} from '../lib/local-dev-types.js'
import { localDevErrorKey, type AtlasLabelKey } from './labels.js'
import { inspectBundleLocalDev, requestLocalDev } from './local-dev-api.js'
import { CSS } from './styles.js'

export type TranslateFn = PropsLocale<'dsh-atlas-atlas'>['t']

export interface LocalDevFormStore {
  getSnapshot(): { status: string; value?: Partial<LocalDevConfig>; writable?: boolean; revision?: number }
  subscribe(listener: () => void): () => void
}

export interface LocalDevBadgeProps extends PluginDetailProps {
  readonly form: LocalDevFormStore
  readonly t: TranslateFn
  readonly subscribeUpdates: (listener: () => void) => () => void
}

export interface LocalDevDetailProps extends PluginDetailProps {
  readonly form: LocalDevFormStore
  readonly t: TranslateFn
  readonly canSwitch: boolean
  readonly subscribeUpdates: (listener: () => void) => () => void
  readonly notifyUpdate: () => void
}

type SubjectTarget =
  | { readonly kind: 'bundle'; readonly packageName: string }
  | { readonly kind: 'row'; readonly packageName: string; readonly moduleName: string }

function subjectTarget(subject: PluginDetailProps['subject']): SubjectTarget | undefined {
  if (subject.kind === 'bundle') {
    if (!subject.pkg.installed || subject.pkg.official || subject.pkg.name === PACKAGE) return undefined
    return { kind: 'bundle', packageName: subject.pkg.name }
  }
  if (subject.kind === 'row') {
    if (!subject.pkg.installed || subject.pkg.official || subject.pkg.name === PACKAGE) return undefined
    return { kind: 'row', packageName: subject.pkg.name, moduleName: subject.row.moduleName }
  }
  return undefined
}

function matchMember(members: readonly MemberLocalStatus[], moduleName: string): MemberLocalStatus | undefined {
  return members.find(m => m.name === moduleName || moduleName.startsWith(`${m.name}/`))
}

export function localTagText(status: BundleLocalDevStatus, t: TranslateFn): string {
  if (status.isAggregate && status.members.length > 0) {
    const localCount = status.members.filter(m => m.mode === 'local').length
    if (localCount < status.members.length) {
      return `${t('localSourceTag')} (${localCount}/${status.members.length})`
    }
  }
  return t('localSourceTag')
}

export function MemberLocalDevList({
  status,
  busy,
  canSwitch,
  t,
  defaultOpen,
  onAction,
}: {
  readonly status: BundleLocalDevStatus
  readonly busy: boolean
  readonly canSwitch: boolean
  readonly t: TranslateFn
  readonly defaultOpen?: boolean
  readonly onAction: (request: LocalDevRequest) => void
}) {
  return (
    <details className="dsh-atlas-manager-status dsh-atlas-manager-detail" open={defaultOpen}>
      <summary>{t('memberBreakdown', { count: String(status.members.length) })}</summary>
      <ul className="dsh-atlas-local-members-list">
        {status.members.map(member => (
          <li
            key={member.name}
            className="dsh-atlas-local-member-item"
            data-local-dev-member={member.name}
            data-local-dev-member-mode={member.mode}
          >
            <div className="dsh-atlas-local-member-info">
              <code>{member.name}</code>
              {member.mode === 'local' && (
                <Tag tone="info" className="dsh-atlas-local-tag">{t('localSourceTag')}</Tag>
              )}
              <span>
                ({t(member.available ? 'memberAvailable' : 'memberUnavailable')})
                {member.version ? ` · v${member.version}` : ''}
              </span>
            </div>
            {status.mode === 'local' && (
              <div>
                {member.mode === 'npm' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="dsh-atlas-local-btn"
                    disabled={busy || !canSwitch || !member.canSwitchToLocal}
                    onClick={() => onAction({
                      action: 'switch-member',
                      packageName: status.packageName,
                      memberName: member.name,
                      mode: 'local',
                    })}
                  >
                    {t('switchToLocal')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="dsh-atlas-local-btn"
                    disabled={busy || !canSwitch || !member.canSwitchToNpm}
                    onClick={() => onAction({
                      action: 'switch-member',
                      packageName: status.packageName,
                      memberName: member.name,
                      mode: 'npm',
                    })}
                  >
                    {t('switchToNpm')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function LocalDevBadge({ subject, form, t, subscribeUpdates }: LocalDevBadgeProps) {
  const configSnapshot = useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  const enabled = configSnapshot.value?.localDevEnabled === true
  const workspaceDir = configSnapshot.value?.localWorkspaceDir ?? ''
  const target = subjectTarget(subject)
  const packageName = target?.packageName
  const [status, setStatus] = useState<BundleLocalDevStatus>()
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeUpdates(() => setTick(n => n + 1)), [subscribeUpdates])

  useEffect(() => {
    if (!enabled || packageName === undefined) {
      setStatus(undefined)
      return
    }
    const controller = new AbortController()
    void inspectBundleLocalDev(packageName, controller.signal).then(response => {
      if (!controller.signal.aborted && response.ok) setStatus(response.value)
    })
    return () => controller.abort()
  }, [enabled, workspaceDir, packageName, tick])

  if (!enabled || target === undefined || status === undefined || status.mode !== 'local') return null

  if (target.kind === 'row') {
    const member = matchMember(status.members, target.moduleName)
    if (member?.mode !== 'local') return null
    return (
      <>
        <style>{CSS}</style>
        <span className="dsh-atlas-manager-tags" data-atlas-local-badges={member.name}>
          <Tag tone="info" className="dsh-atlas-local-tag">{t('localSourceTag')}</Tag>
        </span>
      </>
    )
  }

  return (
    <>
      <style>{CSS}</style>
      <span className="dsh-atlas-manager-tags" data-atlas-local-badges={status.packageName}>
        <Tag tone="info" className="dsh-atlas-local-tag">{localTagText(status, t)}</Tag>
      </span>
    </>
  )
}

export function LocalDevDetailSection({
  subject,
  form,
  t,
  canSwitch,
  subscribeUpdates,
  notifyUpdate,
}: LocalDevDetailProps) {
  const configSnapshot = useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  const enabled = configSnapshot.value?.localDevEnabled === true
  const workspaceDir = configSnapshot.value?.localWorkspaceDir ?? ''
  const target = subjectTarget(subject)
  const packageName = target?.packageName
  const [status, setStatus] = useState<BundleLocalDevStatus>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<{ code: LocalDevErrorCode; detail?: string }>()
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeUpdates(() => setTick(n => n + 1)), [subscribeUpdates])

  useEffect(() => {
    if (!enabled || packageName === undefined) {
      setStatus(undefined)
      setError(undefined)
      return
    }
    const controller = new AbortController()
    void inspectBundleLocalDev(packageName, controller.signal).then(response => {
      if (controller.signal.aborted) return
      if (response.ok) {
        setStatus(response.value)
        setError(undefined)
      } else {
        setError({ code: response.error, detail: response.detail })
      }
    })
    return () => controller.abort()
  }, [enabled, workspaceDir, packageName, tick])

  if (!enabled || target === undefined || packageName === undefined) return null

  async function runAction(request: LocalDevRequest) {
    if (working) return
    setWorking(true)
    setError(undefined)
    try {
      const response = await requestLocalDev<BundleLocalDevStatus>(request)
      if (response.ok) {
        setStatus(response.value)
        notifyUpdate()
      } else {
        setError({ code: response.error, detail: response.detail })
        if (packageName !== undefined) {
          const refreshed = await inspectBundleLocalDev(packageName)
          if (refreshed.ok) setStatus(refreshed.value)
        }
      }
    } finally {
      setWorking(false)
    }
  }

  if (target.kind === 'row') {
    if (status === undefined || status.mode !== 'local') return null
    const member = matchMember(status.members, target.moduleName)
    if (member === undefined) return null
    return (
      <section className="dsh-atlas-local-detail" data-atlas-local-dev-section={member.name}>
        <style>{CSS}</style>
        <h4>{t('localDevTitle')}</h4>
        <div
          className="dsh-atlas-local-feature"
          data-local-dev-member={member.name}
          data-local-dev-member-mode={member.mode}
        >
          <div className="dsh-atlas-local-feature-info">
            <span className="dsh-atlas-local-feature-title">
              {t('localSourceLabel')}: {t(member.mode === 'local' ? 'sourceLocal' : 'sourceNpm')}
            </span>
            <span className="dsh-atlas-local-feature-meta">
              {member.checkoutDir}
              {member.issue ? ` · ${member.issue}` : ''}
            </span>
          </div>
          <div>
            {member.mode === 'npm' ? (
              <Button
                variant="outline"
                size="sm"
                className="dsh-atlas-local-btn"
                disabled={working || !canSwitch || !member.canSwitchToLocal}
                onClick={() => {
                  void runAction({
                    action: 'switch-member',
                    packageName,
                    memberName: member.name,
                    mode: 'local',
                  })
                }}
              >
                {t('switchToLocal')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="dsh-atlas-local-btn"
                disabled={working || !canSwitch || !member.canSwitchToNpm}
                onClick={() => {
                  void runAction({
                    action: 'switch-member',
                    packageName,
                    memberName: member.name,
                    mode: 'npm',
                  })
                }}
              >
                {t('switchToNpm')}
              </Button>
            )}
          </div>
        </div>
        {working && <p className="dsh-atlas-manager-status" role="status">{t('localDevWorking')}</p>}
        {status.restartRequired && <p className="dsh-atlas-manager-status" role="status">{t('localDevRestart')}</p>}
        {error && (
          <div role="alert">
            <p className="dsh-atlas-manager-status" data-error="">{t(localDevErrorKey(error.code) as AtlasLabelKey)}</p>
            {error.detail && <code className="dsh-atlas-manager-status">{error.detail}</code>}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="dsh-atlas-local-detail" data-atlas-local-dev-section={packageName}>
      <style>{CSS}</style>
      <h4>{t('localDevTitle')}</h4>
      {status === undefined && error === undefined && (
        <p className="dsh-atlas-manager-status" role="status">{t('loading')}</p>
      )}
      {status !== undefined && (
        <>
          <div className="dsh-atlas-local-feature" data-local-dev-mode={status.mode}>
            <div className="dsh-atlas-local-feature-info">
              <span className="dsh-atlas-local-feature-title">
                {t('localSourceLabel')}: {t(status.mode === 'local' ? 'sourceLocal' : 'sourceNpm')}
              </span>
              <span className="dsh-atlas-local-feature-meta">
                {status.currentSource ?? t('notInstalled')}
                {status.mode === 'npm' && status.localCheckoutIssue ? ` · ${status.localCheckoutIssue}` : ''}
              </span>
            </div>
            <div className="dsh-atlas-local-actions">
              {status.mode === 'npm' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="dsh-atlas-local-btn"
                  disabled={working || !canSwitch || !status.canSwitchToLocal}
                  onClick={() => { void runAction({ action: 'switch', packageName, mode: 'local' }) }}
                >
                  {t('switchToLocal')}
                </Button>
              ) : (
                <>
                  {status.canSwitchToLocal && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="dsh-atlas-local-btn"
                      disabled={working || !canSwitch}
                      onClick={() => { void runAction({ action: 'switch', packageName, mode: 'local' }) }}
                    >
                      {t('switchAllToLocal')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="dsh-atlas-local-btn"
                    disabled={working || !canSwitch || !status.canSwitchToNpm}
                    onClick={() => { void runAction({ action: 'switch', packageName, mode: 'npm' }) }}
                  >
                    {t('switchToNpm')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {status.isAggregate && status.members.length > 0 && (
            <MemberLocalDevList
              status={status}
              busy={working}
              canSwitch={canSwitch}
              t={t}
              defaultOpen
              onAction={req => { void runAction(req) }}
            />
          )}
        </>
      )}
      {working && <p className="dsh-atlas-manager-status" role="status">{t('localDevWorking')}</p>}
      {status?.restartRequired && <p className="dsh-atlas-manager-status" role="status">{t('localDevRestart')}</p>}
      {error && (
        <div role="alert">
          <p className="dsh-atlas-manager-status" data-error="">{t(localDevErrorKey(error.code) as AtlasLabelKey)}</p>
          {error.detail && <code className="dsh-atlas-manager-status">{error.detail}</code>}
        </div>
      )}
    </section>
  )
}
