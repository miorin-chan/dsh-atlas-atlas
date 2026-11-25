import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'

let registration
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
await import('../client.js')
delete globalThis.window
assert.equal(registration.id, '@miorin/dsh-atlas-atlas')
const plugin = registration.factory(createRequire(import.meta.url))

test('mounts bundle config, detail badge, and detail section slots and disposes cleanly', () => {
  const effects = []
  const subscriptions = new Set()
  const slots = new Map()
  const locales = new Map()
  const subscribe = event => {
    subscriptions.add(event)
    return () => subscriptions.delete(event)
  }
  const ctx = {
    effect(install) { effects.push(install()) },
    on: subscribe,
    remote: { pluginManager: {}, $on: subscribe },
    configForms: { get(id) { assert.equal(id, 'dsh-atlas-atlas'); return {} } },
    locale: {
      bind: () => key => key,
      register(namespace, labels) {
        locales.set(namespace, labels)
        return () => locales.delete(namespace)
      },
    },
    slots: {
      inject(slot, register) {
        assert.ok(slot === 'plugins.bundle.config' || slot === 'plugins.detail.badge' || slot === 'plugins.detail.section')
        return register()
      },
      register(options, render) {
        slots.set(`${options.name}:${options.key ?? options.id}`, { name: options.name, options, render })
        return () => slots.delete(`${options.name}:${options.key ?? options.id}`)
      },
    },
  }
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'remote', 'remote.pluginManager', 'configForms'])
  plugin.apply(ctx)

  assert.equal(slots.get('plugins.bundle.config:@miorin/dsh-atlas-atlas')?.name, 'plugins.bundle.config')
  assert.equal(slots.get('plugins.detail.badge:@miorin/dsh-atlas-atlas')?.name, 'plugins.detail.badge')
  assert.equal(slots.get('plugins.detail.section:@miorin/dsh-atlas-atlas')?.name, 'plugins.detail.section')
  assert.deepEqual([...subscriptions].sort(), ['connection/reset', 'plugin-manager/changed'])

  const labels = locales.get('dsh-atlas-atlas')
  const listTitles = {
    en: 'List Modular Improvement Plan',
    zh: '列表模块化改良计划',
    ja: 'リストのモジュール型改善計画',
    de: 'Modularer Verbesserungsplan für Listen',
    es: 'Plan de mejora modular de las listas',
    fr: 'Plan d’amélioration modulaire des listes',
    pt: 'Plano de melhoria modular das listas',
    ru: 'План модульного улучшения списков',
  }
  assert.deepEqual(Object.keys(labels).sort(), Object.keys(listTitles).sort())
  for (const [language, localized] of Object.entries(labels)) {
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(labels.en).sort())
    assert.equal(localized.list, listTitles[language], language)
    const { meta } = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    if (language === 'zh') {
      assert.equal(meta.title, '模块模块化改良计划')
      continue
    }
    if (language === 'en') assert.equal(meta.title, 'Atlas Modular Improvement Plan')
    for (const text of [meta.title, meta.description, ...Object.values(localized)]) {
      assert.doesNotMatch(text, /模块化改良计划/u, language)
    }
  }

  for (const dispose of effects.reverse()) dispose()
  assert.equal(locales.size, 0)
  assert.equal(slots.size, 0)
  assert.equal(subscriptions.size, 0)
})

test('renders six Atlas switches, discovered aggregates, and gates detail controls on localDevEnabled', async () => {
  const effects = []
  const mutations = []
  const fetchRequests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    fetchRequests.push(JSON.parse(String(init?.body ?? '{}')))
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (body.action === 'overview') {
      return {
        async json() {
          return {
            ok: true,
            value: {
              enabled: form.snapshot.value.localDevEnabled,
              workspaceDir: form.snapshot.value.localWorkspaceDir,
              workspaceDirValid: true,
              aggregateBundles: [
                {
                  packageName: '@local/custom-bundle',
                  installed: true,
                  enabled: true,
                  official: false,
                  isAggregate: true,
                  manageable: true,
                  selfMode: 'local',
                  membersMode: 'bundled',
                  canRestoreSelf: true,
                  canSwitchSelfToLocal: false,
                  canSwitchMembersToLocal: true,
                  canRestoreMembers: false,
                  localCheckoutAvailable: true,
                  members: [{ name: '@local/member-a', checkoutDir: '/repos/member-a', available: true, activeLocal: false }],
                  membersReady: true,
                  drifted: false,
                },
              ],
            },
          }
        },
      } as unknown as Response
    }
    return {
      async json() {
        return {
          ok: true,
          value: {
            packageName: body.packageName,
            installed: true,
            enabled: true,
            official: false,
            isAggregate: body.packageName === '@miorin/dsh-atlas-list',
            manageable: true,
            selfMode: 'local',
            membersMode: body.packageName === '@miorin/dsh-atlas-list' ? 'local' : 'bundled',
            currentSource: `link:/repos/${body.packageName.split('/')[1]}`,
            canRestoreSelf: true,
            canSwitchSelfToLocal: false,
            canSwitchMembersToLocal: false,
            canRestoreMembers: body.packageName === '@miorin/dsh-atlas-list',
            localCheckoutAvailable: true,
            members: body.packageName === '@miorin/dsh-atlas-list'
              ? [{ name: '@miorin/dsh-watched-sessions', checkoutDir: '/repos/dsh-watched-sessions', available: true, activeLocal: true, version: '0.1.3' }]
              : [],
            membersReady: true,
            drifted: false,
          },
        }
      },
    } as unknown as Response
  }

  const form = {
    snapshot: { status: 'ready', writable: true, revision: 1, value: { localDevEnabled: false, localWorkspaceDir: '/repos' } },
    listeners: new Set<() => void>(),
    getSnapshot() { return this.snapshot },
    subscribe(listener: () => void) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    async mutate(ops: unknown[]) {
      mutations.push(ops)
      return true
    },
  }
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: () => () => {},
    remote: { pluginManager: { async listBundles() { return { ok: true, value: [] } } }, $on: () => () => {} },
    configForms: { get: () => form },
    locale: { bind: () => key => key, register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: {
      inject: (_, register) => register(),
      register(options, render) {
        slots.set(options.name, render)
        return () => {}
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  const DetailSection = slots.get('plugins.detail.section')!
  const DetailBadge = slots.get('plugins.detail.badge')!

  let view
  let detailView
  let badgeView
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })
    const switches = view.root.findAllByProps({ role: 'switch' })
    assert.deepEqual(switches.flatMap(item => item.props['aria-label'] ?? []), ['workspace', 'session', 'list', 'plugin', 'mobile', 'continuity'])
    const continuitySwitch = switches.find(item => item.props['aria-label'] === 'continuity')
    assert.equal(continuitySwitch?.props.disabled, true)
    assert.equal(view.root.findAllByProps({ 'data-discovered-aggregates': '' }).length, 1)

    // When localDevEnabled is false, detail contributions render null with zero detail requests.
    const requestsBefore = fetchRequests.length
    await act(async () => {
      detailView = create(createElement(DetailSection as never, {
        subject: { kind: 'bundle', pkg: { name: '@miorin/dsh-atlas-list', installed: true, availability: 'profile', official: false, enabled: true, rows: [] } },
        t: (key: string) => key,
        useRemoteAccess: () => true,
      }))
      badgeView = create(createElement(DetailBadge as never, {
        subject: { kind: 'bundle', pkg: { name: '@miorin/dsh-atlas-list', installed: true, availability: 'profile', official: false, enabled: true, rows: [] } },
        t: (key: string) => key,
      }))
    })
    assert.equal(detailView.toJSON(), null)
    assert.equal(badgeView.toJSON(), null)
    assert.equal(fetchRequests.length, requestsBefore)

    // Enable localDevEnabled -> detail section renders both Feature 1 and Feature 2 and badge renders tags.
    await act(async () => {
      form.snapshot = { ...form.snapshot, value: { ...form.snapshot.value, localDevEnabled: true } }
      for (const listener of form.listeners) listener()
    })
    assert.ok(detailView.root.findByProps({ 'data-local-dev-self': 'local' }))
    assert.ok(detailView.root.findByProps({ 'data-local-dev-members': 'local' }))
    assert.ok(badgeView.root.findByProps({ 'data-atlas-local-badges': '@miorin/dsh-atlas-list' }))
  } finally {
    globalThis.fetch = originalFetch
    if (view !== undefined) act(() => view.unmount())
    if (detailView !== undefined) act(() => detailView.unmount())
    if (badgeView !== undefined) act(() => badgeView.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
  assert.equal(form.listeners.size, 0)
})
