import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ATLAS_BUNDLES,
  PACKAGE,
  canUninstallAtlas,
  normalizeWorkspaceDir,
  setAtlasEnabled,
  uninstallAtlas,
} from '../lib/atlas.js'

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
    async inspect(spec, options) {
      assert.equal(arguments.length, 2)
      assert.deepEqual(options, {})
      writes.push(['inspect', spec])
      if (spec.startsWith('link:')) {
        const parts = spec.slice(5).split(/[\\/]/).filter(Boolean)
        const basename = parts[parts.length - 1] ?? ''
        return success({ status: 'accepted', kind: 'path', name: `@miorin/${basename}`, version: '0.1.0', bundle: true })
      }
      return success({ status: 'accepted', kind: 'registry', name: spec, version: '0.1.0', bundle: true })
    },
    async installBundle(spec, options) {
      writes.push(['install', spec, options])
      const name = options?.expected?.name ?? spec
      profile.set(name, newBundle(name, {
        source: spec,
        rows: [{ rowId: name === workspace ? 'workspace-switcher' : name }],
      }))
      return applied
    },
    async setBundleEnabled(name, enabled) {
      writes.push(['set', name, enabled])
      profile.set(name, { ...profile.get(name), enabled })
      return applied
    },
    async removeBundle(name) {
      writes.push(['remove', name])
      profile.delete(name)
      return applied
    },
  }
  return { manager, profile, writes }
}

const ignoreProgress = () => {}

test('installs and enables each missing Atlas from the npm registry and reuses it on the next enable', async () => {
  assert.deepEqual(Object.keys(ATLAS_BUNDLES), ['workspace', 'session', 'list', 'plugin', 'mobile', 'continuity', 'visual'])
  assert.equal(ATLAS_BUNDLES.list, '@miorin/dsh-atlas-list')
  const { manager, profile, writes } = fixture()
  const registryAtlases = Object.entries(ATLAS_BUNDLES)
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
    assert.equal(profile.get(name).source, existing.source)
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
  assert.equal(profile.get(visual).enabled, false)
  assert.deepEqual(writes, [])
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

test('only uninstalls the requested installed, disabled, removable Atlas', async () => {
  const entry = newBundle(workspace, { removable: true, source: 'link:/work/dsh-atlas-workspace' })
  const unrelated = newBundle(ATLAS_BUNDLES.list, { enabled: true })
  const { manager, profile, writes } = fixture([entry, unrelated])
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

test('installs and enables uninstalled Atlases including Continuity via prepareLocal without npm when localDevEnabled is true', async () => {
  assert.equal(normalizeWorkspaceDir('  /repos/plugins/  '), '/repos/plugins')
  assert.equal(normalizeWorkspaceDir('relative/path'), undefined)

  const { manager, profile, writes } = fixture()
  const stages = []
  const preparedCalls: string[] = []
  const prepareLocal = async (packageName: string) => {
    preparedCalls.push(packageName)
    const dir = packageName.slice(packageName.indexOf('/') + 1)
    return { ok: true as const, spec: `link:/profile/overlays/${dir}`, version: '0.1.0' }
  }

  assert.equal(
    await setAtlasEnabled(manager, 'workspace', true, stage => stages.push(stage), {
      localDevEnabled: true,
      localWorkspaceDir: '/repos/plugins/',
      prepareLocal,
    }),
    undefined,
  )
  assert.deepEqual(stages, ['installing', 'enabling'])
  assert.equal(profile.get(workspace).source, 'link:/profile/overlays/dsh-atlas-workspace')
  assert.equal(profile.get(workspace).enabled, true)
  assert.deepEqual(writes.splice(0), [
    ['inspect', 'link:/profile/overlays/dsh-atlas-workspace'],
    ['install', 'link:/profile/overlays/dsh-atlas-workspace', { enabled: false, expected: { name: workspace, version: '0.1.0' } }],
    ['set', workspace, true],
  ])

  const continuity = ATLAS_BUNDLES.continuity
  assert.equal(
    await setAtlasEnabled(manager, 'continuity', true, ignoreProgress, {
      localDevEnabled: true,
      localWorkspaceDir: 'C:\\work\\plugins\\',
      prepareLocal: async () => ({
        ok: true,
        spec: 'link:C:\\work\\plugins\\dsh-atlas-continuity',
        version: '0.1.0',
      }),
    }),
    undefined,
  )
  assert.equal(profile.get(continuity).source, 'link:C:\\work\\plugins\\dsh-atlas-continuity')
  assert.equal(profile.get(continuity).enabled, true)
  assert.deepEqual(writes.splice(0), [
    ['inspect', 'link:C:\\work\\plugins\\dsh-atlas-continuity'],
    ['install', 'link:C:\\work\\plugins\\dsh-atlas-continuity', { enabled: false, expected: { name: continuity, version: '0.1.0' } }],
    ['set', continuity, true],
  ])

  const visual = ATLAS_BUNDLES.visual
  assert.equal(
    await setAtlasEnabled(manager, 'visual', true, ignoreProgress, {
      localDevEnabled: true,
      localWorkspaceDir: '/repos/plugins/',
      prepareLocal,
    }),
    undefined,
  )
  assert.equal(profile.get(visual).source, 'link:/profile/overlays/dsh-atlas-visual')
  assert.equal(profile.get(visual).enabled, true)
  assert.deepEqual(preparedCalls, [workspace, visual])
  assert.deepEqual(writes, [
    ['inspect', 'link:/profile/overlays/dsh-atlas-visual'],
    ['install', 'link:/profile/overlays/dsh-atlas-visual', { enabled: false, expected: { name: visual, version: '0.1.0' } }],
    ['set', visual, true],
  ])
})

test('blocks enabling uninstalled Atlases without npm fallback when localDevEnabled is true and localWorkspaceDir is missing or invalid', async () => {
  const { manager, profile, writes } = fixture()
  for (const localWorkspaceDir of [undefined, '', '   ', 'relative/plugins']) {
    for (const atlas of ['workspace', 'continuity', 'visual']) {
      assert.deepEqual(
        await setAtlasEnabled(manager, atlas, true, ignoreProgress, { localDevEnabled: true, localWorkspaceDir }),
        { kind: 'localWorkspaceRequired' },
      )
    }
  }
  assert.deepEqual(writes, [])
  assert.equal(profile.has(workspace), false)
  assert.equal(profile.has(ATLAS_BUNDLES.continuity), false)
  assert.equal(profile.has(ATLAS_BUNDLES.visual), false)
})

test('surfaces localLinkFailed without npm fallback when prepareLocal or local checkout inspection fails', async () => {
  const { manager, profile, writes } = fixture()
  assert.deepEqual(
    await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, {
      localDevEnabled: true,
      localWorkspaceDir: '/repos',
      prepareLocal: async () => ({ ok: false, detail: 'missing member checkout' }),
    }),
    { kind: 'localLinkFailed', detail: 'missing member checkout' },
  )
  assert.deepEqual(writes, [])

  const prepareLocal = async () => ({ ok: true as const, spec: 'link:/repos/dsh-atlas-workspace', version: '0.1.0' })
  manager.inspect = async function (spec, options) {
    assert.equal(arguments.length, 2)
    assert.deepEqual(options, {})
    writes.push(['inspect', spec])
    return success({ status: 'refused', reason: 'missing package.json' })
  }
  assert.deepEqual(
    await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, {
      localDevEnabled: true,
      localWorkspaceDir: '/repos',
      prepareLocal,
    }),
    { kind: 'localLinkFailed', detail: 'missing package.json' },
  )
  assert.deepEqual(writes.splice(0), [['inspect', 'link:/repos/dsh-atlas-workspace']])

  manager.inspect = async function (spec, options) {
    assert.equal(arguments.length, 2)
    assert.deepEqual(options, {})
    writes.push(['inspect', spec])
    return success({ status: 'accepted', kind: 'registry', name: workspace, version: '0.1.0', bundle: true })
  }
  assert.deepEqual(
    await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, {
      localDevEnabled: true,
      localWorkspaceDir: '/repos',
      prepareLocal,
    }),
    { kind: 'localLinkFailed', detail: 'link:/repos/dsh-atlas-workspace' },
  )
  assert.deepEqual(writes, [['inspect', 'link:/repos/dsh-atlas-workspace']])
  assert.equal(profile.has(workspace), false)
})

test('preserves existing baseline npm source when toggling an installed Atlas in local mode', async () => {
  const existing = newBundle(workspace, { source: `${workspace}@0.1.0`, update: 'registry', version: '0.1.0', enabled: false })
  const { manager, profile, writes } = fixture([existing])
  assert.equal(
    await setAtlasEnabled(manager, 'workspace', true, ignoreProgress, { localDevEnabled: true, localWorkspaceDir: '/repos' }),
    undefined,
  )
  assert.equal(
    await setAtlasEnabled(manager, 'workspace', false, ignoreProgress, { localDevEnabled: true, localWorkspaceDir: '/repos' }),
    undefined,
  )
  assert.equal(profile.get(workspace).source, `${workspace}@0.1.0`)
  assert.deepEqual(writes, [['set', workspace, true], ['set', workspace, false]])
})
