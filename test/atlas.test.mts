import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ATLAS_BUNDLES, PACKAGE, setAtlasEnabled } from '../lib/atlas.js'

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
  assert.deepEqual(Object.keys(ATLAS_BUNDLES), ['workspace', 'session', 'plugin', 'mobile', 'runtime'])
  assert.equal(ATLAS_BUNDLES.runtime, '@miorin/dsh-atlas-runtime')
  const { manager, profile, writes } = fixture()
  for (const [atlas, name] of Object.entries(ATLAS_BUNDLES)) {
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
  assert.ok(Object.values(ATLAS_BUNDLES).every(name => profile.get(name).enabled))
})

test('reuses an existing installation even if its source is a local link', async () => {
  const { manager, writes } = fixture([newBundle(workspace, { source: 'link:/atlas/dsh-atlas-workspace' })])
  assert.equal(await setAtlasEnabled(manager, 'workspace', true, ignoreProgress), undefined)
  assert.deepEqual(writes, [['set', workspace, true]])
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
