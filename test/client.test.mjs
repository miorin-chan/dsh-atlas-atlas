import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

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
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'remote', 'remote.pluginManager'])
  plugin.apply(ctx)

  const slot = slots.get('@miorin/dsh-atlas-atlas')
  assert.equal(slot?.name, 'plugins.bundle.config')
  assert.equal(typeof slot?.render, 'function')
  assert.deepEqual([...subscriptions].sort(), ['connection/reset', 'plugin-manager/changed'])
  const labels = locales.get('dsh-atlas-atlas')
  assert.deepEqual(Object.keys(labels).sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  for (const localized of Object.values(labels)) {
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(labels.en).sort())
  }

  for (const dispose of effects.reverse()) dispose()
  assert.equal(locales.size, 0)
  assert.equal(slots.size, 0)
  assert.equal(subscriptions.size, 0)
})
