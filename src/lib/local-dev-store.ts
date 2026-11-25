import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isPackageName,
  LocalDevError,
  type LocalDevStateFile,
  type ManagedBundleRecord,
} from './local-dev-types.js'

const ROOT_DIR = 'dsh-atlas-local-dev'
const STATE_FILE = 'state.json'
const OVERLAYS_DIR = 'overlays'

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

function validateManagedRecord(key: string, value: unknown): ManagedBundleRecord | undefined {
  const raw = asRecord(value)
  if (!raw || raw.packageName !== key || !isPackageName(key)) return undefined
  if (typeof raw.isAggregate !== 'boolean') return undefined
  const baseline = asRecord(raw.baseline)
  if (!baseline || typeof baseline.spec !== 'string' || typeof baseline.version !== 'string' || typeof baseline.enabled !== 'boolean') {
    return undefined
  }
  if (raw.selfMode !== 'baseline' && raw.selfMode !== 'local') return undefined
  if (raw.membersMode !== 'bundled' && raw.membersMode !== 'local') return undefined
  if (typeof raw.activeSpec !== 'string' || typeof raw.activeVersion !== 'string') return undefined
  if (raw.overlayDir !== undefined && typeof raw.overlayDir !== 'string') return undefined
  if (typeof raw.updatedAt !== 'string') return undefined

  let memberPaths: Record<string, string> | undefined
  if (raw.memberPaths !== undefined) {
    const rawPaths = asRecord(raw.memberPaths)
    if (!rawPaths) return undefined
    memberPaths = {}
    for (const [member, dir] of Object.entries(rawPaths)) {
      if (!isPackageName(member) || typeof dir !== 'string') return undefined
      memberPaths[member] = dir
    }
  }

  return {
    packageName: key,
    isAggregate: raw.isAggregate,
    baseline: {
      spec: baseline.spec,
      version: baseline.version,
      enabled: baseline.enabled,
    },
    selfMode: raw.selfMode,
    membersMode: raw.membersMode,
    activeSpec: raw.activeSpec,
    activeVersion: raw.activeVersion,
    ...(raw.overlayDir !== undefined ? { overlayDir: raw.overlayDir } : {}),
    ...(memberPaths !== undefined ? { memberPaths } : {}),
    updatedAt: raw.updatedAt,
  }
}

export class LocalDevStore {
  readonly baseDir: string
  readonly statePath: string
  readonly overlaysDir: string

  constructor(profileDir: string) {
    this.baseDir = join(profileDir, ROOT_DIR)
    this.statePath = join(this.baseDir, STATE_FILE)
    this.overlaysDir = join(this.baseDir, OVERLAYS_DIR)
  }

  async readState(): Promise<LocalDevStateFile> {
    let text: string
    try {
      text = await readFile(this.statePath, 'utf8')
    } catch (error) {
      if (isMissing(error)) return { version: 1, bundles: {} }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { version: 1, bundles: {} }
    }
    const obj = asRecord(parsed)
    if (!obj || obj.version !== 1) return { version: 1, bundles: {} }
    const rawBundles = asRecord(obj.bundles)
    if (!rawBundles) return { version: 1, bundles: {} }
    const bundles: Record<string, ManagedBundleRecord> = {}
    for (const [key, value] of Object.entries(rawBundles)) {
      const record = validateManagedRecord(key, value)
      if (record) bundles[key] = record
    }
    return { version: 1, bundles }
  }

  async writeState(state: LocalDevStateFile): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 })
    const temp = join(this.baseDir, `${STATE_FILE}.${randomUUID()}.tmp`)
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, this.statePath)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }

  async readRecord(packageName: string): Promise<ManagedBundleRecord | undefined> {
    const state = await this.readState()
    return state.bundles[packageName]
  }

  async writeRecord(packageName: string, record: ManagedBundleRecord | undefined): Promise<void> {
    const state = await this.readState()
    const next = { ...state.bundles }
    if (record === undefined) {
      delete next[packageName]
    } else {
      next[packageName] = record
    }
    await this.writeState({ version: 1, bundles: next })
  }

  async allocateOverlayDir(packageName: string): Promise<string> {
    const packageDir = join(this.overlaysDir, safePackageKey(packageName))
    await mkdir(packageDir, { recursive: true, mode: 0o700 })
    const created = await mkdtemp(join(packageDir, 'overlay-'))
    return realpath(created)
  }

  async gcOverlays(packageName: string, keepDir?: string): Promise<void> {
    const packageDir = join(this.overlaysDir, safePackageKey(packageName))
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
}
