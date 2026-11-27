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

function manageablePackageName(subject: PluginDetailProps['subject']): string | undefined {
  if (subject.kind !== 'bundle') return undefined
  if (!subject.pkg.installed || subject.pkg.official || subject.pkg.name === PACKAGE) return undefined
  return subject.pkg.name
}

export function LocalDevBadge({ subject, form, t, subscribeUpdates }: LocalDevBadgeProps) {
  const configSnapshot = useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  )
  const enabled = configSnapshot.value?.localDevEnabled === true
  const workspaceDir = configSnapshot.value?.localWorkspaceDir ?? ''
  const packageName = manageablePackageName(subject)
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

  if (!enabled || status === undefined || status.mode !== 'local') return null

  return (
    <>
      <style>{CSS}</style>
      <span className="dsh-atlas-manager-tags" data-atlas-local-badges={status.packageName}>
        <Tag tone="info" className="dsh-atlas-local-tag">{t('localSourceTag')}</Tag>
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
  const packageName = manageablePackageName(subject)
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

  if (!enabled || packageName === undefined) return null

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
            <div>
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
                <Button
                  variant="outline"
                  size="sm"
                  className="dsh-atlas-local-btn"
                  disabled={working || !canSwitch || !status.canSwitchToNpm}
                  onClick={() => { void runAction({ action: 'switch', packageName, mode: 'npm' }) }}
                >
                  {t('switchToNpm')}
                </Button>
              )}
            </div>
          </div>

          {status.isAggregate && status.members.length > 0 && (
            <details className="dsh-atlas-manager-status dsh-atlas-manager-detail">
              <summary>{t('memberBreakdown', { count: String(status.members.length) })}</summary>
              <ul className="dsh-atlas-local-members-list">
                {status.members.map(member => (
                  <li key={member.name}>
                    <code>{member.name}</code>{' '}
                    ({t(member.available ? 'memberAvailable' : 'memberUnavailable')})
                    {member.version ? ` · v${member.version}` : ''}
                  </li>
                ))}
              </ul>
            </details>
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
