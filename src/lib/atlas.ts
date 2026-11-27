import type { BundleInfo, ChangeResult, ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { NPM_REGISTRY } from './local-dev-types.js'

export const PACKAGE = '@miorin/dsh-atlas-atlas'
export const ATLAS_BUNDLES = {
  workspace: '@miorin/dsh-atlas-workspace',
  session: '@miorin/dsh-atlas-session',
  list: '@miorin/dsh-atlas-list',
  plugin: '@miorin/dsh-atlas-plugin',
  mobile: '@miorin/dsh-atlas-mobile',
  continuity: '@miorin/dsh-atlas-continuity',
  visual: '@miorin/dsh-atlas-visual',
} as const

export type Atlas = keyof typeof ATLAS_BUNDLES

export type Manager = Pick<ClientRemote['pluginManager'], 'listBundles' | 'installBundle' | 'setBundleEnabled' | 'inspect' | 'removeBundle'>
export const ENTRY_ID = 'dsh-atlas-atlas'
export interface LocalInstallOptions {
  readonly localDevEnabled: boolean
  readonly localWorkspaceDir?: string
  readonly prepareLocal?: (packageName: string) => Promise<
    | { readonly ok: true; readonly spec: string; readonly version: string }
    | { readonly ok: false; readonly detail?: string }
  >
}

export type Progress = 'installing' | 'enabling' | 'disabling' | 'uninstalling'
export type Failure = 'installFailed' | 'localLinkFailed' | 'enableFailed' | 'disableFailed' | 'inventoryFailed' | 'rollbackFailed' | 'uninstallFailed'
export type Notice =
  | { kind: 'restart' | 'overridden' | 'cancelled' | 'bundleMissing' | 'localWorkspaceRequired' | 'uninstallUnavailable' }
  | { kind: Failure; detail?: string }
  | { kind: 'conflict'; bundle: string; row: string }
  | { kind: 'continuityConflict' }

export function normalizeWorkspaceDir(input: string | undefined): string | undefined {
  if (input === undefined) return undefined
  const trimmed = input.trim()
  if (trimmed === '' || /[\u0000-\u001f]/u.test(trimmed)) return undefined
  if (!trimmed.startsWith('/') && !/^[a-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/i.test(trimmed)) return undefined
  if (trimmed === '/' || /^[a-z]:[\\/]$/i.test(trimmed)) return trimmed
  return trimmed.replace(/[\\/]+$/, '') || '/'
}

function resultValue<T>(answer: RemoteResult<T>): T {
  if (!answer.ok) throw new Error(answer.error.message)
  return answer.value
}

function resultDetail(result: ChangeResult): string | undefined {
  return result.error?.diagnostic || result.packageResult?.kind || result.error?.code
}

function outcome(result: ChangeResult, failure: Failure): Notice | undefined {
  switch (result.application) {
    case 'applied': return
    case 'restart-required': return { kind: 'restart' }
    case 'overridden': return { kind: 'overridden' }
    case 'cancelled': return { kind: 'cancelled' }
    case 'failed': return { kind: failure, detail: resultDetail(result) }
  }
}

export function canUninstallAtlas(bundle: BundleInfo | undefined): boolean {
  return bundle?.installed === true && !bundle.enabled && bundle.removable && bundle.readOnlyReason === undefined
}

export async function uninstallAtlas(manager: Manager, atlas: Atlas): Promise<Notice | undefined> {
  try {
    const name = ATLAS_BUNDLES[atlas]
    const inventory = resultValue(await manager.listBundles())
    if (!canUninstallAtlas(inventory.find(bundle => bundle.name === name))) return { kind: 'uninstallUnavailable' }
    return outcome(resultValue(await manager.removeBundle(name)), 'uninstallFailed')
  } catch (error) {
    return { kind: 'uninstallFailed', detail: error instanceof Error ? error.message : String(error) }
  }
}

function conflict(inventory: readonly BundleInfo[], target: BundleInfo, atlas: Atlas): Notice | undefined {
  const rowIds = new Set(target.rows.map(row => row.rowId))
  for (const other of inventory) {
    if (!other.enabled || other.name === target.name) continue
    const row = other.rows.find(item => rowIds.has(item.rowId))
    if (row === undefined) continue
    if (atlas === 'continuity' && (other.name === '@miorin/dsh-vcs-panel' || other.name === '@miorin/dsh-sideby-note')) {
      return { kind: 'continuityConflict' }
    }
    return { kind: 'conflict', bundle: other.name, row: row.rowId }
  }
}

async function restoreSelection(manager: Manager, name: string, failure: ChangeResult): Promise<Notice> {
  const original = resultDetail(failure)
  try {
    const restoration = resultValue(await manager.setBundleEnabled(name, false))
    if (restoration.application === 'applied' || restoration.application === 'restart-required') {
      return { kind: 'enableFailed', detail: original }
    }
    return { kind: 'rollbackFailed', detail: [original, resultDetail(restoration)].filter(Boolean).join('\n') }
  } catch (error) {
    return { kind: 'rollbackFailed', detail: [original, String(error)].filter(Boolean).join('\n') }
  }
}

export async function setAtlasEnabled(
  manager: Manager,
  atlas: Atlas,
  enabled: boolean,
  progress: (stage: Progress) => void,
  local?: LocalInstallOptions,
): Promise<Notice | undefined> {
  const name = ATLAS_BUNDLES[atlas]
  let failure: Failure = 'inventoryFailed'
  let restart: Notice | undefined
  try {
    let inventory = resultValue(await manager.listBundles())
    let bundle = inventory.find(item => item.name === name)
    if (Boolean(bundle?.enabled) === enabled) return

    if (enabled && (bundle === undefined || bundle.availability === 'missing')) {
      if (bundle?.installed) return { kind: 'bundleMissing' }
      if (local?.localDevEnabled === true) {
        const workspaceDir = normalizeWorkspaceDir(local.localWorkspaceDir)
        if (workspaceDir === undefined) return { kind: 'localWorkspaceRequired' }
        progress('installing')
        failure = 'localLinkFailed'
        if (local.prepareLocal === undefined) {
          return { kind: 'localLinkFailed', detail: name }
        }
        const prepared = await local.prepareLocal(name)
        if (!prepared.ok) {
          return { kind: 'localLinkFailed', detail: prepared.detail ?? name }
        }
        const inspection = resultValue(await manager.inspect(prepared.spec, {}))
        if (inspection.status !== 'accepted' || inspection.kind !== 'path' || inspection.name !== name
          || inspection.bundle !== true || inspection.version !== prepared.version) {
          return { kind: 'localLinkFailed', detail: inspection.status === 'refused' ? inspection.reason : prepared.spec }
        }
        const result = resultValue(await manager.installBundle(prepared.spec, {
          enabled: false,
          expected: { name, version: prepared.version },
        }))
        if (result.application === 'restart-required') {
          restart = { kind: 'restart' }
        } else if (result.error?.code !== 'already-installed') {
          const notice = outcome(result, failure)
          if (notice !== undefined) return notice
        }
        failure = 'inventoryFailed'
        inventory = resultValue(await manager.listBundles())
        bundle = inventory.find(item => item.name === name)
        if (bundle === undefined || bundle.availability === 'missing') {
          return restart ?? { kind: 'localLinkFailed', detail: prepared.spec }
        }
        if (bundle.enabled) return restart
      } else {
        progress('installing')
        failure = 'installFailed'
        const result = resultValue(await manager.installBundle(name, {
          registry: NPM_REGISTRY,
          saveExact: true,
          enabled: false,
        }))
        if (result.application === 'restart-required') {
          restart = { kind: 'restart' }
        } else if (result.error?.code !== 'already-installed') {
          const notice = outcome(result, failure)
          if (notice !== undefined) return notice
        }
        failure = 'inventoryFailed'
        inventory = resultValue(await manager.listBundles())
        bundle = inventory.find(item => item.name === name)
        if (bundle === undefined || bundle.availability === 'missing') {
          return restart ?? { kind: 'installFailed', detail: name }
        }
        if (bundle.enabled) return restart
      }
    }

    if (enabled && bundle !== undefined) {
      if (bundle.error !== undefined) return { kind: 'enableFailed', detail: bundle.error.diagnostic || bundle.error.code }
      const collision = conflict(inventory, bundle, atlas)
      if (collision !== undefined) return collision
    }
    progress(enabled ? 'enabling' : 'disabling')
    failure = enabled ? 'enableFailed' : 'disableFailed'
    const result = resultValue(await manager.setBundleEnabled(name, enabled))
    if (enabled && result.application === 'failed' && result.changed) {
      return await restoreSelection(manager, name, result)
    }
    return outcome(result, failure) ?? restart
  } catch (error) {
    return { kind: failure, detail: error instanceof Error ? error.message : String(error) }
  }
}
