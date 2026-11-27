import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap } from 'yaml'
import {
  inspectSiblingCheckout,
  isInside,
  readCheckedBundle,
  resolveInstalledDependency,
  type CheckedBundle,
} from './bundle-inspector.js'
import { isPackageName, LocalDevError } from './local-dev-types.js'

const EXCLUDED_ENTRIES = new Set(['node_modules', '.git', '.cordis'])
const OVERLAYS_SUBPATH = join('dsh-atlas-local-dev', 'overlays')

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function safePackageKey(packageName: string): string {
  if (!isPackageName(packageName)) {
    throw new LocalDevError('invalid-request', `Invalid package name: ${packageName}`)
  }
  return packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '__')
    : packageName
}

function packageOverlaysDir(profileDir: string, packageName: string): string {
  return join(profileDir, OVERLAYS_SUBPATH, safePackageKey(packageName))
}

export async function allocateOverlayDir(profileDir: string, packageName: string): Promise<string> {
  const packageDir = packageOverlaysDir(profileDir, packageName)
  await mkdir(packageDir, { recursive: true, mode: 0o700 })
  const created = await mkdtemp(join(packageDir, 'overlay-'))
  return realpath(created)
}

export async function gcOverlays(profileDir: string, packageName: string, keepDir?: string): Promise<void> {
  const packageDir = packageOverlaysDir(profileDir, packageName)
  const resolvedKeep = keepDir === undefined
    ? undefined
    : await realpath(keepDir).catch(() => keepDir)
  let entries
  try {
    entries = await readdir(packageDir, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  for (const entry of entries) {
    const fullPath = join(packageDir, entry.name)
    const resolvedEntry = await realpath(fullPath).catch(() => fullPath)
    if (resolvedKeep !== undefined && resolvedEntry === resolvedKeep) continue
    await rm(fullPath, { recursive: true, force: true })
  }
  if (resolvedKeep === undefined) {
    const remaining = await readdir(packageDir).catch(() => [])
    if (remaining.length === 0) {
      await rm(packageDir, { recursive: true, force: true })
    }
  }
}

export async function isManagedOverlayDir(
  profileDir: string,
  packageName: string,
  candidateDir: string,
): Promise<boolean> {
  const realProfileDir = await realpath(profileDir).catch(() => resolve(profileDir))
  const packageDir = packageOverlaysDir(realProfileDir, packageName)
  const [realPackageDir, realCandidate] = await Promise.all([
    realpath(packageDir).catch(() => packageDir),
    realpath(candidateDir).catch(() => resolve(candidateDir)),
  ])
  return realCandidate !== realPackageDir && isInside(realPackageDir, realCandidate)
}

function packageNameOf(specifier: unknown): string | undefined {
  if (typeof specifier !== 'string' || /[\\:%\s]/.test(specifier)) return undefined
  const parts = specifier.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part === 'node_modules')) return undefined
  const name = parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
  return isPackageName(name) ? name : undefined
}

function dependencyNames(manifest: Readonly<Record<string, unknown>>, field: string): string[] {
  const value = manifest[field]
  if (value === undefined) return []
  const entries = asRecord(value)
  if (!entries) return []
  return Object.keys(entries).filter(isPackageName)
}

interface ParsedInsertRow {
  readonly id: string
  readonly name: string
  readonly node: YAMLMap
}

async function readInsertRows(patchFiles: readonly string[], label: string): Promise<ParsedInsertRow[]> {
  const result: ParsedInsertRow[] = []
  for (const file of patchFiles) {
    const text = await readFile(file, 'utf8')
    const doc = parseDocument(text, { keepSourceTokens: true })
    if (doc.errors.length > 0) {
      throw new LocalDevError('overlay-failed', `${label}: invalid YAML in ${file}: ${doc.errors[0].message}`)
    }
    if (!isSeq(doc.contents)) {
      throw new LocalDevError('overlay-failed', `${label}: ${file} must be a YAML list`)
    }
    for (const item of doc.contents.items) {
      if (!isMap(item)) {
        throw new LocalDevError('overlay-failed', `${label}: patch item in ${file} must be a mapping`)
      }
      const extraKeys = item.items
        .map(({ key }) => String(isScalar(key) ? key.value ?? key : key))
        .filter(key => key !== 'insert')
      if (extraKeys.length > 0) {
        throw new LocalDevError('overlay-failed', `${label}: unsupported patch directive "${extraKeys[0]}" in ${file}`)
      }
      const insert = item.get('insert', true)
      if (!isSeq(insert)) {
        throw new LocalDevError('overlay-failed', `${label}: insert must be a list in ${file}`)
      }
      for (const row of insert.items) {
        if (!isMap(row)) {
          throw new LocalDevError('overlay-failed', `${label}: insert row must be a mapping in ${file}`)
        }
        const id = row.get('id')
        const name = row.get('name')
        if (typeof id !== 'string' || id.trim() === '' || typeof name !== 'string' || name.trim() === '') {
          throw new LocalDevError('overlay-failed', `${label}: row missing valid id/name in ${file}`)
        }
        result.push({ id, name, node: row })
      }
    }
  }
  return result
}

async function copyPackageFiles(source: string, target: string, relDir = ''): Promise<void> {
  const entries = await readdir(join(source, relDir), { withFileTypes: true })
  for (const entry of entries) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue
    const rel = join(relDir, entry.name)
    const from = join(source, rel)
    const to = join(target, rel)
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true })
      await copyPackageFiles(source, target, rel)
    } else if (entry.isFile()) {
      await copyFile(from, to)
    } else if (entry.isSymbolicLink()) {
      const actual = await realpath(from)
      const sourceRelative = relative(source, actual)
      if (!isInside(source, actual) || sourceRelative.split(sep).some(part => EXCLUDED_ENTRIES.has(part))) {
        throw new LocalDevError('overlay-failed', `Cannot project external symlink from bundle: ${from}`)
      }
      const rebased = relative(dirname(to), join(target, sourceRelative)) || '.'
      await symlink(rebased, to, (await stat(actual)).isDirectory() ? 'dir' : 'file')
    } else {
      throw new LocalDevError('overlay-failed', `Unsupported filesystem entry in bundle: ${from}`)
    }
  }
}

export interface BuiltOverlay {
  readonly overlayDir: string
  readonly version: string
  readonly memberPaths: Readonly<Record<string, string>>
}

export async function buildLocalOverlay(options: {
  readonly profileDir: string
  readonly baseBundle: CheckedBundle
  readonly workspaceDir: string
}): Promise<BuiltOverlay> {
  const { baseBundle, workspaceDir } = options
  const aggregate = baseBundle.aggregate
  if (!aggregate) {
    throw new LocalDevError('overlay-failed', `${baseBundle.name} declares no dsh.aggregate.plugins`)
  }
  const realProfileDir = await realpath(options.profileDir)

  // Inspect every direct member checkout first before touching disk.
  const memberBundles: CheckedBundle[] = []
  const memberPaths: Record<string, string> = {}
  for (const memberName of aggregate.plugins) {
    const member = await inspectSiblingCheckout(workspaceDir, memberName)
    memberBundles.push(member)
    memberPaths[memberName] = member.root
  }

  // Collect and regenerate insert rows via YAML AST so !!js tags and comments survive.
  const allRows: Array<{ node: YAMLMap; comment: string; id: string }> = []
  const seenIds = new Map<string, string>()

  for (const member of memberBundles) {
    const rows = await readInsertRows(member.patchFiles, member.name)
    if (rows.length === 0) {
      throw new LocalDevError('overlay-failed', `${member.name} patch inserts no rows`)
    }
    const defaultEnabled = aggregate.defaults?.[member.name]
    for (const row of rows) {
      if (packageNameOf(row.name) !== member.name) {
        throw new LocalDevError('overlay-failed', `${member.name}: row "${row.id}" points to "${row.name}" instead of ${member.name}`)
      }
      const prev = seenIds.get(row.id)
      if (prev !== undefined) {
        throw new LocalDevError('overlay-failed', `Duplicate loader row id "${row.id}" between ${prev} and ${member.name}`)
      }
      seenIds.set(row.id, member.name)
      const cloned = row.node.clone() as YAMLMap
      if (defaultEnabled === false) cloned.set('disabled', true)
      else if (defaultEnabled === true) cloned.delete('disabled')
      allRows.push({ node: cloned, comment: ` ${member.name}`, id: row.id })
    }
  }

  // Retain the aggregate bundle's own runtime rows (e.g. runtimeRowId for settings extraction).
  const baseRows = await readInsertRows(baseBundle.patchFiles, baseBundle.name)
  for (const row of baseRows) {
    if (packageNameOf(row.name) !== baseBundle.name) continue
    const prev = seenIds.get(row.id)
    if (prev !== undefined) {
      throw new LocalDevError('overlay-failed', `Aggregate runtime row id "${row.id}" collides with ${prev}`)
    }
    seenIds.set(row.id, baseBundle.name)
    allRows.push({ node: row.node.clone() as YAMLMap, comment: ` ${baseBundle.name} (aggregate runtime)`, id: row.id })
  }

  if (allRows.length === 0) {
    throw new LocalDevError('overlay-failed', `${baseBundle.name}: regenerated patch has no rows`)
  }

  const inserted = allRows.map(({ node, comment }) => {
    if (!node.commentBefore) node.commentBefore = comment
    return node
  })
  const patchDoc = new Document([{ insert: inserted }])
  patchDoc.commentBefore = ' Generated by dsh-atlas-atlas local-dev overlay. Do not edit by hand.'
  const regeneratedPatch = patchDoc.toString({ lineWidth: 0 })

  // Preserve non-member dependencies while rejecting any dependency that could be pruned on removeBundle.
  const required = new Set(dependencyNames(baseBundle.manifest, 'dependencies'))
  const optional = new Set(dependencyNames(baseBundle.manifest, 'optionalDependencies'))
  const peer = new Set(dependencyNames(baseBundle.manifest, 'peerDependencies'))
  const nonMemberNames = [...new Set([...required, ...optional, ...peer])].filter(
    name => !aggregate.plugins.includes(name),
  )
  const nonMemberLinks: Array<{ name: string; root: string }> = []
  for (const dep of nonMemberNames) {
    const resolved = await resolveInstalledDependency(baseBundle.root, dep)
    if (resolved === undefined) {
      if (required.has(dep) && !optional.has(dep)) {
        throw new LocalDevError('overlay-failed', `${baseBundle.name}: non-member dependency "${dep}" is not installed`)
      }
      continue
    }
    if (isInside(realProfileDir, resolved)) {
      throw new LocalDevError(
        'overlay-failed',
        `Removing the old bundle could prune profile-owned dependency "${dep}" at ${resolved}`,
      )
    }
    nonMemberLinks.push({ name: dep, root: resolved })
  }

  const overlayDir = await allocateOverlayDir(realProfileDir, baseBundle.name)
  try {
    await copyPackageFiles(baseBundle.root, overlayDir)
    const primaryPatchRel = baseBundle.patchRelativePaths[0]
    for (const rel of baseBundle.patchRelativePaths.slice(1)) {
      await rm(join(overlayDir, rel), { force: true })
    }
    await writeFile(join(overlayDir, primaryPatchRel), regeneratedPatch, 'utf8')

    // If baseBundle had multiple patch files, update overlay package.json to point at primaryPatchRel.
    if (baseBundle.patchRelativePaths.length > 1) {
      const overlayPkg = structuredClone(baseBundle.manifest) as Record<string, unknown>
      const dsh = asRecord(overlayPkg.dsh) ?? {}
      const bundleField = asRecord(dsh.bundle) ?? {}
      bundleField.patch = primaryPatchRel
      dsh.bundle = bundleField
      overlayPkg.dsh = dsh
      await writeFile(join(overlayDir, 'package.json'), `${JSON.stringify(overlayPkg, null, 2)}\n`, 'utf8')
    }

    const linkEntry = async (name: string, targetRoot: string) => {
      const linkPath = join(overlayDir, 'node_modules', ...name.split('/'))
      await mkdir(dirname(linkPath), { recursive: true })
      await symlink(targetRoot, linkPath, 'junction')
    }
    for (const member of memberBundles) {
      await linkEntry(member.name, member.root)
    }
    for (const dep of nonMemberLinks) {
      await linkEntry(dep.name, dep.root)
    }

    await verifyOverlay(overlayDir, baseBundle.name, baseBundle.version, memberPaths)
    return { overlayDir, version: baseBundle.version, memberPaths }
  } catch (error) {
    await rm(overlayDir, { recursive: true, force: true }).catch(() => {})
    if (error instanceof LocalDevError) throw error
    throw new LocalDevError('overlay-failed', error instanceof Error ? error.message : String(error))
  }
}

export async function verifyOverlay(
  overlayDir: string,
  expectedName: string,
  expectedVersion: string,
  memberPaths: Readonly<Record<string, string>>,
): Promise<void> {
  const checked = await readCheckedBundle(overlayDir, expectedName)
  if (checked.version !== expectedVersion) {
    throw new LocalDevError('overlay-failed', `Overlay version mismatch for ${expectedName}`)
  }
  const modulesDir = join(overlayDir, 'node_modules')
  const modulesStat = await lstat(modulesDir).catch(() => undefined)
  if (!modulesStat?.isDirectory() || (await realpath(modulesDir)) !== modulesDir) {
    throw new LocalDevError('overlay-failed', `Overlay must own its node_modules directory: ${modulesDir}`)
  }
  for (const [member, expectedRoot] of Object.entries(memberPaths)) {
    const resolved = await resolveInstalledDependency(overlayDir, member)
    if (resolved !== await realpath(expectedRoot)) {
      throw new LocalDevError('overlay-failed', `Overlay member "${member}" does not resolve to ${expectedRoot}`)
    }
  }
}
