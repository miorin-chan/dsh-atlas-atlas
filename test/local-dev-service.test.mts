import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalDevService, type PluginManagerLike } from '../lib/local-dev-service.js'
import { LocalDevError, PACKAGE, parseLocalDevRequest } from '../lib/local-dev-types.js'
import { resolveInstalledDependency } from '../lib/bundle-inspector.js'

function createBundleDir(dir: string, name: string, version: string, extra: {
  patch?: string
  dependencies?: Record<string, string>
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
    ...(extra.dependencies ? { dependencies: extra.dependencies } : {}),
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true },
      ...(extra.aggregate ? { aggregate: extra.aggregate } : {}),
    },
  }, null, 2)}\n`)
}

function addBundledDependency(baseDir: string, name: string, version: string, patch?: string): string {
  const pnpmDir = join(baseDir, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', ...name.split('/'))
  createBundleDir(pnpmDir, name, version, patch ? { patch } : {})
  const linkPath = join(baseDir, 'node_modules', ...name.split('/'))
  mkdirSync(join(linkPath, '..'), { recursive: true })
  symlinkSync(pnpmDir, linkPath, 'junction')
  return realpathSync(pnpmDir)
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
  assert.deepEqual(parseLocalDevRequest({
    action: 'switch-member',
    packageName: '@miorin/agg',
    memberName: '@miorin/sub',
    mode: 'local',
  }), {
    action: 'switch-member',
    packageName: '@miorin/agg',
    memberName: '@miorin/sub',
    mode: 'local',
  })

  for (const invalid of [
    null,
    [],
    {},
    { action: 'switch', packageName: '../evil', mode: 'local' },
    { action: 'switch', packageName: 'alpha', mode: 'baseline' },
    { action: 'switch-member', packageName: '@miorin/agg', memberName: '../evil', mode: 'local' },
    { action: 'switch-member', packageName: '@miorin/agg', memberName: '@miorin/sub', mode: 'bundled' },
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
  mkdirSync(profileDir, { recursive: true })
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

test('supports parent-gated per-member local/npm switching, partial checkouts, and full-local promotion', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-svc-members-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  mkdirSync(profileDir, { recursive: true })
  const regAgg = join(root, 'reg', 'agg@0.1.0')
  const localAgg = join(workspaceDir, 'dsh-atlas-demo')
  const localM1 = join(workspaceDir, 'm-one')
  const localM2 = join(workspaceDir, 'm-two')

  const aggDef = {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n    - id: m-two\n      name: "@miorin/m-two"\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n`,
    dependencies: { '@miorin/m-one': '0.1.0', '@miorin/m-two': '0.1.0' },
    aggregate: { version: 1 as const, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/m-one', '@miorin/m-two'] },
  }
  createBundleDir(regAgg, '@miorin/dsh-atlas-demo', '0.1.0', aggDef)
  createBundleDir(localAgg, '@miorin/dsh-atlas-demo', '0.2.0', aggDef)
  const bundledM1 = addBundledDependency(localAgg, '@miorin/m-one', '0.1.0')
  const bundledM2 = addBundledDependency(localAgg, '@miorin/m-two', '0.1.0')

  // Only m-one is cloned locally at first; m-two only exists as bundled npm dependency under localAgg.
  createBundleDir(localM1, '@miorin/m-one', '0.1.1', {
    patch: `- insert:\n    - id: m-one\n      name: "@miorin/m-one"\n`,
  })

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

  // 1. While parent aggregate is on npm: member switching is gated off, but aggregate switch to local IS allowed.
  const npmOverview = await service.overview()
  assert.equal(npmOverview.aggregateBundles.length, 1)
  const npmAggStatus = npmOverview.aggregateBundles[0]
  assert.equal(npmAggStatus.mode, 'npm')
  assert.equal(npmAggStatus.canSwitchToLocal, true)
  assert.equal(npmAggStatus.membersReady, false)
  assert.equal(npmAggStatus.members[0].mode, 'npm')
  assert.equal(npmAggStatus.members[0].available, true)
  assert.equal(npmAggStatus.members[0].bundledAvailable, true)
  assert.equal(npmAggStatus.members[0].canSwitchToLocal, false)
  assert.equal(npmAggStatus.members[1].available, false)
  assert.equal(npmAggStatus.members[1].bundledAvailable, true)

  await assert.rejects(
    () => service.switchMember('@miorin/dsh-atlas-demo', '@miorin/m-one', 'local'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'not-manageable',
  )

  // 2. Switching aggregate to local with partial member checkouts links localAgg directly (0 overlays).
  const localDirectStatus = await service.switchSource('@miorin/dsh-atlas-demo', 'local')
  assert.equal(localDirectStatus.mode, 'local')
  assert.equal(localDirectStatus.currentSource, `link:${localAgg}`)
  assert.equal(localDirectStatus.activeOverlayDir, undefined)
  assert.equal(localDirectStatus.canSwitchToLocal, false)
  assert.equal(localDirectStatus.canSwitchToNpm, true)
  assert.equal(localDirectStatus.members[0].mode, 'npm')
  assert.equal(localDirectStatus.members[0].canSwitchToLocal, true)
  assert.equal(localDirectStatus.members[1].mode, 'npm')
  assert.equal(localDirectStatus.members[1].canSwitchToLocal, false)

  // 3. Switch m-one to local -> builds partial overlay (m-one local, m-two bundled).
  const partialStatus = await service.switchMember('@miorin/dsh-atlas-demo', '@miorin/m-one', 'local')
  assert.equal(partialStatus.mode, 'local')
  const overlay1 = partialStatus.activeOverlayDir!
  assert.ok(overlay1)
  assert.equal(existsSync(overlay1), true)
  assert.equal(await resolveInstalledDependency(overlay1, '@miorin/m-one'), localM1)
  assert.equal(await resolveInstalledDependency(overlay1, '@miorin/m-two'), bundledM2)
  assert.equal(partialStatus.members[0].mode, 'local')
  assert.equal(partialStatus.members[0].canSwitchToNpm, true)
  assert.equal(partialStatus.members[1].mode, 'npm')
  assert.equal(partialStatus.members[1].canSwitchToLocal, false)
  assert.equal(partialStatus.canSwitchToLocal, false)

  // 4. Clone m-two locally -> m-two and aggregate full-local promotion become available.
  createBundleDir(localM2, '@miorin/m-two', '0.1.2', {
    patch: `- insert:\n    - id: m-two\n      name: "@miorin/m-two"\n`,
  })
  const afterCloneStatus = await service.inspectBundle('@miorin/dsh-atlas-demo')
  assert.equal(afterCloneStatus.members[1].canSwitchToLocal, true)
  assert.equal(afterCloneStatus.canSwitchToLocal, true)

  // 5. Switch m-two to local -> both members local, previous overlay GC'd.
  const fullStatus = await service.switchMember('@miorin/dsh-atlas-demo', '@miorin/m-two', 'local')
  const overlay2 = fullStatus.activeOverlayDir!
  assert.ok(overlay2)
  assert.notEqual(overlay2, overlay1)
  assert.equal(existsSync(overlay1), false)
  assert.equal(existsSync(overlay2), true)
  assert.equal(fullStatus.members[0].mode, 'local')
  assert.equal(fullStatus.members[1].mode, 'local')
  assert.equal(fullStatus.canSwitchToLocal, false)

  // 6. Switch m-one back to npm -> m-one npm (bundledM1), m-two local, previous overlay GC'd.
  const mixedAgain = await service.switchMember('@miorin/dsh-atlas-demo', '@miorin/m-one', 'npm')
  const overlay3 = mixedAgain.activeOverlayDir!
  assert.ok(overlay3)
  assert.notEqual(overlay3, overlay2)
  assert.equal(existsSync(overlay2), false)
  assert.equal(await resolveInstalledDependency(overlay3, '@miorin/m-one'), bundledM1)
  assert.equal(await resolveInstalledDependency(overlay3, '@miorin/m-two'), localM2)
  assert.equal(mixedAgain.members[0].mode, 'npm')
  assert.equal(mixedAgain.members[1].mode, 'local')
  assert.equal(mixedAgain.canSwitchToLocal, true)

  // 7. Switch m-two back to npm -> returns cleanly to link:localAgg with 0 overlays on disk.
  const allBundledLocal = await service.switchMember('@miorin/dsh-atlas-demo', '@miorin/m-two', 'npm')
  assert.equal(existsSync(overlay3), false)
  assert.equal(allBundledLocal.mode, 'local')
  assert.equal(allBundledLocal.currentSource, `link:${localAgg}`)
  assert.equal(allBundledLocal.activeOverlayDir, undefined)
  assert.equal(allBundledLocal.members[0].mode, 'npm')
  assert.equal(allBundledLocal.members[1].mode, 'npm')
  assert.equal(allBundledLocal.canSwitchToLocal, true)
  assert.equal(allBundledLocal.canSwitchToNpm, true)

  // 8. Promote back to full-local overlay via switchSource(..., 'local').
  const promotedFull = await service.switchSource('@miorin/dsh-atlas-demo', 'local')
  const overlay4 = promotedFull.activeOverlayDir!
  assert.ok(overlay4)
  assert.equal(existsSync(overlay4), true)
  assert.equal(promotedFull.members[0].mode, 'local')
  assert.equal(promotedFull.members[1].mode, 'local')

  // 9. Switch entire aggregate back to npm and GC overlay.
  const backToNpm = await service.switchSource('@miorin/dsh-atlas-demo', 'npm')
  assert.equal(backToNpm.mode, 'npm')
  assert.equal(backToNpm.currentVersion, '0.1.0')
  assert.equal(backToNpm.activeOverlayDir, undefined)
  assert.equal(existsSync(overlay4), false)

  // 10. Member linked locally inside aggregate node_modules without a bundled npm copy reports bundledAvailable = false.
  const localOnlyAgg = join(workspaceDir, 'dsh-atlas-local-only')
  const localOnlyMember = join(workspaceDir, 'm-local-only')
  createBundleDir(localOnlyMember, '@miorin/m-local-only', '0.1.0')
  createBundleDir(localOnlyAgg, '@miorin/dsh-atlas-local-only', '0.1.0', {
    patch: `- insert:\n    - id: m-local-only\n      name: "@miorin/m-local-only"\n    - id: dsh-atlas-local-only\n      name: "@miorin/dsh-atlas-local-only"\n`,
    dependencies: { '@miorin/m-local-only': 'link:../m-local-only' },
    aggregate: { version: 1, runtimeRowId: 'dsh-atlas-local-only', plugins: ['@miorin/m-local-only'] },
  })
  mkdirSync(join(localOnlyAgg, 'node_modules', '@miorin'), { recursive: true })
  symlinkSync(localOnlyMember, join(localOnlyAgg, 'node_modules', '@miorin', 'm-local-only'), 'junction')
  await manager.installBundle(`link:${localOnlyAgg}`, { enabled: true })

  const localOnlyStatus = await service.inspectBundle('@miorin/dsh-atlas-local-only')
  assert.equal(localOnlyStatus.mode, 'local')
  assert.equal(localOnlyStatus.members[0].mode, 'local')
  assert.equal(localOnlyStatus.members[0].bundledAvailable, false)
  assert.equal(localOnlyStatus.members[0].canSwitchToNpm, false)
  await assert.rejects(
    () => service.switchMember('@miorin/dsh-atlas-local-only', '@miorin/m-local-only', 'npm'),
    (err: unknown) => err instanceof LocalDevError && err.code === 'not-manageable',
  )
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
  createBundleDir(join(workspaceDir, 'dsh-atlas-partial'), '@miorin/dsh-atlas-partial', '0.2.0', {
    patch: `- insert:\n    - id: m-missing\n      name: "@miorin/m-missing"\n    - id: dsh-atlas-partial\n      name: "@miorin/dsh-atlas-partial"\n`,
    aggregate: { version: 1, runtimeRowId: 'dsh-atlas-partial', plugins: ['@miorin/m-missing'] },
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

  // Aggregate missing a member falls back cleanly to direct checkout link instead of failing.
  const partialPrep = await service.prepareLocal('@miorin/dsh-atlas-partial')
  assert.deepEqual(partialPrep, {
    spec: `link:${join(workspaceDir, 'dsh-atlas-partial')}`,
    version: '0.2.0',
    isAggregate: true,
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
