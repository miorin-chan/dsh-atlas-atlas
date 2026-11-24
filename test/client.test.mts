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

test('mounts the bundle detail and disposes it, its locale, and both subscriptions', () => {
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
        assert.equal(slot, 'plugins.bundle.config')
        return register()
      },
      register(options, render) {
        slots.set(options.key, { name: options.name, render })
        return () => slots.delete(options.key)
      },
    },
  }
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'remote', 'remote.pluginManager', 'configForms'])
  plugin.apply(ctx)

  const slot = slots.get('@miorin/dsh-atlas-atlas')
  assert.equal(slot?.name, 'plugins.bundle.config')
  assert.equal(typeof slot?.render, 'function')
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

test('renders five Atlas switches and observes the receiver-bound repository form', async () => {
  const effects = []
  const form = {
    snapshot: { status: 'ready', writable: true, value: { useLocalRepositories: false, localRepositoryParent: '/repos' } },
    listeners: new Set<() => void>(),
    getSnapshot() { return this.snapshot },
    subscribe(listener: () => void) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  }
  let Panel
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: () => () => {},
    remote: { pluginManager: { async listBundles() { return { ok: true, value: [] } } }, $on: () => () => {} },
    configForms: { get: () => form },
    locale: { bind: () => key => key, register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: {
      inject: (_, register) => register(),
      register(_, render) { Panel = render; return () => {} },
    },
  })
  let view
  try {
    assert.ok(Panel)
    await act(async () => { view = create(createElement(Panel, { view: 'page', useRemoteAccess: () => true })) })
    const switches = view.root.findAllByProps({ role: 'switch' })
    assert.deepEqual(switches.flatMap(item => item.props['aria-label'] ?? []), ['workspace', 'session', 'list', 'plugin', 'mobile'])
    const repositorySwitch = switches.find(item => item.props['aria-labelledby'] !== undefined)
    assert.equal(repositorySwitch?.props['aria-checked'], false)
    assert.equal(form.listeners.size, 1)

    act(() => {
      form.snapshot = { ...form.snapshot, value: { ...form.snapshot.value, useLocalRepositories: true } }
      for (const listener of form.listeners) listener()
    })
    assert.equal(repositorySwitch.props['aria-checked'], true)
  } finally {
    if (view !== undefined) act(() => view.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
  assert.equal(form.listeners.size, 0)
})
