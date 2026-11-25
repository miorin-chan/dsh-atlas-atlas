import type { BundleInfo, ChangeResult, ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'

export const PACKAGE = '@miorin/dsh-atlas-atlas'
export const ATLAS_BUNDLES = {
  workspace: '@miorin/dsh-atlas-workspace',
  session: '@miorin/dsh-atlas-session',
  list: '@miorin/dsh-atlas-list',
  plugin: '@miorin/dsh-atlas-plugin',
  mobile: '@miorin/dsh-atlas-mobile',
  continuity: '@miorin/dsh-atlas-continuity',
} as const

export type Atlas = keyof typeof ATLAS_BUNDLES
export const LOCAL_ONLY_ATLASES = ['continuity'] as const satisfies readonly Atlas[]
export type LocalAtlas = typeof LOCAL_ONLY_ATLASES[number]

export function isLocalOnlyAtlas(atlas: Atlas): atlas is LocalAtlas {
  return LOCAL_ONLY_ATLASES.some(local => local === atlas)
}

export type Manager = Pick<ClientRemote['pluginManager'], 'listBundles' | 'installBundle' | 'setBundleEnabled' | 'inspect' | 'removeBundle'>
export const ENTRY_ID = 'dsh-atlas-atlas'

export type Progress = 'installing' | 'enabling' | 'disabling' | 'uninstalling'
export type Failure = 'installFailed' | 'enableFailed' | 'disableFailed' | 'inventoryFailed' | 'rollbackFailed' | 'uninstallFailed'
export type Notice =
  | { kind: 'restart' | 'overridden' | 'cancelled' | 'bundleMissing' | 'localInstallRequired' | 'uninstallUnavailable' }
  | { kind: Failure; detail?: string }
  | { kind: 'conflict'; bundle: string; row: string }
  | { kind: 'continuityConflict' }

const NPM_REGISTRY = 'https://registry.npmjs.org/'

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
): Promise<Notice | undefined> {
  const name = ATLAS_BUNDLES[atlas]
  let failure: Failure = 'inventoryFailed'
  try {
    let inventory = resultValue(await manager.listBundles())
    let bundle = inventory.find(item => item.name === name)
    if (Boolean(bundle?.enabled) === enabled) return

    if (enabled && (bundle === undefined || bundle.availability === 'missing')) {
      if (bundle?.installed) return { kind: 'bundleMissing' }
      if (isLocalOnlyAtlas(atlas)) return { kind: 'localInstallRequired' }
      progress('installing')
      failure = 'installFailed'
      const result = resultValue(await manager.installBundle(name, {
        registry: NPM_REGISTRY,
        saveExact: true,
        enabled: false,
      }))
      if (result.error?.code !== 'already-installed' && result.application !== 'restart-required') {
        const notice = outcome(result, failure)
        if (notice !== undefined) return notice
      }
      failure = 'inventoryFailed'
      inventory = resultValue(await manager.listBundles())
      bundle = inventory.find(item => item.name === name)
      if (bundle === undefined || bundle.availability === 'missing') {
        return result.application === 'restart-required' ? { kind: 'restart' } : { kind: 'installFailed', detail: name }
      }
      if (bundle.enabled) return
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
    return outcome(result, failure)
  } catch (error) {
    return { kind: failure, detail: error instanceof Error ? error.message : String(error) }
  }
}
