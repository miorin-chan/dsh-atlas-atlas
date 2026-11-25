import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalDevStore } from '../lib/local-dev-store.js'
import { LocalDevError, parseLocalDevRequest, type ManagedBundleRecord } from '../lib/local-dev-types.js'

test('reads empty/corrupted state safely, persists records atomically, and garbage-collects overlays', async t => {
  const profileDir = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-store-')))
  t.after(() => rmSync(profileDir, { recursive: true, force: true }))

  const store = new LocalDevStore(profileDir)
  assert.deepEqual(await store.readState(), { version: 1, bundles: {} })

  const overlayA = await store.allocateOverlayDir('@miorin/dsh-atlas-list')
  const overlayB = await store.allocateOverlayDir('@miorin/dsh-atlas-list')
  assert.equal(existsSync(overlayA), true)
  assert.equal(existsSync(overlayB), true)

  const record: ManagedBundleRecord = {
    packageName: '@miorin/dsh-atlas-list',
    isAggregate: true,
    baseline: { spec: '@miorin/dsh-atlas-list@0.1.0', version: '0.1.0', enabled: true },
    selfMode: 'baseline',
    membersMode: 'local',
    activeSpec: `link:${overlayB}`,
    activeVersion: '0.1.0',
    overlayDir: overlayB,
    memberPaths: { '@miorin/dsh-watched-sessions': '/repos/dsh-watched-sessions' },
    updatedAt: '2026-11-25T00:00:00.000Z',
  }
  await store.writeRecord('@miorin/dsh-atlas-list', record)
  assert.deepEqual(await store.readRecord('@miorin/dsh-atlas-list'), record)

  await store.gcOverlays('@miorin/dsh-atlas-list', overlayB)
  assert.equal(existsSync(overlayA), false)
  assert.equal(existsSync(overlayB), true)

  await store.writeRecord('@miorin/dsh-atlas-list', undefined)
  assert.equal(await store.readRecord('@miorin/dsh-atlas-list'), undefined)

  await store.gcOverlays('@miorin/dsh-atlas-list', undefined)
  assert.equal(existsSync(overlayB), false)

  writeFileSync(store.statePath, '{corrupted json')
  assert.deepEqual(await store.readState(), { version: 1, bundles: {} })
})

test('validates local-dev IPC requests and rejects invalid inputs', () => {
  assert.deepEqual(parseLocalDevRequest({ action: 'overview' }), { action: 'overview' })
  assert.deepEqual(parseLocalDevRequest({ action: 'inspect', packageName: '@miorin/a' }), { action: 'inspect', packageName: '@miorin/a' })
  assert.deepEqual(parseLocalDevRequest({ action: 'set-self-mode', packageName: 'alpha', mode: 'local' }), {
    action: 'set-self-mode',
    packageName: 'alpha',
    mode: 'local',
  })
  assert.deepEqual(parseLocalDevRequest({ action: 'set-members-mode', packageName: '@miorin/a', mode: 'bundled' }), {
    action: 'set-members-mode',
    packageName: '@miorin/a',
    mode: 'bundled',
  })
  assert.deepEqual(parseLocalDevRequest({ action: 'reset-drift', packageName: '@miorin/a' }), {
    action: 'reset-drift',
    packageName: '@miorin/a',
  })

  for (const invalid of [
    null,
    [],
    {},
    { action: 'set-self-mode', packageName: '../evil', mode: 'local' },
    { action: 'set-self-mode', packageName: 'alpha', mode: 'invalid' },
    { action: 'set-members-mode', packageName: 'alpha', mode: 'baseline' },
    { action: 'unknown', packageName: 'alpha' },
  ]) {
    assert.throws(() => parseLocalDevRequest(invalid), (err: unknown) => err instanceof LocalDevError && err.code === 'invalid-request')
  }
})
