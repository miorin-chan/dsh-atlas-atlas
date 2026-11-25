import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalDevService, type PluginManagerLike } from '../lib/local-dev-service.js'
import { LocalDevStore } from '../lib/local-dev-store.js'
import { LocalDevError, PACKAGE } from '../lib/local-dev-types.js'

function createBundleDir(dir: string, name: string, version: string, extra: {
  patch?: string
  aggregate?: { version: 1; runtimeRowId: string; plugins: string[] }
} = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.js'), `export const name = ${JSON.stringify(name)}; export function apply() {}\n`)
  writeFileSync(join(dir, 'client.js'), `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: () => ({}) });\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), extra.patch ?? `- insert:\n    - id: ${name.split('/')[1]}\n      name: ${JSON.stringify(name)}\n`)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name,
    version,
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true },
      ...(extra.aggregate ? { aggregate: extra.aggregate } : {}),
    },
  }, null, 2)}\n`)
}

function createMemoryManager(profileDir: string, registryPackages: Map<string, string>) {
  const installed = new Map<string, {
    name: string
    version: string
    source: string
    enabled: boolean
    official: boolean
    removable: boolean
    update?: 'registry' | 'git'
  }>()
  const ops: string[] = []

  const installDirOf = (name: string) => join(profileDir, 'node_modules', ...name.split('/'))

  const manager: PluginManagerLike = {
    async listBundles() {
      return [...installed.values()].map(b => ({
        name: b.name,
        official: b.official,
        availability: 'profile' as const,
        version: b.version,
        enabled: b.enabled,
        installed: true,
        source: b.source,
        optional: false,
        removable: b.removable,
        ...(b.update ? { update: b.update } : {}),
        rows: [],
        overrides: [],
      }))
    },
    async inspect(spec: string, options?: unknown) {
      assert.deepEqual(options, {})
      if (spec.startsWith('link:')) {
        const dir = spec.slice(5)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (installed.has(pkg.name)) {
          return { status: 'refused', problem: 'already-installed', reason: `${pkg.name} is already installed` }
        }
        return { status: 'accepted', kind: 'path', name: pkg.name, version: pkg.version, bundle: true }
      }
      const at = spec.lastIndexOf('@')
      const name = at > 0 ? spec.slice(0, at) : spec
      if (installed.has(name)) {
        return { status: 'refused', problem: 'already-installed', reason: `${name} is already installed` }
      }
      const regDir = registryPackages.get(spec)
      if (!regDir) return { status: 'refused', problem: 'not-found', reason: `${spec} not found` }
      const pkg = JSON.parse(readFileSync(join(regDir, 'package.json'), 'utf8'))
      return { status: 'accepted', kind: 'registry', name: pkg.name, version: pkg.version, bundle: true }
    },
    async installBundle(spec, options) {
      ops.push(`install:${spec}:${options.enabled}`)
      if (spec.startsWith('link:')) {
        const dir = spec.slice(5)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        installed.set(pkg.name, {
          name: pkg.name,
          version: pkg.version,
          source: spec,
          enabled: options.enabled ?? false,
          official: false,
          removable: true,
        })
        return { application: 'applied', changed: true }
      }
      const regDir = registryPackages.get(spec)
      if (!regDir) return { application: 'failed', changed: false, error: { code: 'operation-error', diagnostic: 'missing registry fixture' } }
      const pkg = JSON.parse(readFileSync(join(regDir, 'package.json'), 'utf8'))
      const dest = installDirOf(pkg.name)
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(regDir, dest, { recursive: true })
      installed.set(pkg.name, {
        name: pkg.name,
        version: pkg.version,
        source: spec,
        enabled: options.enabled ?? false,
        official: false,
        removable: true,
        update: 'registry',
      })
      return { application: 'applied', changed: true }
    },
    async removeBundle(name) {
      ops.push(`remove:${name}`)
      const prev = installed.get(name)
      installed.delete(name)
      if (prev && !prev.source.startsWith('link:')) {
        rmSync(installDirOf(name), { recursive: true, force: true })
      }
      return { application: 'applied', changed: true }
    },
  }

  return { manager, installed, ops }
}

test('Feature 1 switches single plugin between baseline and local while protecting self and rejecting non-aggregates on Feature 2', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-single-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const regSingle = join(root, 'reg', 'single@0.1.0')
  createBundleDir(regSingle, '@miorin/dsh-single', '0.1.0')
  createBundleDir(join(workspaceDir, 'dsh-single'), '@miorin/dsh-single', '0.2.0')

  const registry = new Map([['@miorin/dsh-single@0.1.0', regSingle]])
  const { manager, installed } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-single@0.1.0', { enabled: true })
  installed.set(PACKAGE, {
    name: PACKAGE, version: '0.2.0', source: `link:${workspaceDir}/dsh-atlas-atlas`, enabled: true, official: false, removable: true,
  })

  const store = new LocalDevStore(profileDir)
  let enabled = true
  const service = new LocalDevService({
    manager,
    profileDir,
    store,
    isEnabled: () => enabled,
    getWorkspaceDir: () => workspaceDir,
  })

  // Protected self.
  await assert.rejects(
    () => service.setSelfMode(PACKAGE, 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'protected',
  )

  // Feature 2 rejected on single plugin.
  await assert.rejects(
    () => service.setMembersMode('@miorin/dsh-single', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'not-aggregate',
  )

  // Feature 1: baseline -> local -> baseline preserving enabled = true.
  const toLocal = await service.setSelfMode('@miorin/dsh-single', 'local')
  assert.equal(toLocal.selfMode, 'local')
  assert.equal(toLocal.membersMode, 'bundled')
  assert.equal(toLocal.currentVersion, '0.2.0')
  assert.equal(toLocal.enabled, true)

  const back = await service.setSelfMode('@miorin/dsh-single', 'baseline')
  assert.equal(back.selfMode, 'baseline')
  assert.equal(back.currentVersion, '0.1.0')
  assert.equal(back.enabled, true)
  assert.equal(await store.readRecord('@miorin/dsh-single'), undefined)

  // Disabled gate rejects writes.
  enabled = false
  await assert.rejects(
    () => service.setSelfMode('@miorin/dsh-single', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'disabled',
  )
})

test('Features 1 and 2 compose across all 4 orthogonal states on an aggregate bundle with overlay GC and drift handling', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-agg-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const regAgg = join(root, 'reg', 'agg@0.1.0')
  const localAgg = join(workspaceDir, 'dsh-atlas-demo')
  const localM1 = join(workspaceDir, 'm-one')

  createBundleDir(localM1, '@miorin/m-one', '0.1.1', {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n`,
  })

  const aggDef = {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n`,
    aggregate: { version: 1 as const, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/m-one'] },
  }
  createBundleDir(regAgg, '@miorin/dsh-atlas-demo', '0.1.0', aggDef)
  createBundleDir(localAgg, '@miorin/dsh-atlas-demo', '0.2.0', aggDef)

  const registry = new Map([['@miorin/dsh-atlas-demo@0.1.0', regAgg]])
  const { manager, installed } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-atlas-demo@0.1.0', { enabled: true })

  const store = new LocalDevStore(profileDir)
  const service = new LocalDevService({
    manager,
    profileDir,
    store,
    isEnabled: () => true,
    getWorkspaceDir: () => workspaceDir,
  })

  const overview = await service.overview()
  assert.equal(overview.aggregateBundles.length, 1)
  assert.equal(overview.aggregateBundles[0].packageName, '@miorin/dsh-atlas-demo')

  // State 1 -> 2: (baseline, bundled) -> (baseline, local)
  const sBaselineLocal = await service.setMembersMode('@miorin/dsh-atlas-demo', 'local')
  assert.equal(sBaselineLocal.selfMode, 'baseline')
  assert.equal(sBaselineLocal.membersMode, 'local')
  assert.equal(sBaselineLocal.currentVersion, '0.1.0')
  const overlay1 = sBaselineLocal.activeOverlayDir!
  assert.ok(existsSync(overlay1))

  // State 2 -> 3: (baseline, local) -> (local, local)
  const sLocalLocal = await service.setSelfMode('@miorin/dsh-atlas-demo', 'local')
  assert.equal(sLocalLocal.selfMode, 'local')
  assert.equal(sLocalLocal.membersMode, 'local')
  assert.equal(sLocalLocal.currentVersion, '0.2.0')
  const overlay2 = sLocalLocal.activeOverlayDir!
  assert.notEqual(overlay2, overlay1)
  assert.equal(existsSync(overlay1), false, 'previous overlay must be GCd')
  assert.equal(existsSync(overlay2), true)

  // State 3 -> 4: (local, local) -> (local, bundled)
  const sLocalBundled = await service.setMembersMode('@miorin/dsh-atlas-demo', 'bundled')
  assert.equal(sLocalBundled.selfMode, 'local')
  assert.equal(sLocalBundled.membersMode, 'bundled')
  assert.equal(sLocalBundled.currentVersion, '0.2.0')
  assert.equal(existsSync(overlay2), false, 'overlay must be GCd when back to bundled')

  // State 4 -> 1: (local, bundled) -> (baseline, bundled)
  const sBaselineBundled = await service.setSelfMode('@miorin/dsh-atlas-demo', 'baseline')
  assert.equal(sBaselineBundled.selfMode, 'baseline')
  assert.equal(sBaselineBundled.membersMode, 'bundled')
  assert.equal(sBaselineBundled.currentVersion, '0.1.0')
  assert.equal(await store.readRecord('@miorin/dsh-atlas-demo'), undefined)

  // State 1 -> 3 -> 2 -> 1 path as well: (baseline, bundled) -> (local, bundled) -> (local, local) -> (baseline, local) -> (baseline, bundled)
  await service.setSelfMode('@miorin/dsh-atlas-demo', 'local')
  await service.setMembersMode('@miorin/dsh-atlas-demo', 'local')
  const backToBaselineLocal = await service.setSelfMode('@miorin/dsh-atlas-demo', 'baseline')
  assert.equal(backToBaselineLocal.selfMode, 'baseline')
  assert.equal(backToBaselineLocal.membersMode, 'local')
  assert.equal(backToBaselineLocal.currentVersion, '0.1.0')
  const overlay3 = backToBaselineLocal.activeOverlayDir!
  assert.ok(existsSync(overlay3))

  // External drift detection & reset.
  const currentInstalled = installed.get('@miorin/dsh-atlas-demo')!
  installed.set('@miorin/dsh-atlas-demo', { ...currentInstalled, source: 'link:/some/other/path' })
  const drifted = await service.inspectBundle('@miorin/dsh-atlas-demo')
  assert.equal(drifted.drifted, true)
  await assert.rejects(
    () => service.setMembersMode('@miorin/dsh-atlas-demo', 'bundled'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'external-drift',
  )
  const afterReset = await service.resetDrift('@miorin/dsh-atlas-demo')
  assert.equal(afterReset.drifted, false)
  assert.equal(existsSync(overlay3), false)
})

test('rolls back cleanly when replacement install fails after removal', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-rb-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const regSingle = join(root, 'reg', 'single@0.1.0')
  createBundleDir(regSingle, '@miorin/dsh-single', '0.1.0')
  createBundleDir(join(workspaceDir, 'dsh-single'), '@miorin/dsh-single', '0.2.0')

  const registry = new Map([['@miorin/dsh-single@0.1.0', regSingle]])
  const { manager, installed } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-single@0.1.0', { enabled: true })

  const origInstall = manager.installBundle.bind(manager)
  manager.installBundle = async (spec, opts) => {
    if (spec.startsWith('link:')) {
      return { application: 'failed', changed: false, error: { code: 'operation-error', diagnostic: 'simulated install fail' } }
    }
    return origInstall(spec, opts)
  }

  const store = new LocalDevStore(profileDir)
  const service = new LocalDevService({
    manager,
    profileDir,
    store,
    isEnabled: () => true,
    getWorkspaceDir: () => workspaceDir,
  })

  await assert.rejects(
    () => service.setSelfMode('@miorin/dsh-single', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'switch-failed',
  )
  assert.equal(installed.get('@miorin/dsh-single')?.source, '@miorin/dsh-single@0.1.0')
  assert.equal(installed.get('@miorin/dsh-single')?.enabled, true)
  assert.equal(await store.readRecord('@miorin/dsh-single'), undefined)
})
