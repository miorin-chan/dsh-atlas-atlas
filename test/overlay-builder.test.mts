import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isScalar, parseDocument } from 'yaml'
import { readCheckedBundle, resolveInstalledDependency } from '../lib/bundle-inspector.js'
import { LocalDevStore } from '../lib/local-dev-store.js'
import { LocalDevError } from '../lib/local-dev-types.js'
import { buildLocalMembersOverlay } from '../lib/overlay-builder.js'

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

  // Old installed member (stale id/config) vs updated local checkout with !!js tag.
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

  const store = new LocalDevStore(profileDir)
  const baseBundle = await readCheckedBundle(installedDir, '@miorin/dsh-atlas-demo')
  const built = await buildLocalMembersOverlay({ store, profileDir, baseBundle, workspaceDir })

  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-a'), join(workspaceDir, 'member-a'))
  assert.equal(await resolveInstalledDependency(built.overlayDir, '@miorin/member-b'), join(workspaceDir, 'member-b'))
  assert.equal(await resolveInstalledDependency(built.overlayDir, 'shared-helper'), externalDep)

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

  const store = new LocalDevStore(profileDir)
  const baseBundle = await readCheckedBundle(installedDir, '@miorin/agg')
  await assert.rejects(
    () => buildLocalMembersOverlay({ store, profileDir, baseBundle, workspaceDir }),
    (err: unknown) => err instanceof LocalDevError && err.code === 'missing-checkout',
  )

  writePlugin(join(workspaceDir, 'missing-b'), '@miorin/missing-b', '- insert:\n    - id: missing-b\n      name: "@miorin/missing-b"\n')
  await assert.rejects(
    () => buildLocalMembersOverlay({ store, profileDir, baseBundle, workspaceDir }),
    (err: unknown) => err instanceof LocalDevError && err.code === 'overlay-failed' && /prune/i.test(err.message),
  )
})
