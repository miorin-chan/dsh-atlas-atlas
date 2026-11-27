import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ATLAS_BUNDLES,
  PACKAGE,
  canUninstallAtlas,
  setAtlasEnabled,
  uninstallAtlas,
  type Manager,
} from '../lib/atlas.js'
import { discoverInstalledAggregates } from '../lib/discover-aggregates.js'

const workspace = ATLAS_BUNDLES.workspace
const success = <T>(value: T) => ({ ok: true as const, value })
const applied = success({ application: 'applied' as const, changed: true })
const newBundle = (name: string, options: Record<string, unknown> = {}) => ({
  name, installed: true, availability: 'profile', enabled: false, removable: true, optional: false, overrides: [], rows: [], ...options,
})

function fixture(others: Array<Record<string, unknown>> = []) {
  const profile = new Map([newBundle(PACKAGE, { enabled: true }), ...others].map(bundle => [bundle.name as string, bundle]))
  const writes: unknown[][] = []
  const manager = {
    listBundles: async () => success([...profile.values()]),
    async installBundle(spec: string, options?: Record<string, unknown>) {
      writes.push(['install', spec, options])
      const name = (options?.expected as { name?: string } | undefined)?.name ?? spec
      profile.set(name, newBundle(name, {
        source: spec,
        rows: [{ rowId: name === workspace ? 'workspace-switcher' : name }],
      }))
      return applied
    },
    async setBundleEnabled(name: string, enabled: boolean) {
      writes.push(['set', name, enabled])
      profile.set(name, { ...profile.get(name)!, enabled })
      return applied
    },
    async removeBundle(name: string) {
      writes.push(['remove', name])
      profile.delete(name)
      return applied
    },
  } as unknown as Manager & { installBundle: (...args: any[]) => Promise<any>; setBundleEnabled: (...args: any[]) => Promise<any>; removeBundle: (...args: any[]) => Promise<any> }
  return { manager, profile, writes }
}

const ignoreProgress = () => {}

test('installs and enables each missing Atlas from the npm registry and reuses it on the next enable', async () => {
  assert.deepEqual(Object.keys(ATLAS_BUNDLES), ['workspace', 'session', 'list', 'continuity', 'visual', 'plugin', 'mobile'])
  assert.equal(ATLAS_BUNDLES.list, '@miorin/dsh-atlas-list')
  const { manager, profile, writes } = fixture()
  const registryAtlases = Object.entries(ATLAS_BUNDLES) as Array<[keyof typeof ATLAS_BUNDLES, string]>
  for (const [atlas, name] of registryAtlases) {
    const stages: string[] = []
    assert.equal(await setAtlasEnabled(manager, atlas, true, stage => stages.push(stage)), undefined)
    assert.deepEqual(stages, ['installing', 'enabling'])
    assert.equal(profile.get(name)!.enabled, true)
    assert.equal(await setAtlasEnabled(manager, atlas, false, ignoreProgress), undefined)
    assert.equal(profile.get(name)!.installed, true)
    assert.equal(profile.get(name)!.enabled, false)
    assert.equal(await setAtlasEnabled(manager, atlas, true, ignoreProgress), undefined)
    assert.deepEqual(writes.splice(0), [
      ['install', name, { registry: 'https://registry.npmjs.org/', saveExact: true, enabled: false }],
      ['set', name, true], ['set', name, false], ['set', name, true],
    ])
  }
  assert.equal(profile.get(PACKAGE)!.enabled, true)
  assert.ok(registryAtlases.every(([, name]) => profile.get(name)!.enabled))
})

test('toggles existing locally linked Continuity and Visual without changing sources', async () => {
  for (const [atlas, name, dir] of [
    ['continuity', '@miorin/dsh-atlas-continuity', 'dsh-atlas-continuity'],
    ['visual', '@miorin/dsh-atlas-visual', 'dsh-atlas-visual'],
  ] as const) {
    const { manager, profile, writes } = fixture()
    assert.equal(ATLAS_BUNDLES[atlas], name)
    const existing = newBundle(name, { source: `link:/atlas/${dir}` })
    profile.set(name, existing)
    assert.equal(await setAtlasEnabled(manager, atlas, true, ignoreProgress), undefined)
    assert.equal(await setAtlasEnabled(manager, atlas, false, ignoreProgress), undefined)
    assert.equal(profile.get(name)!.source, existing.source)
    assert.deepEqual(writes, [['set', name, true], ['set', name, false]])
  }
})

test('reports row conflict when enabling Visual while a standalone member is enabled', async () => {
  const visual = ATLAS_BUNDLES.visual
  const standalone = newBundle('@miorin/dsh-claudelike-ui', { enabled: true, rows: [{ rowId: 'dsh-claudelike-ui' }] })
  const { manager, profile, writes } = fixture([
    newBundle(visual, { rows: [{ rowId: 'dsh-claudelike-ui' }, { rowId: 'dsh-peak-pricing-sidebar' }] }),
    standalone,
  ])
  assert.deepEqual(await setAtlasEnabled(manager, 'visual', true, ignoreProgress), {
    kind: 'conflict',
    bundle: '@miorin/dsh-claudelike-ui',
    row: 'dsh-claudelike-ui',
  })
  assert.equal(profile.get(visual)!.enabled, false)
  assert.deepEqual(writes, [])
})

test('keeps standalone Continuity members untouched until their bundle selections are off', async () => {
  const continuity = ATLAS_BUNDLES.continuity
  const rows = [{ rowId: 'dsh-vcs-panel' }, { rowId: 'dsh-sideby-note' }]
  const standalone = rows.map(row => newBundle(`@miorin/${row.rowId}`, { enabled: true, rows: [row] }))
  const { manager, profile, writes } = fixture([newBundle(continuity, { rows }), ...standalone])
  for (const member of standalone) {
    assert.deepEqual(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), { kind: 'continuityConflict' })
    assert.equal(profile.get(member.name as string), member)
    assert.equal(profile.get(continuity)!.enabled, false)
    assert.deepEqual(writes, [])
    profile.set(member.name as string, { ...member, enabled: false })
  }
  assert.equal(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), undefined)
  assert.deepEqual(writes, [['set', continuity, true]])
})

test('toggles a locally linked List Atlas without installing from npm', async () => {
  const list = ATLAS_BUNDLES.list
  const { manager, profile, writes } = fixture([newBundle(list, { source: 'link:/atlas/dsh-atlas-list' })])
  assert.equal(await setAtlasEnabled(manager, 'list', true, ignoreProgress), undefined)
  assert.equal(profile.get(list)!.enabled, true)
  assert.equal(await setAtlasEnabled(manager, 'list', false, ignoreProgress), undefined)
  assert.equal(profile.get(list)!.enabled, false)
  assert.deepEqual(writes, [['set', list, true], ['set', list, false]])
})

test('only uninstalls the requested installed, disabled, removable Atlas', async () => {
  const entry = newBundle(workspace, { removable: true, source: 'link:/work/dsh-atlas-workspace' })
  const unrelated = newBundle(ATLAS_BUNDLES.list, { enabled: true })
  const { manager, profile, writes } = fixture([entry, unrelated])
  assert.equal(canUninstallAtlas(entry as never), true)
  for (const invalid of [
    { ...entry, enabled: true }, { ...entry, installed: false },
    { ...entry, removable: false }, { ...entry, readOnlyReason: 'management-required' }, undefined,
  ]) {
    if (invalid === undefined) profile.delete(workspace)
    else profile.set(workspace, invalid)
    assert.equal(canUninstallAtlas(invalid as never), false)
    assert.deepEqual(await uninstallAtlas(manager, 'workspace'), { kind: 'uninstallUnavailable' })
    assert.equal(profile.get(workspace), invalid)
    assert.deepEqual(writes, [])
  }
  profile.set(workspace, entry)
  assert.equal(await uninstallAtlas(manager, 'workspace'), undefined)
  assert.deepEqual(writes, [['remove', workspace]])
  assert.equal(profile.has(workspace), false)
  assert.equal(profile.get(ATLAS_BUNDLES.list), unrelated)
  assert.equal(profile.get(PACKAGE)!.enabled, true)
})

test('reports the DSH diagnosis when uninstalling fails', async () => {
  const entry = newBundle(workspace, { removable: true })
  const { manager, profile } = fixture([entry])
  manager.removeBundle = async () => success({ application: 'failed', error: { code: 'bundle-in-use' } })
  assert.deepEqual(await uninstallAtlas(manager, 'workspace'), { kind: 'uninstallFailed', detail: 'bundle-in-use' })
  assert.equal(profile.get(workspace), entry)
})

test('reports missing files for a declared dependency without replacing it', async () => {
  const entry = newBundle(workspace, { availability: 'missing' })
  const { manager, profile, writes } = fixture([entry])
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), { kind: 'bundleMissing' })
  assert.deepEqual(writes, [])
  assert.deepEqual(profile.get(workspace), entry)
})

test('reuses the bundle installed by a concurrent operation', async () => {
  const { manager, profile, writes } = fixture()
  manager.installBundle = async () => {
    profile.set(workspace, newBundle(workspace))
    return success({ application: 'failed', changed: false, error: { code: 'already-installed' } })
  }
  assert.equal(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), undefined)
  assert.deepEqual(writes, [['set', workspace, true]])
})

test('leaves an installed dependency off when an active bundle already owns one of its row IDs', async () => {
  const member = newBundle('some-other-bundle', { enabled: true, rows: [{ rowId: 'workspace-switcher' }] })
  const { manager, profile, writes } = fixture([member])
  const notice = await setAtlasEnabled(manager, 'workspace', true, ignoreProgress)
  assert.deepEqual(notice, { kind: 'conflict', bundle: member.name, row: 'workspace-switcher' })
  assert.equal(profile.get(workspace)!.installed, true)
  assert.equal(profile.get(workspace)!.enabled, false)
  assert.equal(profile.get(member.name as string)!.enabled, true)
  assert.deepEqual(writes.map(([operation]) => operation), ['install'])
})

test('surfaces npm installation failure and skips enablement', async () => {
  const { manager, profile, writes } = fixture()
  manager.installBundle = async () => success({ application: 'failed', error: { diagnostic: 'registry unavailable' } })
  const notice = await setAtlasEnabled(manager, 'workspace', true, ignoreProgress)
  assert.deepEqual(notice, { kind: 'installFailed', detail: 'registry unavailable' })
  assert.deepEqual(writes, [])
  assert.equal(profile.has(workspace), false)
})

test('restores selection when enablement fails after saving and keeps the package installed', async () => {
  const { manager, profile, writes } = fixture([newBundle(workspace)])
  const set = manager.setBundleEnabled.bind(manager)
  manager.setBundleEnabled = async (name: string, enabled: boolean) => {
    const result = await set(name, enabled)
    return enabled ? success({ application: 'failed', changed: true, error: { diagnostic: 'duplicate row' } }) : result
  }
  const notice = await setAtlasEnabled(manager, 'workspace', true, ignoreProgress)
  assert.deepEqual(notice, { kind: 'enableFailed', detail: 'duplicate row' })
  assert.equal(profile.get(workspace)!.installed, true)
  assert.equal(profile.get(workspace)!.enabled, false)
  assert.deepEqual(writes, [['set', workspace, true], ['set', workspace, false]])
})

test('reports when a saved selection needs restart', async () => {
  const { manager } = fixture([newBundle(workspace)])
  manager.setBundleEnabled = async () => success({ application: 'restart-required', changed: true })
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), { kind: 'restart' })
})

test('preserves existing npm registry source when toggling an installed Atlas', async () => {
  const existing = newBundle(workspace, { source: `${workspace}@0.1.0`, update: 'registry', version: '0.1.0', enabled: false })
  const { manager, profile, writes } = fixture([existing])
  assert.equal(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), undefined)
  assert.equal(await setAtlasEnabled(manager, 'workspace', false, ignoreProgress), undefined)
  assert.equal(profile.get(workspace)!.source, `${workspace}@0.1.0`)
  assert.deepEqual(writes, [['set', workspace, true], ['set', workspace, false]])
})

test('discovers installed enabled and disabled dsh.aggregate bundles from profile and link paths', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-discover-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const linkedCustom = join(root, 'local-custom')
  const registryCustom = join(profileDir, 'node_modules', '@third', 'reg-agg')
  const standaloneDir = join(profileDir, 'node_modules', '@third', 'plain-plugin')
  const emptyAggDir = join(profileDir, 'node_modules', '@third', 'empty-agg')
  const managerDir = join(profileDir, 'node_modules', '@miorin', 'dsh-atlas-atlas')

  mkdirSync(linkedCustom, { recursive: true })
  mkdirSync(registryCustom, { recursive: true })
  mkdirSync(standaloneDir, { recursive: true })
  mkdirSync(emptyAggDir, { recursive: true })
  mkdirSync(managerDir, { recursive: true })

  writeFileSync(join(linkedCustom, 'package.json'), JSON.stringify({
    name: '@local/custom-bundle',
    version: '0.1.0',
    dsh: { aggregate: { version: 1, plugins: ['@local/a', '@local/b'] } },
  }))
  writeFileSync(join(registryCustom, 'package.json'), JSON.stringify({
    name: '@third/reg-agg',
    version: '0.2.0',
    dsh: { aggregate: { version: 1, plugins: ['@third/x', '@third/y', '@third/z'] } },
  }))
  writeFileSync(join(standaloneDir, 'package.json'), JSON.stringify({
    name: '@third/plain-plugin',
    version: '0.1.0',
    dsh: { client: { platform: 'web' } },
  }))
  writeFileSync(join(emptyAggDir, 'package.json'), JSON.stringify({
    name: '@third/empty-agg',
    version: '0.1.0',
    dsh: { aggregate: { version: 1, plugins: [] } },
  }))
  writeFileSync(join(managerDir, 'package.json'), JSON.stringify({
    name: '@miorin/dsh-atlas-atlas',
    version: '0.2.1',
    dsh: { aggregate: { version: 1, plugins: ['@miorin/fake'] } },
  }))

  const discovered = await discoverInstalledAggregates({
    async listBundles() {
      return [
        { name: PACKAGE, installed: true, availability: 'profile', enabled: true, source: `${PACKAGE}@0.2.1`, rows: [] },
        { name: '@local/custom-bundle', installed: true, availability: 'profile', enabled: false, source: `link:${linkedCustom}`, rows: [] },
        { name: '@third/reg-agg', installed: true, availability: 'profile', enabled: true, source: '@third/reg-agg@0.2.0', rows: [] },
        { name: '@third/plain-plugin', installed: true, availability: 'profile', enabled: true, source: '@third/plain-plugin@0.1.0', rows: [] },
        { name: '@third/empty-agg', installed: true, availability: 'profile', enabled: true, source: '@third/empty-agg@0.1.0', rows: [] },
        { name: '@third/relative-link', installed: true, availability: 'profile', enabled: true, source: 'link:../rel', rows: [] },
        { name: '@third/missing-files', installed: true, availability: 'missing', enabled: false, source: '@third/missing-files@0.1.0', rows: [] },
      ] as never
    },
  }, profileDir)

  assert.deepEqual(discovered, [
    { packageName: '@local/custom-bundle', memberCount: 2 },
    { packageName: '@third/reg-agg', memberCount: 3 },
  ])
})
