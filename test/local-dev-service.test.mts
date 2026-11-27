import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalDevService, type PluginManagerLike } from '../lib/local-dev-service.js'
import { LocalDevError, PACKAGE, parseLocalDevRequest } from '../lib/local-dev-types.js'
import { resolveInstalledDependency } from '../lib/bundle-inspector.js'

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
        source: `${pkg.name}@${pkg.version}`,
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

test('validates local-dev IPC requests and rejects legacy or invalid inputs', () => {
  assert.deepEqual(parseLocalDevRequest({ action: 'overview' }), { action: 'overview' })
  assert.deepEqual(parseLocalDevRequest({ action: 'inspect', packageName: '@miorin/a' }), {
    action: 'inspect',
    packageName: '@miorin/a',
  })
  assert.deepEqual(parseLocalDevRequest({ action: 'prepare-local', packageName: '@miorin/a' }), {
    action: 'prepare-local',
    packageName: '@miorin/a',
  })
  assert.deepEqual(parseLocalDevRequest({ action: 'switch', packageName: 'alpha', mode: 'local' }), {
    action: 'switch',
    packageName: 'alpha',
    mode: 'local',
  })
  assert.deepEqual(parseLocalDevRequest({ action: 'switch', packageName: '@miorin/a', mode: 'npm' }), {
    action: 'switch',
    packageName: '@miorin/a',
    mode: 'npm',
  })

  for (const invalid of [
    null,
    [],
    {},
    { action: 'switch', packageName: '../evil', mode: 'local' },
    { action: 'switch', packageName: 'alpha', mode: 'baseline' },
    { action: 'set-self-mode', packageName: 'alpha', mode: 'local' },
    { action: 'set-members-mode', packageName: 'alpha', mode: 'bundled' },
    { action: 'reset-drift', packageName: '@miorin/a' },
    { action: 'unknown', packageName: 'alpha' },
  ]) {
    assert.throws(
      () => parseLocalDevRequest(invalid),
      (err: unknown) => err instanceof LocalDevError && err.code === 'invalid-request',
    )
  }
})

test('switches single plugin between npm and local without workspaceDir when returning to npm', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-single-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  let workspaceDir = join(root, 'workspace')
  const regSingleOld = join(root, 'reg', 'single@0.1.0')
  const regSingleLatest = join(root, 'reg', 'single@0.3.0')
  createBundleDir(regSingleOld, '@miorin/dsh-single', '0.1.0')
  createBundleDir(regSingleLatest, '@miorin/dsh-single', '0.3.0')
  createBundleDir(join(workspaceDir, 'dsh-single'), '@miorin/dsh-single', '0.2.0')

  const registry = new Map([
    ['@miorin/dsh-single@0.1.0', regSingleOld],
    ['@miorin/dsh-single', regSingleLatest],
  ])
  const { manager, installed } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-single@0.1.0', { enabled: true })
  installed.set(PACKAGE, {
    name: PACKAGE, version: '0.2.0', source: `link:${workspaceDir}/dsh-atlas-atlas`, enabled: true, official: false, removable: true,
  })
  installed.set('@miorin/git-plugin', {
    name: '@miorin/git-plugin', version: '0.1.0', source: 'git+https://example.com/repo.git#abc', enabled: true, official: false, removable: true, update: 'git',
  })

  let enabled = true
  const service = new LocalDevService({
    manager,
    profileDir,
    isEnabled: () => enabled,
    getWorkspaceDir: () => workspaceDir,
  })

  // Protects self.
  await assert.rejects(
    () => service.switchSource(PACKAGE, 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'protected',
  )

  // Rejects unsupported git source.
  await assert.rejects(
    () => service.switchSource('@miorin/git-plugin', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'not-manageable',
  )

  // npm -> local preserves enabled = true.
  const toLocal = await service.switchSource('@miorin/dsh-single', 'local')
  assert.equal(toLocal.mode, 'local')
  assert.equal(toLocal.currentVersion, '0.2.0')
  assert.equal(toLocal.enabled, true)
  assert.equal(toLocal.canSwitchToLocal, false)
  assert.equal(toLocal.canSwitchToNpm, true)

  // local -> npm works even when localWorkspaceDir is cleared and installs latest from npm.
  workspaceDir = ''
  const backToNpm = await service.switchSource('@miorin/dsh-single', 'npm')
  assert.equal(backToNpm.mode, 'npm')
  assert.equal(backToNpm.currentVersion, '0.3.0')
  assert.equal(backToNpm.currentSource, '@miorin/dsh-single@0.3.0')
  assert.equal(backToNpm.enabled, true)
  assert.equal(backToNpm.canSwitchToNpm, false)

  // Disabled gate rejects writes.
  enabled = false
  await assert.rejects(
    () => service.switchSource('@miorin/dsh-single', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'disabled',
  )
})

test('switches aggregate bundle between npm and full-local overlay with member validation and overlay GC', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-agg-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  mkdirSync(profileDir, { recursive: true })
  const regAgg = join(root, 'reg', 'agg@0.1.0')
  const localAgg = join(workspaceDir, 'dsh-atlas-demo')
  const localM1 = join(workspaceDir, 'm-one')

  const aggDef = {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n`,
    aggregate: { version: 1 as const, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/m-one'] },
  }
  createBundleDir(regAgg, '@miorin/dsh-atlas-demo', '0.1.0', aggDef)
  createBundleDir(localAgg, '@miorin/dsh-atlas-demo', '0.2.0', aggDef)

  const registry = new Map([
    ['@miorin/dsh-atlas-demo@0.1.0', regAgg],
    ['@miorin/dsh-atlas-demo', regAgg],
  ])
  const { manager } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-atlas-demo@0.1.0', { enabled: true })

  const service = new LocalDevService({
    manager,
    profileDir,
    isEnabled: () => true,
    getWorkspaceDir: () => workspaceDir,
  })

  // Before local member exists, status blocks switching to local.
  const missingMemberOverview = await service.overview()
  assert.equal(missingMemberOverview.aggregateBundles.length, 1)
  assert.equal(missingMemberOverview.aggregateBundles[0].mode, 'npm')
  assert.equal(missingMemberOverview.aggregateBundles[0].canSwitchToLocal, false)
  assert.equal(missingMemberOverview.aggregateBundles[0].membersReady, false)
  await assert.rejects(
    () => service.switchSource('@miorin/dsh-atlas-demo', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'missing-checkout',
  )

  // Add local member checkout -> can switch to full-local overlay.
  createBundleDir(localM1, '@miorin/m-one', '0.1.1', {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n`,
  })

  const readyStatus = await service.inspectBundle('@miorin/dsh-atlas-demo')
  assert.equal(readyStatus.canSwitchToLocal, true)
  assert.equal(readyStatus.canSwitchToNpm, false)

  const localStatus = await service.switchSource('@miorin/dsh-atlas-demo', 'local')
  assert.equal(localStatus.mode, 'local')
  assert.equal(localStatus.currentVersion, '0.2.0')
  assert.equal(localStatus.canSwitchToLocal, false)
  assert.equal(localStatus.canSwitchToNpm, true)
  const overlayDir = localStatus.activeOverlayDir!
  assert.ok(overlayDir)
  assert.equal(existsSync(overlayDir), true)
  assert.equal(await resolveInstalledDependency(overlayDir, '@miorin/m-one'), localM1)

  // Switching back to npm installs from registry and removes overlay directory.
  const npmStatus = await service.switchSource('@miorin/dsh-atlas-demo', 'npm')
  assert.equal(npmStatus.mode, 'npm')
  assert.equal(npmStatus.currentVersion, '0.1.0')
  assert.equal(npmStatus.activeOverlayDir, undefined)
  assert.equal(existsSync(overlayDir), false)
})

test('prepares local specs for first-time install without deleting active overlays', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-prep-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  mkdirSync(profileDir, { recursive: true })
  createBundleDir(join(workspaceDir, 'dsh-single'), '@miorin/dsh-single', '0.2.0')
  createBundleDir(join(workspaceDir, 'm-one'), '@miorin/m-one', '0.1.1')
  createBundleDir(join(workspaceDir, 'dsh-atlas-demo'), '@miorin/dsh-atlas-demo', '0.2.0', {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n`,
    aggregate: { version: 1, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/m-one'] },
  })

  const { manager, installed } = createMemoryManager(profileDir, new Map())
  const service = new LocalDevService({
    manager,
    profileDir,
    isEnabled: () => true,
    getWorkspaceDir: () => workspaceDir,
  })

  const singlePrep = await service.prepareLocal('@miorin/dsh-single')
  assert.deepEqual(singlePrep, {
    spec: `link:${join(workspaceDir, 'dsh-single')}`,
    version: '0.2.0',
    isAggregate: false,
  })

  const aggPrep1 = await service.prepareLocal('@miorin/dsh-atlas-demo')
  assert.equal(aggPrep1.isAggregate, true)
  assert.equal(aggPrep1.version, '0.2.0')
  assert.ok(aggPrep1.overlayDir)
  assert.equal(existsSync(aggPrep1.overlayDir!), true)

  // If the bundle is already installed pointing at aggPrep1, preparing again does not GC the active overlay.
  installed.set('@miorin/dsh-atlas-demo', {
    name: '@miorin/dsh-atlas-demo',
    version: '0.2.0',
    source: aggPrep1.spec,
    enabled: true,
    official: false,
    removable: true,
  })
  const aggPrep2 = await service.prepareLocal('@miorin/dsh-atlas-demo')
  assert.notEqual(aggPrep2.overlayDir, aggPrep1.overlayDir)
  assert.equal(existsSync(aggPrep1.overlayDir!), true)
  assert.equal(existsSync(aggPrep2.overlayDir!), true)
})

test('restores previous bundle and cleans failed overlays on switch failure', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-rb-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  mkdirSync(profileDir, { recursive: true })
  const regAgg = join(root, 'reg', 'agg@0.1.0')
  const aggDef = {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n`,
    aggregate: { version: 1 as const, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/m-one'] },
  }
  createBundleDir(regAgg, '@miorin/dsh-atlas-demo', '0.1.0', aggDef)
  createBundleDir(join(workspaceDir, 'dsh-atlas-demo'), '@miorin/dsh-atlas-demo', '0.2.0', aggDef)
  createBundleDir(join(workspaceDir, 'm-one'), '@miorin/m-one', '0.1.1')

  const registry = new Map([['@miorin/dsh-atlas-demo@0.1.0', regAgg]])
  const { manager, installed } = createMemoryManager(profileDir, registry)
  await manager.installBundle('@miorin/dsh-atlas-demo@0.1.0', { enabled: true })

  const origInstall = manager.installBundle.bind(manager)
  let failLinks = true
  let failRegistry = false
  manager.installBundle = async (spec, opts) => {
    if (failLinks && spec.startsWith('link:')) {
      return { application: 'failed', changed: false, error: { code: 'operation-error', diagnostic: 'simulated local fail' } }
    }
    if (failRegistry && !spec.startsWith('link:')) {
      return { application: 'failed', changed: false, error: { code: 'operation-error', diagnostic: 'simulated npm 404' } }
    }
    return origInstall(spec, opts)
  }

  const service = new LocalDevService({
    manager,
    profileDir,
    isEnabled: () => true,
    getWorkspaceDir: () => workspaceDir,
  })

  // 1. npm -> local fails: restores npm bundle and deletes the failed newly built overlay.
  await assert.rejects(
    () => service.switchSource('@miorin/dsh-atlas-demo', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'switch-failed',
  )
  assert.equal(installed.get('@miorin/dsh-atlas-demo')?.source, '@miorin/dsh-atlas-demo@0.1.0')
  assert.equal(installed.get('@miorin/dsh-atlas-demo')?.enabled, true)

  // Switch successfully to local overlay, then simulate npm failure on local -> npm.
  failLinks = false
  const localStatus = await service.switchSource('@miorin/dsh-atlas-demo', 'local')
  const activeOverlay = localStatus.activeOverlayDir!
  assert.equal(existsSync(activeOverlay), true)

  // 2. local -> npm fails (e.g. unpublished package): preserves overlay on disk and restores local bundle.
  failRegistry = true
  await assert.rejects(
    () => service.switchSource('@miorin/dsh-atlas-demo', 'npm'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'switch-failed',
  )
  assert.equal(existsSync(activeOverlay), true)
  assert.equal(installed.get('@miorin/dsh-atlas-demo')?.source, `link:${activeOverlay}`)
  assert.equal(installed.get('@miorin/dsh-atlas-demo')?.enabled, true)
})
