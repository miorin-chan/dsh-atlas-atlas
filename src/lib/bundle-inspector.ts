import { glob, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isPackageName, LocalDevError, packageBasename } from './local-dev-types.js'

const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-z-][a-z\d-]*)(?:\.(?:0|[1-9]\d*|\d*[a-z-][a-z\d-]*))*)?(?:\+[a-z\d-]+(?:\.[a-z\d-]+)*)?$/i
const EXCLUDED_ENTRIES = new Set(['node_modules', '.git', '.cordis'])

export interface AggregateMetadata {
  readonly version: number
  readonly runtimeRowId: string
  readonly plugins: readonly string[]
}

export interface CheckedBundle {
  readonly root: string
  readonly name: string
  readonly version: string
  readonly manifest: Readonly<Record<string, unknown>>
  readonly patchFiles: readonly string[]
  readonly patchRelativePaths: readonly string[]
  readonly aggregate?: AggregateMetadata
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function hasExcludedSegment(path: string): boolean {
  return path.split(sep).some(part => EXCLUDED_ENTRIES.has(part))
}

function resolveInside(root: string, value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\\\0]/.test(value)
    || isAbsolute(value) || /^[a-z]:/i.test(value)
    || value.split('/').some(part => part === '..' || EXCLUDED_ENTRIES.has(part))) {
    throw new Error(`${label} must name a relative file inside ${root}: ${JSON.stringify(value)}`)
  }
  const target = resolve(root, value)
  if (target === root || !isInside(root, target)) {
    throw new Error(`${label} escapes ${root}: ${value}`)
  }
  return target
}

async function checkedFile(root: string, value: unknown, label: string): Promise<string> {
  const path = resolveInside(root, value, label)
  try {
    const actual = await realpath(path)
    if (!isInside(root, actual) || hasExcludedSegment(relative(root, actual)) || !(await stat(actual)).isFile()) {
      throw new Error(`${label} must resolve to a file inside ${root}: ${path}`)
    }
  } catch (error) {
    if (isMissing(error)) throw new Error(`${label} not found: ${path}`, { cause: error })
    throw error
  }
  return path
}

async function checkExport(root: string, value: unknown, label: string): Promise<void> {
  if (value === null) return
  if (typeof value === 'string') {
    if (!value.startsWith('./')) throw new Error(`${label} must start with "./": ${value}`)
    resolveInside(root, value, label)
    if (!value.includes('*')) {
      await checkedFile(root, value, label)
      return
    }
    const pattern = value.slice(2).split('/').map(seg => seg === '*' ? '**/*' : seg).join('/')
    let found = false
    for await (const match of glob(pattern, { cwd: root, exclude: ['**/node_modules', '**/.git'] })) {
      await checkedFile(root, match, label)
      found = true
    }
    if (!found) throw new Error(`${label} matches no built files for ${value}`)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) await checkExport(root, item, label)
    return
  }
  const conditions = asRecord(value)
  if (!conditions) throw new Error(`${label} must be an export target`)
  for (const [key, target] of Object.entries(conditions)) {
    if (key === 'types' || key.startsWith('types@')) continue
    await checkExport(root, target, label === 'exports' ? `exports[${JSON.stringify(key)}]` : label)
  }
}

export function parseAggregateMetadata(
  manifest: Readonly<Record<string, unknown>>,
  packageName: string,
): AggregateMetadata | undefined {
  const dsh = asRecord(manifest.dsh)
  if (dsh?.aggregate === undefined) return undefined
  const aggregate = asRecord(dsh.aggregate)
  if (!aggregate) throw new Error(`${packageName}: dsh.aggregate must be an object`)
  const plugins = aggregate.plugins
  if (!Array.isArray(plugins) || plugins.length === 0 || !plugins.every(isPackageName)
    || new Set(plugins).size !== plugins.length || plugins.includes(packageName)) {
    throw new Error(`${packageName}: dsh.aggregate.plugins must list distinct member package names`)
  }
  const version = aggregate.version === undefined ? 0 : aggregate.version
  if (typeof version !== 'number' || !Number.isInteger(version) || (version !== 0 && version !== 1)) {
    throw new Error(`${packageName}: unsupported dsh.aggregate.version ${JSON.stringify(version)}`)
  }
  const runtimeRowId = typeof aggregate.runtimeRowId === 'string' && aggregate.runtimeRowId.trim() !== ''
    ? aggregate.runtimeRowId
    : packageBasename(packageName)
  return { version, runtimeRowId, plugins }
}

export async function readCheckedBundle(dir: string, expectedName?: string): Promise<CheckedBundle> {
  const root = await realpath(dir)
  const manifestPath = await checkedFile(root, 'package.json', 'package.json')
  let manifest: Record<string, unknown> | undefined
  try {
    manifest = asRecord(JSON.parse(await readFile(manifestPath, 'utf8')))
  } catch (error) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!manifest || !isPackageName(manifest.name) || typeof manifest.version !== 'string' || !EXACT_VERSION.test(manifest.version)) {
    throw new Error(`${manifestPath} must declare a valid package name and exact semver version`)
  }
  if (expectedName !== undefined && manifest.name !== expectedName) {
    throw new Error(`${manifestPath} declares ${manifest.name}, expected ${expectedName}`)
  }

  const dsh = asRecord(manifest.dsh)
  const patchRaw = asRecord(dsh?.bundle)?.patch
  const patchRelativePaths = Array.isArray(patchRaw) ? patchRaw : [patchRaw]
  if (patchRelativePaths.length === 0 || !patchRelativePaths.every((p): p is string => typeof p === 'string')) {
    throw new Error(`${manifest.name}: package.json must declare dsh.bundle.patch`)
  }
  const patchFiles = await Promise.all(patchRelativePaths.map(p => checkedFile(root, p, `${manifest.name} patch`)))

  if (manifest.exports !== undefined) {
    await checkExport(root, manifest.exports, 'exports')
  } else if (manifest.main !== undefined) {
    await checkedFile(root, manifest.main, `${manifest.name} main`)
  }

  if (dsh?.client !== undefined) {
    const client = asRecord(manifest.exports)?.['./client']
    const target = typeof client === 'string' ? client : asRecord(client)?.default
    if (typeof target !== 'string') {
      throw new Error(`${manifest.name}: dsh.client requires a built ./client export`)
    }
  }
  if (manifest.icon !== undefined) {
    await checkedFile(root, manifest.icon, `${manifest.name} icon`)
  }

  const aggregate = parseAggregateMetadata(manifest, manifest.name)
  return {
    root,
    name: manifest.name,
    version: manifest.version,
    manifest,
    patchFiles,
    patchRelativePaths,
    ...(aggregate !== undefined ? { aggregate } : {}),
  }
}

export async function validateWorkspaceDir(workspaceDir: string): Promise<string> {
  const trimmed = workspaceDir.trim()
  if (trimmed === '') throw new LocalDevError('no-workspace-dir', 'Local workspace directory is not configured')
  if (!isAbsolute(trimmed) || /[\u0000-\u001f]/u.test(trimmed)) {
    throw new LocalDevError('invalid-request', `Workspace directory must be an absolute path: ${workspaceDir}`)
  }
  try {
    const resolved = await realpath(trimmed)
    if (!(await stat(resolved)).isDirectory()) {
      throw new LocalDevError('missing-checkout', `${resolved} is not a directory`)
    }
    return resolved
  } catch (error) {
    if (error instanceof LocalDevError) throw error
    throw new LocalDevError('missing-checkout', `${trimmed}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function inspectSiblingCheckout(workspaceDir: string, packageName: string): Promise<CheckedBundle> {
  const realWorkspace = await validateWorkspaceDir(workspaceDir)
  const candidate = join(realWorkspace, packageBasename(packageName))
  let realCandidate: string
  try {
    realCandidate = await realpath(candidate)
  } catch (error) {
    if (isMissing(error)) throw new LocalDevError('missing-checkout', candidate)
    throw new LocalDevError('invalid-checkout', `${candidate}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (dirname(realCandidate) !== realWorkspace) {
    throw new LocalDevError('invalid-checkout', `${candidate} must resolve directly inside ${realWorkspace}`)
  }
  try {
    return await readCheckedBundle(realCandidate, packageName)
  } catch (error) {
    throw new LocalDevError('invalid-checkout', `${realCandidate}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function resolveInstalledDependency(root: string, name: string): Promise<string | undefined> {
  if (!isPackageName(name)) return undefined
  for (let dir = root; ; dir = dirname(dir)) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', ...name.split('/'))
      try {
        const info = await stat(join(candidate, 'package.json'))
        if (info.isFile()) return await realpath(candidate)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    if (dirname(dir) === dir) return undefined
  }
}

export function resolveBundleRootFromInfo(profileDir: string, bundle: { readonly name: string; readonly source?: string }): string {
  if (bundle.source?.startsWith('link:')) {
    return bundle.source.slice(5)
  }
  return join(profileDir, 'node_modules', ...bundle.name.split('/'))
}
