import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ATLAS_BUNDLES, PACKAGE, canUninstallAtlas, isLocalOnlyAtlas, linkAtlas, localAtlasSpec, setAtlasEnabled, uninstallAtlas } from '../lib/atlas.js'

const workspace = ATLAS_BUNDLES.workspace
const success = value => ({ ok: true, value })
const applied = success({ application: 'applied', changed: true })
const newBundle = (name, options = {}) => ({
  name, installed: true, availability: 'profile', enabled: false, rows: [], ...options,
})

function fixture(others = []) {
  const profile = new Map([newBundle(PACKAGE, { enabled: true }), ...others].map(bundle => [bundle.name, bundle]))
  const writes = []
  const manager = {
    listBundles: async () => success([...profile.values()]),
    async installBundle(name, options) {
      writes.push(['install', name, options])
      profile.set(name, newBundle(name, { rows: [{ rowId: name === workspace ? 'workspace-switcher' : name }] }))
      return applied
    },
    async setBundleEnabled(name, enabled) {
      writes.push(['set', name, enabled])
      profile.set(name, { ...profile.get(name), enabled })
      return applied
    },
  }
  return { manager, profile, writes }
}

const ignoreProgress = () => {}

test('installs and enables each missing Atlas from the npm registry and reuses it on the next enable', async () => {
  assert.deepEqual(Object.keys(ATLAS_BUNDLES), ['workspace', 'session', 'list', 'plugin', 'mobile', 'continuity'])
  assert.equal(ATLAS_BUNDLES.list, '@miorin/dsh-atlas-list')
  const { manager, profile, writes } = fixture()
  const registryAtlases = Object.entries(ATLAS_BUNDLES).filter(([atlas]) => !isLocalOnlyAtlas(atlas))
  for (const [atlas, name] of registryAtlases) {
    const stages = []
    assert.equal(await setAtlasEnabled(manager, atlas, true, stage => stages.push(stage)), undefined)
    assert.deepEqual(stages, ['installing', 'enabling'])
    assert.equal(profile.get(name).enabled, true)
    assert.equal(await setAtlasEnabled(manager, atlas, false, ignoreProgress), undefined)
    assert.equal(profile.get(name).installed, true)
    assert.equal(profile.get(name).enabled, false)
    assert.equal(await setAtlasEnabled(manager, atlas, true, ignoreProgress), undefined)
    assert.deepEqual(writes.splice(0), [
      ['install', name, { registry: 'https://registry.npmjs.org/', saveExact: true, enabled: false }],
      ['set', name, true], ['set', name, false], ['set', name, true],
    ])
  }
  assert.equal(profile.get(PACKAGE).enabled, true)
  assert.ok(registryAtlases.every(([, name]) => profile.get(name).enabled))
})

test('requires a local copy of Continuity but can toggle an existing link without changing sources', async () => {
  const name = '@miorin/dsh-atlas-continuity'
  const { manager, profile, writes } = fixture()
  assert.equal(ATLAS_BUNDLES.continuity, name)
  assert.deepEqual(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), { kind: 'localInstallRequired' })
  assert.deepEqual(writes, [])
  const existing = newBundle(name, { source: 'link:/atlas/dsh-atlas-continuity' })
  profile.set(name, existing)
  assert.equal(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), undefined)
  assert.equal(await setAtlasEnabled(manager, 'continuity', false, ignoreProgress), undefined)
  assert.equal(profile.get(name).source, existing.source)
  assert.deepEqual(writes, [['set', name, true], ['set', name, false]])
})

test('keeps standalone Continuity members untouched until their bundle selections are off', async () => {
  const continuity = ATLAS_BUNDLES.continuity
  const rows = [{ rowId: 'dsh-vcs-panel' }, { rowId: 'dsh-sideby-note' }]
  const standalone = rows.map(row => newBundle(`@miorin/${row.rowId}`, { enabled: true, rows: [row] }))
  const { manager, profile, writes } = fixture([newBundle(continuity, { rows }), ...standalone])
  for (const member of standalone) {
    assert.deepEqual(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), { kind: 'continuityConflict' })
    assert.equal(profile.get(member.name), member)
    assert.equal(profile.get(continuity).enabled, false)
    assert.deepEqual(writes, [])
    profile.set(member.name, { ...member, enabled: false })
  }
  assert.equal(await setAtlasEnabled(manager, 'continuity', true, ignoreProgress), undefined)
  assert.deepEqual(writes, [['set', continuity, true]])
})

test('toggles a locally linked List Atlas without installing from npm', async () => {
  const list = ATLAS_BUNDLES.list
  const { manager, profile, writes } = fixture([newBundle(list, { source: 'link:/atlas/dsh-atlas-list' })])
  assert.equal(await setAtlasEnabled(manager, 'list', true, ignoreProgress), undefined)
  assert.equal(profile.get(list).enabled, true)
  assert.equal(await setAtlasEnabled(manager, 'list', false, ignoreProgress), undefined)
  assert.equal(profile.get(list).enabled, false)
  assert.deepEqual(writes, [['set', list, true], ['set', list, false]])
})

const localParent = '/work/my plugins'
const workspaceSpec = 'link:/work/my plugins/dsh-atlas-workspace'

function localFixture(others = []) {
  const { manager, profile, writes } = fixture(others)
  manager.inspect = async spec => {
    const name = `@miorin/${spec.split('/').at(-1)}`
    return success(profile.has(name)
      ? { status: 'refused', problem: 'already-installed', reason: `${name} is already installed` }
      : { status: 'accepted', kind: 'path', name, bundle: true, version: '0.2.0' })
  }
  manager.removeBundle = async name => {
    writes.push(['remove', name])
    profile.delete(name)
    return applied
  }
  manager.installBundle = async (spec, options) => {
    writes.push(['install', spec, options])
    profile.set(options.expected.name, newBundle(options.expected.name, { removable: true, source: spec }))
    return applied
  }
  return { manager, profile, writes }
}

test('only uninstalls the requested installed, disabled, removable Atlas', async () => {
  const entry = newBundle(workspace, { removable: true, source: workspaceSpec })
  const unrelated = newBundle(ATLAS_BUNDLES.list, { enabled: true })
  const { manager, profile, writes } = localFixture([entry, unrelated])
  assert.equal(canUninstallAtlas(entry), true)
  for (const invalid of [
    { ...entry, enabled: true }, { ...entry, installed: false },
    { ...entry, removable: false }, { ...entry, readOnlyReason: 'management-required' }, undefined,
  ]) {
    if (invalid === undefined) profile.delete(workspace)
    else profile.set(workspace, invalid)
    assert.equal(canUninstallAtlas(invalid), false)
    assert.deepEqual(await uninstallAtlas(manager, 'workspace'), { kind: 'uninstallUnavailable' })
    assert.equal(profile.get(workspace), invalid)
    assert.deepEqual(writes, [])
  }
  profile.set(workspace, entry)
  assert.equal(await uninstallAtlas(manager, 'workspace'), undefined)
  assert.deepEqual(writes, [['remove', workspace]])
  assert.equal(profile.has(workspace), false)
  assert.equal(profile.get(ATLAS_BUNDLES.list), unrelated)
  assert.equal(profile.get(PACKAGE).enabled, true)
})

test('reports the DSH diagnosis when uninstalling fails', async () => {
  const entry = newBundle(workspace, { removable: true })
  const { manager, profile } = localFixture([entry])
  manager.removeBundle = async () => success({ application: 'failed', error: { code: 'bundle-in-use' } })
  assert.deepEqual(await uninstallAtlas(manager, 'workspace'), { kind: 'uninstallFailed', detail: 'bundle-in-use' })
  assert.equal(profile.get(workspace), entry)
})

const workspaceOptions = { enabled: false, expected: { name: workspace, version: '0.2.0' } }

test('forms link targets from absolute repository parents only', () => {
  assert.equal(localAtlasSpec(` ${localParent}/ `, 'workspace'), workspaceSpec)
  assert.equal(localAtlasSpec('/', 'list'), 'link:/dsh-atlas-list')
  assert.equal(localAtlasSpec('C:/checkout/../src/', 'mobile'), 'link:C:\\src\\dsh-atlas-mobile')
  assert.equal(localAtlasSpec('\\\\server\\share\\plugins', 'mobile'), 'link:\\\\server\\share\\plugins\\dsh-atlas-mobile')
  for (const input of ['', 'plugins', '~/plugins', 'https://example.test/plugins', '/work/\u0000plugins']) {
    assert.equal(localAtlasSpec(input, 'workspace'), undefined)
  }
})

test('links each missing Atlas by its repository name without asking npm', async () => {
  const { manager, profile, writes } = localFixture()
  for (const [atlas, name] of Object.entries(ATLAS_BUNDLES)) {
    const spec = `link:${localParent}/${name.split('/')[1]}`
    assert.equal(await setAtlasEnabled(manager, atlas, true, ignoreProgress, localParent), undefined)
    assert.equal(profile.get(name).source, spec)
    assert.deepEqual(writes.splice(0), [
      ['install', spec, { enabled: false, expected: { name, version: '0.2.0' } }], ['set', name, true],
    ])
    assert.equal(await setAtlasEnabled(manager, atlas, true, ignoreProgress, localParent), undefined)
    assert.deepEqual(writes, [])
  }
})

test('switches an existing npm install to a link and preserves its selection', async () => {
  for (const enabled of [true, false]) {
    const entry = newBundle(workspace, { enabled, removable: true, source: `${workspace}@0.2.0` })
    const { manager, profile, writes } = localFixture([entry])
    assert.equal(enabled
      ? await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, localParent)
      : await linkAtlas(manager, 'workspace', localParent, entry), undefined)
    assert.equal(profile.get(workspace).source, workspaceSpec)
    assert.equal(profile.get(workspace).enabled, enabled)
    assert.deepEqual(writes, [
      ['remove', workspace], ['install', workspaceSpec, workspaceOptions], ...enabled ? [['set', workspace, true]] : [],
    ])
  }
})

test('saves local enablement even when the package changes require a restart', async () => {
  const { manager, profile, writes } = localFixture([newBundle(workspace, { removable: true })])
  const { removeBundle, installBundle } = manager
  const restart = success({ application: 'restart-required', changed: true })
  manager.removeBundle = async (...args) => { await removeBundle(...args); return restart }
  manager.installBundle = async (...args) => { await installBundle(...args); return restart }
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, localParent), { kind: 'restart' })
  assert.equal(profile.get(workspace).source, workspaceSpec)
  assert.equal(profile.get(workspace).enabled, true)
  assert.deepEqual(writes, [['remove', workspace], ['install', workspaceSpec, workspaceOptions], ['set', workspace, true]])
})

test('rejects unavailable or unrelated repositories before removing the current copy', async () => {
  const entry = newBundle(workspace, { enabled: true, removable: true })
  const { manager, profile, writes } = localFixture([entry])
  for (const inspection of [
    { status: 'refused', problem: 'not-a-package', reason: 'the path does not exist' },
    { status: 'refused', problem: 'already-installed', reason: `${PACKAGE} is already installed` },
    { status: 'accepted', kind: 'path', name: PACKAGE, version: '0.2.0', bundle: true },
  ]) {
    manager.inspect = async () => success(inspection)
    assert.equal((await linkAtlas(manager, 'workspace', localParent, entry))?.kind, 'localLinkFailed')
    assert.deepEqual(profile.get(workspace), entry)
    assert.deepEqual(writes, [])
  }
})

test('reports a failed link after removal without reinstalling the previous source or falling back to npm', async () => {
  const entry = newBundle(workspace, { enabled: true, removable: true, source: `${workspace}@0.2.0` })
  const { manager, profile, writes } = localFixture([entry])
  manager.installBundle = async (spec, options) => {
    writes.push(['install', spec, options])
    return success({ application: 'failed', error: { diagnostic: 'missing build output' } })
  }
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, localParent), {
    kind: 'localLinkFailed', detail: `${workspaceSpec}\nmissing build output`,
  })
  assert.deepEqual(writes, [['remove', workspace], ['install', workspaceSpec, workspaceOptions]])
  assert.equal(profile.has(workspace), false)
})

test('reports a local enable failure without reverting the selection', async () => {
  const { manager, writes } = localFixture()
  manager.setBundleEnabled = async (name, enabled) => {
    writes.push(['set', name, enabled])
    return success({ application: 'failed', changed: true, error: { diagnostic: 'duplicate row' } })
  }
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, localParent), {
    kind: 'enableFailed', detail: 'duplicate row',
  })
  assert.deepEqual(writes, [['install', workspaceSpec, workspaceOptions], ['set', workspace, true]])
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
  assert.equal(profile.get(workspace).installed, true)
  assert.equal(profile.get(workspace).enabled, false)
  assert.equal(profile.get(member.name).enabled, true)
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
  manager.setBundleEnabled = async (name, enabled) => {
    const result = await set(name, enabled)
    return enabled ? success({ application: 'failed', changed: true, error: { diagnostic: 'duplicate row' } }) : result
  }
  const notice = await setAtlasEnabled(manager, 'workspace', true, ignoreProgress)
  assert.deepEqual(notice, { kind: 'enableFailed', detail: 'duplicate row' })
  assert.equal(profile.get(workspace).installed, true)
  assert.equal(profile.get(workspace).enabled, false)
  assert.deepEqual(writes, [['set', workspace, true], ['set', workspace, false]])
})

test('reports when a saved selection needs restart', async () => {
  const { manager } = fixture([newBundle(workspace)])
  manager.setBundleEnabled = async () => success({ application: 'restart-required', changed: true })
  assert.deepEqual(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), { kind: 'restart' })
})
