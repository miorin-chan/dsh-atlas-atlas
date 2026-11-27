import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isScalar, parseDocument } from 'yaml'
import { readCheckedBundle, resolveInstalledDependency } from '../lib/bundle-inspector.js'
import { LocalDevError } from '../lib/local-dev-types.js'
import { allocateOverlayDir, buildLocalOverlay, gcOverlays, isManagedOverlayDir } from '../lib/overlay-builder.js'

function writePlugin(dir: string, name: string, patchYaml: string, extraDeps: Record<string, string> = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.js'), `export const name = ${JSON.stringify(name)}; export function apply() {}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), patchYaml)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.js' },
    dependencies: extraDeps,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
}

test('builds overlay with regenerated YAML AST patch and local member symlinks', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-overlay-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const installedDir = join(root, 'installed-agg')
  const externalDep = join(root, 'external-shared-dep')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(externalDep, { recursive: true })
  writeFileSync(join(externalDep, 'package.json'), JSON.stringify({ name: 'shared-helper', version: '1.0.0' }))

  writePlugin(
    join(workspaceDir, 'member-a'),
    '@miorin/member-a',
    `- insert:\n    - id: member-a\n      name: '@miorin/member-a'\n      config:\n        mode: !!js "process.platform"\n`,
  )
  writePlugin(
    join(workspaceDir, 'member-b'),
    '@miorin/member-b',
    `- insert:\n    - id: member-b\n      name: '@miorin/member-b'\n`,
  )

  mkdirSync(installedDir, { recursive: true })
  writeFileSync(join(installedDir, 'index.js'), 'export const name = "@miorin/dsh-atlas-demo"; export function apply() {}\n')
  writeFileSync(join(installedDir, 'client.js'), 'window.__ModuleLoader__.load({ id: "@miorin/dsh-atlas-demo", factory: () => ({}) });\n')
  writeFileSync(join(installedDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: member-a',
    "      name: '@miorin/member-a'",
    '    - id: member-b',
    "      name: '@miorin/member-b'",
    '    - id: dsh-atlas-demo',
    "      name: '@miorin/dsh-atlas-demo'",
    '',
  ].join('\n'))
  writeFileSync(join(installedDir, 'package.json'), `${JSON.stringify({
    name: '@miorin/dsh-atlas-demo',
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dependencies: {
      '@miorin/member-a': '0.1.0',
      '@miorin/member-b': '0.1.0',
      'shared-helper': '1.0.0',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true },
      aggregate: { version: 1, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/member-a', '@miorin/member-b'] },
    },
  }, null, 2)}\n`)
  mkdirSync(join(installedDir, 'node_modules'), { recursive: true })
  symlinkSync(externalDep, join(installedDir, 'node_modules', 'shared-helper'), 'junction')

  const baseBundle = await readCheckedBundle(installedDir, '@miorin/dsh-atlas-demo')
  const built = await buildLocalOverlay({ profileDir, baseBundle, workspaceDir })

  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-a'), join(workspaceDir, 'member-a'))
  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-b'), join(workspaceDir, 'member-b'))
  assert.equal(await resolveInstalledDependency(built.overlayDir, 'shared-helper'), externalDep)
  assert.equal(await isManagedOverlayDir(profileDir, '@miorin/dsh-atlas-demo', built.overlayDir), true)

  const patchDoc = parseDocument(readFileSync(join(built.overlayDir, 'cordis.patch.yml'), 'utf8'))
  assert.deepEqual(patchDoc.errors, [])
  const rows = (patchDoc.contents as { items: Array<{ get: (k: string, keep?: boolean) => { items: Array<{ get: (k: string) => unknown; getIn: (p: string[], keep?: boolean) => unknown }> } }> }).items[0].get('insert', true).items
  assert.deepEqual(rows.map(r => r.get('id')), ['member-a', 'member-b', 'dsh-atlas-demo'])
  const modeVal = rows[0].getIn(['config', 'mode'], true)
  assert.ok(isScalar(modeVal))
  assert.equal(modeVal.tag, 'tag:yaml.org,2002:js')
})

test('rejects missing member checkout and volatile profile-owned non-member dependency', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-overlay-err-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const installedDir = join(root, 'installed-agg')
  const profileOwnedDep = join(profileDir, 'node_modules', 'volatile-dep')
  mkdirSync(profileOwnedDep, { recursive: true })
  writeFileSync(join(profileOwnedDep, 'package.json'), JSON.stringify({ name: 'volatile-dep', version: '1.0.0' }))

  writePlugin(join(workspaceDir, 'member-a'), '@miorin/member-a', '- insert:\n    - id: member-a\n      name: "@miorin/member-a"\n')
  mkdirSync(installedDir, { recursive: true })
  writeFileSync(join(installedDir, 'index.js'), 'export const name = "@miorin/agg"; export function apply() {}\n')
  writeFileSync(join(installedDir, 'cordis.patch.yml'), '- insert:\n    - id: member-a\n      name: "@miorin/member-a"\n')
  writeFileSync(join(installedDir, 'package.json'), `${JSON.stringify({
    name: '@miorin/agg',
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.js' },
    dependencies: { '@miorin/member-a': '0.1.0', 'volatile-dep': '1.0.0' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      aggregate: { version: 1, runtimeRowId: 'agg', plugins: ['@miorin/member-a', '@miorin/missing-b'] },
    },
  }, null, 2)}\n`)
  mkdirSync(join(installedDir, 'node_modules'), { recursive: true })
  symlinkSync(profileOwnedDep, join(installedDir, 'node_modules', 'volatile-dep'), 'junction')

  const baseBundle = await readCheckedBundle(installedDir, '@miorin/agg')
  await assert.rejects(
    () => buildLocalOverlay({ profileDir, baseBundle, workspaceDir }),
    (err: unknown) => err instanceof LocalDevError && err.code === 'missing-checkout',
  )

  writePlugin(join(workspaceDir, 'missing-b'), '@miorin/missing-b', '- insert:\n    - id: missing-b\n      name: "@miorin/missing-b"\n')
  await assert.rejects(
    () => buildLocalOverlay({ profileDir, baseBundle, workspaceDir }),
    (err: unknown) => err instanceof LocalDevError && err.code === 'overlay-failed' && /prune/i.test(err.message),
  )
})

test('applies dsh.aggregate.defaults when regenerating local-dev overlay patch', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-overlay-defaults-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const installedDir = join(root, 'installed-agg')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(installedDir, { recursive: true })

  writePlugin(
    join(workspaceDir, 'member-a'),
    '@miorin/member-a',
    `- insert:\n    - id: member-a\n      name: '@miorin/member-a'\n      disabled: true\n`,
  )
  writePlugin(
    join(workspaceDir, 'member-b'),
    '@miorin/member-b',
    `- insert:\n    - id: member-b\n      name: '@miorin/member-b'\n`,
  )

  writeFileSync(join(installedDir, 'index.js'), 'export const name = "@miorin/dsh-atlas-demo"; export function apply() {}\n')
  writeFileSync(join(installedDir, 'client.js'), 'window.__ModuleLoader__.load({ id: "@miorin/dsh-atlas-demo", factory: () => ({}) });\n')
  writeFileSync(join(installedDir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n')
  writeFileSync(join(installedDir, 'package.json'), `${JSON.stringify({
    name: '@miorin/dsh-atlas-demo',
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dependencies: {
      '@miorin/member-a': '0.1.0',
      '@miorin/member-b': '0.1.0',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true },
      aggregate: {
        version: 1,
        runtimeRowId: 'dsh-atlas-demo',
        plugins: ['@miorin/member-a', '@miorin/member-b'],
        defaults: { '@miorin/member-a': true, '@miorin/member-b': false },
      },
    },
  }, null, 2)}\n`)

  const baseBundle = await readCheckedBundle(installedDir, '@miorin/dsh-atlas-demo')
  const built = await buildLocalOverlay({ profileDir, baseBundle, workspaceDir })

  const patchDoc = parseDocument(readFileSync(join(built.overlayDir, 'cordis.patch.yml'), 'utf8'))
  assert.deepEqual(patchDoc.errors, [])
  const rows = (patchDoc.contents as { items: Array<{ get: (k: string, keep?: boolean) => { items: Array<{ get: (k: string) => unknown; has: (k: string) => boolean }> } }> }).items[0].get('insert', true).items
  assert.equal(rows[0].get('id'), 'member-a')
  assert.equal(rows[0].has('disabled'), false)
  assert.equal(rows[1].get('id'), 'member-b')
  assert.equal(rows[1].get('disabled'), true)
  assert.equal(rows[2].get('id'), 'dsh-atlas-demo')
  assert.equal(rows[2].has('disabled'), false)
})

test('allocates, identifies, and garbage-collects managed overlay directories', async t => {
  const profileDir = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-overlay-gc-')))
  t.after(() => rmSync(profileDir, { recursive: true, force: true }))

  const pkg = '@miorin/dsh-atlas-list'
  const overlayA = await allocateOverlayDir(profileDir, pkg)
  const overlayB = await allocateOverlayDir(profileDir, pkg)
  assert.equal(existsSync(overlayA), true)
  assert.equal(existsSync(overlayB), true)
  assert.equal(await isManagedOverlayDir(profileDir, pkg, overlayA), true)
  assert.equal(await isManagedOverlayDir(profileDir, pkg, overlayB), true)
  assert.equal(await isManagedOverlayDir(profileDir, pkg, join(overlayB, '..')), false)
  assert.equal(await isManagedOverlayDir(profileDir, pkg, join(profileDir, 'other')), false)

  await gcOverlays(profileDir, pkg, overlayB)
  assert.equal(existsSync(overlayA), false)
  assert.equal(existsSync(overlayB), true)

  await gcOverlays(profileDir, pkg, undefined)
  assert.equal(existsSync(overlayB), false)
  assert.equal(existsSync(join(overlayB, '..')), false)
})

test('builds selective partial-local overlay keeping non-local members linked from baseBundle node_modules', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-overlay-partial-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const profileDir = join(root, 'profile')
  const workspaceDir = join(root, 'workspace')
  const baseDir = join(workspaceDir, 'dsh-atlas-demo')
  mkdirSync(profileDir, { recursive: true })

  // Local member-a with !!js tag; member-b is ONLY installed inside baseDir/node_modules/.pnpm (not cloned in workspace).
  writePlugin(
    join(workspaceDir, 'member-a'),
    '@miorin/member-a',
    `- insert:\n    - id: member-a\n      name: '@miorin/member-a'\n      config:\n        mode: !!js "process.platform"\n`,
  )
  const pnpmMemberB = join(baseDir, 'node_modules', '.pnpm', 'miorin+member-b@0.1.0', 'node_modules', '@miorin', 'member-b')
  writePlugin(
    pnpmMemberB,
    '@miorin/member-b',
    `- insert:\n    - id: member-b\n      name: '@miorin/member-b'\n      config:\n        bundled: true\n`,
  )

  mkdirSync(baseDir, { recursive: true })
  writeFileSync(join(baseDir, 'index.js'), 'export const name = "@miorin/dsh-atlas-demo"; export function apply() {}\n')
  writeFileSync(join(baseDir, 'client.js'), 'window.__ModuleLoader__.load({ id: "@miorin/dsh-atlas-demo", factory: () => ({}) });\n')
  writeFileSync(join(baseDir, 'cordis.patch.yml'), '- insert:\n    - id: dsh-atlas-demo\n      name: "@miorin/dsh-atlas-demo"\n')
  writeFileSync(join(baseDir, 'package.json'), `${JSON.stringify({
    name: '@miorin/dsh-atlas-demo',
    version: '0.1.0',
    type: 'module',
    exports: { '.': './index.js', './client': './client.js' },
    dependencies: {
      '@miorin/member-a': '0.1.0',
      '@miorin/member-b': '0.1.0',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true },
      aggregate: { version: 1, runtimeRowId: 'dsh-atlas-demo', plugins: ['@miorin/member-a', '@miorin/member-b'] },
    },
  }, null, 2)}\n`)
  mkdirSync(join(baseDir, 'node_modules', '@miorin'), { recursive: true })
  symlinkSync(pnpmMemberB, join(baseDir, 'node_modules', '@miorin', 'member-b'), 'junction')

  const baseBundle = await readCheckedBundle(baseDir, '@miorin/dsh-atlas-demo')
  const built = await buildLocalOverlay({
    profileDir,
    baseBundle,
    workspaceDir,
    localMembers: new Set(['@miorin/member-a']),
  })

  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-a'), join(workspaceDir, 'member-a'))
  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-b'), pnpmMemberB)

  const patchDoc = parseDocument(readFileSync(join(built.overlayDir, 'cordis.patch.yml'), 'utf8'))
  assert.deepEqual(patchDoc.errors, [])
  const rows = (patchDoc.contents as { items: Array<{ get: (k: string, keep?: boolean) => { items: Array<{ get: (k: string) => unknown; getIn: (p: string[], keep?: boolean) => unknown }> } }> }).items[0].get('insert', true).items
  assert.deepEqual(rows.map(r => r.get('id')), ['member-a', 'member-b', 'dsh-atlas-demo'])
  const modeVal = rows[0].getIn(['config', 'mode'], true)
  assert.ok(isScalar(modeVal))
  assert.equal(modeVal.tag, 'tag:yaml.org,2002:js')
  assert.equal(rows[1].getIn(['config', 'bundled']), true)

  // Missing bundled dependency throws overlay-failed when member is excluded from localMembers.
  await assert.rejects(
    () => buildLocalOverlay({
      profileDir,
      baseBundle,
      workspaceDir,
      localMembers: new Set(),
    }),
    (err: unknown) => err instanceof LocalDevError && err.code === 'overlay-failed',
  )
})
