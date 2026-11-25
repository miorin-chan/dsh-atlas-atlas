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
export interface RepositorySettings {
  useLocalRepositories: boolean
  localRepositoryParent: string
}
export type Progress = 'installing' | 'enabling' | 'disabling' | 'uninstalling'
export type Failure = 'installFailed' | 'enableFailed' | 'disableFailed' | 'inventoryFailed' | 'rollbackFailed' | 'uninstallFailed'
export type Notice =
  | { kind: 'restart' | 'overridden' | 'cancelled' | 'bundleMissing' | 'localInstallRequired' | 'uninstallUnavailable' }
  | { kind: Failure | 'localLinkFailed'; detail?: string }
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
    // Recheck after confirmation in case the inventory changed while the dialog was open.
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

export function absoluteRepositoryParent(input: string): string | undefined {
  const path = input.trim()
  if (/[\u0000-\u001f]/u.test(path)) return
  if (path.startsWith('/') || /^[a-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/i.test(path)) return path
}

export function localAtlasSpec(parent: string, atlas: Atlas): string | undefined {
  const path = absoluteRepositoryParent(parent)
  if (path === undefined) return
  const folder = ATLAS_BUNDLES[atlas].split('/')[1]
  const separator = path.startsWith('/') ? '/' : '\\'
  const source = separator === '/' ? path : path.replace(/\//g, '\\')
  const mount = separator === '/' ? '/' : /^(?:[a-z]:|\\\\[^\\]+\\[^\\]+)\\?/i.exec(source)?.[0]
  if (mount === undefined) return
  const directories: string[] = []
  for (const part of source.slice(mount.length).split(separator)) {
    if (part === '..') directories.pop()
    else if (part !== '' && part !== '.') directories.push(part)
  }
  const root = mount.endsWith(separator) ? mount : `${mount}${separator}`
  return `link:${root}${[...directories, folder].join(separator)}`
}

export async function linkAtlas(
  manager: Manager,
  atlas: Atlas,
  parent: string,
  installed: BundleInfo | undefined,
): Promise<Notice | undefined> {
  const name = ATLAS_BUNDLES[atlas]
  const spec = localAtlasSpec(parent, atlas)
  const failed = (detail?: string): Notice => ({ kind: 'localLinkFailed', detail: [spec, detail].filter(Boolean).join('\n') })
  if (spec === undefined) return failed()
  if (installed?.source === spec && installed.availability !== 'missing') return
  try {
    const inspection = resultValue(await manager.inspect(spec))
    // DSH 0.2.2-rc.5 checks the local manifest's name before returning this refusal.
    // It omits the structured name on a refusal, so check the full diagnostic too.
    const sameInstalledPackage = installed?.installed && inspection.status === 'refused' &&
      inspection.problem === 'already-installed' && inspection.reason === `${name} is already installed`
    if (!sameInstalledPackage && (inspection.status !== 'accepted' || inspection.name !== name ||
      inspection.kind !== 'path' || inspection.bundle !== true || !inspection.version)) {
      return failed(inspection.status === 'refused' ? inspection.reason : name)
    }
    if (installed?.installed) {
      if (!installed.removable) return failed(name)
      const removal = resultValue(await manager.removeBundle(name))
      const notice = outcome(removal, 'installFailed')
      if (notice !== undefined && notice.kind !== 'restart') {
        return notice.kind === 'installFailed' ? failed(resultDetail(removal)) : notice
      }
    }
    const checked = inspection.status === 'accepted' ? inspection : resultValue(await manager.inspect(spec))
    if (checked.status !== 'accepted' || checked.kind !== 'path' || checked.name !== name ||
      checked.bundle !== true || !checked.version) {
      return failed(checked.status === 'refused' ? checked.reason : name)
    }
    const result = resultValue(await manager.installBundle(spec, {
      enabled: false,
      expected: { name, version: checked.version },
    }))
    const notice = outcome(result, 'installFailed')
    return notice?.kind === 'installFailed' ? failed(resultDetail(result)) : notice
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
}

export async function setAtlasEnabled(
  manager: Manager,
  atlas: Atlas,
  enabled: boolean,
  progress: (stage: Progress) => void,
  localParent?: string,
): Promise<Notice | undefined> {
  const name = ATLAS_BUNDLES[atlas]
  let failure: Failure = 'inventoryFailed'
  let restart: Notice | undefined
  try {
    let inventory = resultValue(await manager.listBundles())
    let bundle = inventory.find(item => item.name === name)
    if (enabled && localParent !== undefined &&
      (bundle?.availability !== 'profile' || bundle.source !== localAtlasSpec(localParent, atlas))) {
      progress('installing')
      const notice = await linkAtlas(manager, atlas, localParent, bundle)
      if (notice?.kind === 'restart') restart = notice
      else if (notice !== undefined) return notice
      inventory = resultValue(await manager.listBundles())
      bundle = inventory.find(item => item.name === name)
      if (bundle?.availability !== 'profile' || bundle.source !== localAtlasSpec(localParent, atlas)) {
        return restart ?? { kind: 'localLinkFailed', detail: localAtlasSpec(localParent, atlas) }
      }
    }
    if (Boolean(bundle?.enabled) === enabled) return restart

    if (enabled && (bundle === undefined || bundle.availability === 'missing')) {
      if (bundle?.installed) return { kind: 'bundleMissing' }
      if (isLocalOnlyAtlas(atlas)) return { kind: 'localInstallRequired' }
      progress('installing')
      failure = 'installFailed'
      // Install unselected so we can check its declared rows before enabling it.
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
    if (enabled && localParent === undefined && result.application === 'failed' && result.changed) {
      return await restoreSelection(manager, name, result)
    }
    return outcome(result, failure) ?? restart
  } catch (error) {
    return { kind: failure, detail: error instanceof Error ? error.message : String(error) }
  }
}
