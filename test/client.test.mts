import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import * as ReactNamespace from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { createElement, useState as reactUseState } from 'react'
import { act, create } from 'react-test-renderer'

let registration
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
await import('../client.js')
delete globalThis.window
assert.equal(registration.id, '@miorin/dsh-atlas-atlas')
const testRequire = createRequire(import.meta.url)
function SwitchStub({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-label': label,
    'aria-checked': checked,
    disabled,
    onClick: () => { if (!disabled) onChange(!checked) },
  })
}
const plugin = registration.factory(id => testRequire(id))

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
    const visualLocale = JSON.parse(readFileSync(new URL(`../../dsh-atlas-visual/locale/${language}.json`, import.meta.url), 'utf8'))
    assert.equal(localized.visual, visualLocale.meta.title, language)
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

test('renders seven Atlas switches, discovered aggregates, and gates detail controls on localDevEnabled', async () => {
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
    assert.deepEqual(switches.flatMap(item => item.props['aria-label'] ?? []), ['workspace', 'session', 'list', 'plugin', 'mobile', 'continuity', 'visual'])
    const continuitySwitch = switches.find(item => item.props['aria-label'] === 'continuity')
    assert.equal(continuitySwitch?.props.disabled, true)
    const visualSwitch = switches.find(item => item.props['aria-label'] === 'visual')
    assert.equal(visualSwitch?.props.disabled, true)
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

test('installs uninstalled Continuity from localWorkspaceDir on toggle in local mode and requires saved workspace dir', async () => {
  const effects = []
  const bundles = new Map<string, Record<string, unknown>>()
  const remoteCalls: Array<{ op: string; arg: unknown; options?: unknown }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    async json() {
      return { ok: true, value: { enabled: true, workspaceDir: form.snapshot.value.localWorkspaceDir, workspaceDirValid: true, aggregateBundles: [] } }
    },
  }) as unknown as Response

  const form = {
    snapshot: { status: 'ready', writable: true, revision: 1, value: { localDevEnabled: true, localWorkspaceDir: '' } },
    listeners: new Set<() => void>(),
    getSnapshot() { return this.snapshot },
    subscribe(listener: () => void) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    async mutate() { return true },
  }
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: () => () => {},
    remote: {
      pluginManager: {
        async listBundles() { return { ok: true, value: [...bundles.values()] } },
        async inspect(spec: string, options: unknown) {
          assert.equal(arguments.length, 2)
          assert.deepEqual(options, {})
          remoteCalls.push({ op: 'inspect', arg: spec, options })
          return { ok: true, value: { status: 'accepted', kind: 'path', name: '@miorin/dsh-atlas-continuity', version: '0.1.0', bundle: true } }
        },
        async installBundle(spec: string, options: unknown) {
          remoteCalls.push({ op: 'installBundle', arg: spec, options })
          bundles.set('@miorin/dsh-atlas-continuity', {
            name: '@miorin/dsh-atlas-continuity',
            installed: true,
            availability: 'profile',
            enabled: false,
            source: spec,
            rows: [],
          })
          return { ok: true, value: { application: 'applied', changed: true } }
        },
        async setBundleEnabled(name: string, enabled: boolean) {
          remoteCalls.push({ op: 'setBundleEnabled', arg: name, options: enabled })
          bundles.set(name, { ...bundles.get(name), enabled })
          return { ok: true, value: { application: 'applied', changed: true } }
        },
      },
      $on: () => () => {},
    },
    configForms: { get: () => form },
    locale: { bind: () => (key: string) => key, register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: {
      inject: (_: string, register: () => () => void) => register(),
      register(options: { name: string }, render: (props: Record<string, unknown>) => unknown) {
        slots.set(options.name, render)
        return () => {}
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  let view
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })
    const continuityBlocked = view.root.findAllByProps({ role: 'switch', 'aria-label': 'continuity' })[0]
    assert.equal(continuityBlocked.props.disabled, true)
    assert.ok(view.root.findAll(node => node.type === 'p' && node.children.includes('localWorkspaceRequired')).length > 0)

    await act(async () => {
      form.snapshot = { ...form.snapshot, value: { localDevEnabled: true, localWorkspaceDir: '/repos/' } }
      for (const listener of form.listeners) listener()
    })
    const continuityReady = view.root.findAllByProps({ role: 'switch', 'aria-label': 'continuity' })[0]
    assert.equal(continuityReady.props.disabled, false)

    await act(async () => {
      continuityReady.props.onClick()
    })
    assert.deepEqual(remoteCalls, [
      { op: 'inspect', arg: 'link:/repos/dsh-atlas-continuity', options: {} },
      {
        op: 'installBundle',
        arg: 'link:/repos/dsh-atlas-continuity',
        options: { enabled: false, expected: { name: '@miorin/dsh-atlas-continuity', version: '0.1.0' } },
      },
      { op: 'setBundleEnabled', arg: '@miorin/dsh-atlas-continuity', options: true },
    ])
    assert.equal(bundles.get('@miorin/dsh-atlas-continuity')?.enabled, true)
  } finally {
    globalThis.fetch = originalFetch
    if (view !== undefined) act(() => view.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
})

test('expands indented aggregate settings inline under bundle title subheadings in a single list', async () => {
  const effects: Array<() => void> = []
  const subscribers = new Map<string, Set<() => void>>()
  const factories = new Map<string, {
    type: 'factory'
    name: string
    scope: 'root'
    children: Array<{ type: 'slot'; name: string; kind: 'keyed'; scope: 'root'; occupants: Array<{ active: boolean }> }>
  }>()
  const setFactory = (pkg: string, counts: number[] | null) => {
    const factoryName = `dsh-aggregate.config:${pkg}`
    if (counts === null) {
      factories.delete(factoryName)
      return
    }
    factories.set(factoryName, {
      type: 'factory',
      name: factoryName,
      scope: 'root',
      children: counts.length === 0 ? [] : [{
        type: 'slot',
        name: `dsh-aggregate.member-config:${pkg}`,
        kind: 'keyed',
        scope: 'root',
        occupants: counts.map(() => ({ active: true })),
      }],
    })
  }
  const emitSlot = (slotKey: string) => {
    for (const fn of [...(subscribers.get(slotKey) ?? [])]) fn()
  }

  setFactory('@miorin/dsh-atlas-visual', [1, 1])
  setFactory('@miorin/dsh-atlas-workspace', [])
  setFactory('@miorin/dsh-atlas-session', [1])
  setFactory('@local/custom-bundle', [1])

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    async json() {
      return {
        ok: true,
        value: {
          enabled: false,
          workspaceDir: '',
          workspaceDirValid: false,
          aggregateBundles: [
            {
              packageName: '@local/custom-bundle',
              installed: true,
              enabled: true,
              official: false,
              isAggregate: true,
              manageable: true,
              selfMode: 'baseline',
              membersMode: 'bundled',
              canRestoreSelf: false,
              canSwitchSelfToLocal: false,
              canSwitchMembersToLocal: false,
              canRestoreMembers: false,
              localCheckoutAvailable: false,
              members: [{ name: '@local/member-a', checkoutDir: '/repos/member-a', available: false, activeLocal: false }],
              membersReady: false,
              drifted: false,
            },
          ],
        },
      }
    },
  }) as unknown as Response

  const form = {
    snapshot: { status: 'ready', writable: true, revision: 1, value: { localDevEnabled: false, localWorkspaceDir: '' } },
    getSnapshot() { return this.snapshot },
    subscribe: () => () => {},
    async mutate() { return true },
  }

  const openedBundles: string[] = []
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: () => () => {},
    get(service: string) {
      if (service === 'pluginNavigation') {
        return {
          openBundle(packageName: string) { openedBundles.push(packageName) },
          openList() {},
        }
      }
      return undefined
    },
    remote: {
      pluginManager: {
        async listBundles() {
          return {
            ok: true,
            value: [
              {
                name: '@miorin/dsh-atlas-visual',
                installed: true,
                availability: 'profile',
                enabled: true,
                removable: true,
                rows: [
                  { rowId: 'claudelike', moduleName: '@miorin/dsh-claudelike-ui' },
                  { rowId: 'brand', moduleName: '@miorin/dsh-sidebar-brand' },
                  { rowId: 'self', moduleName: '@miorin/dsh-atlas-visual/runtime' },
                ],
              },
              {
                name: '@miorin/dsh-atlas-workspace',
                installed: true,
                availability: 'profile',
                enabled: true,
                removable: true,
                rows: [
                  { rowId: 'w1', moduleName: '@miorin/dsh-workspace-switcher' },
                  { rowId: 'w2', moduleName: '@miorin/dsh-preview-file-navigation' },
                  { rowId: 'w3', moduleName: '@miorin/dsh-workspace-title-badge' },
                  { rowId: 'w4', moduleName: '@miorin/dsh-workspace-default-preset' },
                ],
              },
              { name: '@miorin/dsh-atlas-session', installed: true, availability: 'profile', enabled: false, removable: true, rows: [] },
            ],
          }
        },
      },
      $on: () => () => {},
    },
    configForms: { get: () => form },
    locale: { bind: () => (key: string, params?: Record<string, unknown>) => params?.count !== undefined ? `${key}:${params.count}` : key, register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: {
      inject: (_: string, register: () => () => void) => register(),
      register(options: { name: string }, render: (props: Record<string, unknown>) => unknown) {
        slots.set(options.name, render)
        return () => {}
      },
      snapshot(root?: string) {
        if (!root?.startsWith('factory:')) return []
        const node = factories.get(root.slice('factory:'.length))
        return node ? [node] : []
      },
      subscribe(key: string, fn: () => void) {
        let set = subscribers.get(key)
        if (!set) {
          set = new Set()
          subscribers.set(key, set)
        }
        set.add(fn)
        return () => { set.delete(fn) }
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  const factoryCalls: Array<{ name: string; inputProps: Record<string, unknown> }> = []
  const renderFactorySlot = (name: string, inputProps: Record<string, unknown>) => {
    factoryCalls.push({ name, inputProps })
    return createElement('div', { 'data-rendered-factory': name }, name)
  }

  let view: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true, renderFactorySlot }))
    })

    // Single unified list: no tabs and no duplicate Settings section.
    assert.equal(view!.root.findAllByProps({ role: 'tab' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-section': 'settings' }).length, 0)
    assert.ok(view!.root.findByProps({ 'data-atlas-panel': 'bundles' }))
    assert.equal(factoryCalls.length, 0)

    // Enabled bundles (with or without configurable sub-plugins) show expand-only subheading toggles; disabled rows do not.
    const visualToggle = view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' })
    const workspaceToggle = view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-workspace' })
    const customToggle = view!.root.findByProps({ 'data-atlas-settings-toggle': '@local/custom-bundle' })
    assert.equal(visualToggle.props['aria-expanded'], false)
    assert.equal(workspaceToggle.props['aria-expanded'], false)
    assert.equal(customToggle.props['aria-expanded'], false)
    assert.ok(visualToggle.findAll(n => n.children?.includes('2')).length > 0)
    assert.ok(workspaceToggle.findAll(n => n.children?.includes('4')).length > 0)
    assert.ok(customToggle.findAll(n => n.children?.includes('1')).length > 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-session' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }).length, 0)

    // Detail link button beside title opens that bundle's detail page; clicking title/icon only expands and never navigates.
    view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-visual' }).props.onClick()
    assert.deepEqual(openedBundles, ['@miorin/dsh-atlas-visual'])

    // Clicking Visual Atlas or Workspace Atlas subheading expands its indented list inline beneath that row without navigating.
    await act(async () => { visualToggle.props.onClick() })
    await act(async () => { workspaceToggle.props.onClick() })
    assert.equal(
      view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' }).props['aria-expanded'],
      true,
    )
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }))
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-workspace' }))
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }).length, 0)
    assert.deepEqual(openedBundles, ['@miorin/dsh-atlas-visual'])
    assert.deepEqual(factoryCalls.slice(-2), [
      { name: 'dsh-aggregate.config:@miorin/dsh-atlas-workspace', inputProps: { view: 'page', canToggle: true } },
      { name: 'dsh-aggregate.config:@miorin/dsh-atlas-visual', inputProps: { view: 'page', canToggle: true } },
    ])

    // Expand-all button above bundles expands every expandable bundle and passes expandCommand.
    const expandAllBtn = view!.root.findByProps({ 'data-atlas-expand-all': '' })
    assert.deepEqual(expandAllBtn.children, ['expandAll'])
    await act(async () => { expandAllBtn.props.onClick() })
    assert.deepEqual(view!.root.findByProps({ 'data-atlas-expand-all': '' }).children, ['collapseAll'])
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-workspace' }))
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }))
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }))
    assert.deepEqual(factoryCalls.slice(-1)[0]?.inputProps.expandCommand, { action: 'expand', seq: 1 })
    await act(async () => { view!.root.findByProps({ 'data-atlas-expand-all': '' }).props.onClick() })
    assert.deepEqual(view!.root.findByProps({ 'data-atlas-expand-all': '' }).children, ['expandAll'])
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-workspace' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }).length, 0)

    // Re-expand Visual & Custom individually to verify individual toggles still work cleanly.
    await act(async () => { view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' }).props.onClick() })
    await act(async () => { view!.root.findByProps({ 'data-atlas-settings-toggle': '@local/custom-bundle' }).props.onClick() })
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }))

    // Clicking Visual Atlas subheading again collapses its inline settings.
    await act(async () => {
      view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' }).props.onClick()
    })
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }).length, 0)

    // Custom factory with 0 configurable sub-plugins stays expandable via its member count badge.
    await act(async () => {
      setFactory('@local/custom-bundle', [])
      emitSlot('dsh-aggregate.member-config:@local/custom-bundle')
    })
    const updatedCustomToggle = view!.root.findByProps({ 'data-atlas-settings-toggle': '@local/custom-bundle' })
    assert.ok(updatedCustomToggle.findAll(n => n.children?.includes('1')).length > 0)

    // Drop factories -> toggle buttons disappear while bundle rows stay intact.
    await act(async () => {
      setFactory('@miorin/dsh-atlas-visual', null)
      setFactory('@miorin/dsh-atlas-workspace', null)
      setFactory('@local/custom-bundle', null)
      emitSlot('dsh-aggregate.member-config:@miorin/dsh-atlas-visual')
    })
    assert.equal(view!.root.findAll(n => typeof n.props['data-atlas-settings-toggle'] === 'string').length, 0)
    assert.ok(view!.root.findByProps({ 'data-atlas-panel': 'bundles' }))
  } finally {
    globalThis.fetch = originalFetch
    if (view !== undefined) act(() => view.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
})

test('end-to-end integration with real DSH SlotRegistry, createSlotRenderer, and generated dsh-atlas-list', async () => {
  const appRequire = createRequire(import.meta.url)
  const rendererPath = appRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client')
  const rendererRequire = createRequire(rendererPath)
  let rendererEntry: { id: string; factory: (req: (id: string) => unknown) => { apply: (c: unknown) => void } } | undefined
  vm.runInNewContext(readFileSync(rendererPath, 'utf8'), {
    window: { __ModuleLoader__: { load(payload: typeof rendererEntry) { rendererEntry = payload } } },
    queueMicrotask,
    console,
  })
  assert.equal(rendererEntry?.id, '@deepseek-ai/dsh-client-ui-renderer')
  const uiRendererMod = rendererEntry!.factory(id => {
    if (id === 'react') return ReactNamespace
    if (id === 'react/jsx-runtime') return ReactJsxRuntime
    if (id === 'react-dom' || id === 'react-dom/client') return {}
    if (id === '@deepseek-ai/cordis') return appRequire(id)
    return rendererRequire(id)
  })

  const ctx = new Context()
  uiRendererMod.apply(ctx)
  ctx.slots.installLocale({
    getSnapshot: () => ({ revision: 1 }),
    subscribe: () => () => {},
    bind: ns => key => `${ns}:${key}`,
  })
  const absentScopeBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const absentSource = { getSnapshot: () => absentScopeBinding, subscribe: () => () => {} }
  ctx.slots.installScope('session', {
    current: absentSource,
    bindingSource: () => absentSource,
  })

  let setTargetKey: ((next: string) => void) | undefined
  const form = {
    snapshot: { status: 'ready', writable: true, revision: 1, value: { localDevEnabled: false, localWorkspaceDir: '' } },
    getSnapshot() { return this.snapshot },
    subscribe: () => () => {},
    async mutate() { return true },
  }
  const bundlesValue = [
    {
      name: '@miorin/dsh-atlas-list',
      installed: true,
      availability: 'profile',
      enabled: true,
      removable: true,
      rows: [
        {
          rowId: 'watched-sessions',
          moduleName: '@miorin/dsh-watched-sessions',
          entryId: 'entry-watched',
          meta: { title: { en: 'Watched Sessions', zh: '常驻会话' } },
        },
        {
          rowId: 'session-draft',
          moduleName: '@miorin/dsh-session-draft',
          entryId: 'entry-draft',
          meta: { title: { en: 'Session Draft', zh: '草稿标记' } },
        },
      ],
    },
  ]
  const currentLocale = { active: 'en', revision: 1 }
  const localeService = {
    bind: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      params?.count !== undefined ? `${ns}:${key}:${params.count}` : `${ns}:${key}`,
    register: () => () => {},
    subscribe: () => () => {},
    getSnapshot: () => currentLocale,
  }
  const setPluginEnabledCalls: Array<{ entryId: string; enabled: boolean }> = []
  ctx.reflect.provide('locale', localeService as never)
  ctx.reflect.provide('remote', {
    pluginManager: {
      async listBundles() { return { ok: true, value: bundlesValue } },
      async listPlugins() {
        return {
          ok: true,
          value: [
            { entryId: 'entry-watched', enabled: true, fiberPhase: 'active' },
            { entryId: 'entry-draft', enabled: false, fiberPhase: null },
          ],
        }
      },
      async setPluginEnabled(entryId: string, enabled: boolean) {
        setPluginEnabledCalls.push({ entryId, enabled })
        return { ok: true, value: { application: 'applied' } }
      },
    },
    $on: () => () => {},
  } as never)
  ctx.reflect.provide('configForms', { get: () => form } as never)

  const disposeStatefulRoot = ctx.slots.register({
    name: 'root',
    children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.detail.actions': { kind: 'list', scope: 'root' },
      'plugins.detail.badge': { kind: 'list', scope: 'root' },
      'plugins.detail.section': { kind: 'list', scope: 'root' },
    },
  } as never, (({ renderSlot }: Record<string, unknown>) => {
    const [target, setTarget] = reactUseState('@miorin/dsh-atlas-list')
    setTargetKey = setTarget
    const render = renderSlot as (slot: string, owner: Record<string, unknown>, opts?: { entryKey?: string }) => unknown
    return createElement('div', { 'data-test-root': target }, render('plugins.bundle.config', {
      view: 'page',
      useRemoteAccess: () => true,
    }, { entryKey: target }))
  }) as never)

  // Register a real leaf plugin into plugins.bundle.config with locale + inject.hooks.
  const watchModeSource = { getSnapshot: () => true, subscribe: () => () => {} }
  const disposeLeaf = ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@miorin/dsh-watched-sessions',
    locale: 'leaf-ns',
    inject: () => ({ hooks: { watchMode: watchModeSource } }),
  } as never, (({ view, t, useWatchMode }: {
    view?: string
    t: (key: string) => string
    useWatchMode: <S>(sel: (v: boolean) => S) => S
  }) => {
    const enabled = useWatchMode(v => v)
    if (view !== 'page') return null
    return createElement('div', { 'data-leaf-setting': '@miorin/dsh-watched-sessions' }, `${t('watchMode')}=${String(enabled)}`)
  }) as never)

  // Load real generated plugins/dsh-atlas-list/client.js into a VM and apply to ctx.
  const listClientCode = readFileSync(new URL('../../dsh-atlas-list/client.js', import.meta.url), 'utf8')
  let listEntry: { id: string; factory: (req: (id: string) => unknown) => { apply: (c: unknown) => void } } | undefined
  vm.runInNewContext(listClientCode, {
    window: { __ModuleLoader__: { load(payload: typeof listEntry) { listEntry = payload } } },
    console,
  })
  assert.equal(listEntry?.id, '@miorin/dsh-atlas-list')
  const primitivesStub = {
    Switch: SwitchStub,
    PluginArtworkSubagent: () => null,
  }
  const listPlugin = listEntry!.factory(id =>
    id === 'react'
      ? ReactNamespace
      : id === '@deepseek-ai/dsh-client-ui-primitives'
        ? primitivesStub
        : appRequire(id),
  )
  const listFork = ctx.plugin({
    name: 'test-dsh-atlas-list',
    apply: listPlugin.apply,
  } as never)
  plugin.apply(ctx as never)

  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    async json() {
      return { ok: true, value: { enabled: false, workspaceDir: '', workspaceDirValid: false, aggregateBundles: [] } }
    },
  }) as unknown as Response

  let renderer: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      renderer = create(ctx.slots.renderSlot('root', {}) as never)
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    // 1. Standalone aggregate detail page shows ONE single list of sub-plugins with inline expandable settings (no tabs, no second Settings list).
    assert.equal(renderer!.root.findAllByProps({ role: 'tab' }).length, 0)
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-section': 'settings' }).length, 0)

    const pluginsPanel = renderer!.root.findByProps({ 'data-dsh-aggregate-panel': 'plugins' })
    const memberSwitches = pluginsPanel.findAllByProps({ role: 'switch' })
    assert.equal(memberSwitches.length, 2)
    assert.equal(memberSwitches[0].props['aria-checked'], false)
    assert.equal(memberSwitches[1].props['aria-checked'], true)
    assert.equal(memberSwitches[0].props.disabled, false)

    // Soft-fold raw rows style toggles cleanly.
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 1)
    const rawToggle = renderer!.root.findByProps({ 'data-dsh-aggregate-raw-rows-toggle': '@miorin/dsh-atlas-list' })
    assert.equal(rawToggle.props['aria-expanded'], false)
    await act(async () => { rawToggle.props.onClick() })
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 0)
    assert.equal(renderer!.root.findByProps({ 'data-dsh-aggregate-raw-rows-toggle': '@miorin/dsh-atlas-list' }).props['aria-expanded'], true)
    await act(async () => { rawToggle.props.onClick() })
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 1)

    // Sub-plugin row starts collapsed; clicking its subheading expands its indented settings inline inside the row.
    const memberToggle = renderer!.root.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' })
    assert.equal(memberToggle.props['aria-expanded'], false)
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)
    await act(async () => { memberToggle.props.onClick() })
    assert.ok(renderer!.root.findByProps({ 'data-dsh-aggregate-member-settings': '@miorin/dsh-watched-sessions' }))
    const standaloneLeaf = renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' })
    assert.deepEqual(standaloneLeaf.children, ['leaf-ns:watchMode=true'])
    await act(async () => {
      renderer!.root.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)

    // Sub-aggregate detail page expand-all / collapse-all expands and collapses configurable members.
    const detailExpandAll = renderer!.root.findByProps({ 'data-dsh-aggregate-expand-all': '@miorin/dsh-atlas-list' })
    await act(async () => { detailExpandAll.props.onClick() })
    assert.ok(renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }))
    await act(async () => {
      renderer!.root.findByProps({ 'data-dsh-aggregate-expand-all': '@miorin/dsh-atlas-list' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)

    // 2. Switch to dsh-atlas-atlas panel -> ONE single list; List Atlas subheading starts collapsed and expands inline under its row.
    await act(async () => {
      setTargetKey!('@miorin/dsh-atlas-atlas')
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.equal(renderer!.root.findAllByProps({ role: 'tab' }).length, 0)
    assert.equal(renderer!.root.findAllByProps({ 'data-atlas-section': 'settings' }).length, 0)
    assert.ok(renderer!.root.findByProps({ 'data-atlas-panel': 'bundles' }))
    const listAtlasToggle = renderer!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-list' })
    assert.equal(listAtlasToggle.props['aria-expanded'], false)
    assert.equal(renderer!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-list' }).length, 0)

    await act(async () => {
      listAtlasToggle.props.onClick()
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    const body = renderer!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-list' })
    const atlasMemberSwitches = body.findAllByProps({ role: 'switch' })
    assert.equal(atlasMemberSwitches.length, 2)
    assert.equal(atlasMemberSwitches[0].props['aria-checked'], false)
    assert.equal(atlasMemberSwitches[1].props['aria-checked'], true)

    // Toggling a non-configurable member switch directly inside dsh-atlas-atlas invokes setPluginEnabled.
    await act(async () => { atlasMemberSwitches[0].props.onClick() })
    assert.deepEqual(setPluginEnabledCalls, [{ entryId: 'entry-draft', enabled: true }])

    // Expanding the configurable member inline inside dsh-atlas-atlas renders its settings with data-dsh-aggregate-member.
    await act(async () => {
      body.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).props.onClick()
    })
    assert.ok(body.findByProps({ 'data-dsh-aggregate-member': '@miorin/dsh-watched-sessions' }))
    const inlineLeaf = renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' })
    assert.deepEqual(inlineLeaf.children, ['leaf-ns:watchMode=true'])

    // Collapsing the inner member subheading hides only that leaf setting.
    await act(async () => {
      renderer!.root.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)

    // Clicking master expand-all expands List Atlas AND nested configurable settings in one click.
    await act(async () => {
      renderer!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-list' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-list' }).length, 0)
    await act(async () => {
      renderer!.root.findByProps({ 'data-atlas-expand-all': '' }).props.onClick()
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    assert.ok(renderer!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-list' }))
    assert.ok(renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }))
    await act(async () => {
      renderer!.root.findByProps({ 'data-atlas-expand-all': '' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-list' }).length, 0)

    // 3. Dispose leaf plugin -> toggle disappears on watched-sessions, while List Atlas remains expandable for its sub-plugin list & switches.
    await act(async () => {
      disposeLeaf()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.ok(renderer!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-list' }))
    assert.equal(
      renderer!.root.findAllByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).length,
      0,
    )

    // 4. Dispose aggregate bundle -> factory unregisters, inline toggle disappears cleanly while Bundles list remains.
    await act(async () => {
      await listFork.dispose()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-list' }).length, 0)
    assert.ok(renderer!.root.findByProps({ 'data-atlas-panel': 'bundles' }))
    assert.equal(ctx.slots.snapshot('factory:dsh-aggregate.config:@miorin/dsh-atlas-list').length, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (renderer !== undefined) act(() => renderer.unmount())
    disposeLeaf()
    disposeStatefulRoot()
    await ctx.fiber.dispose()
  }
})

test('navigates to bundle detail pages for installed official and discovered aggregates', async () => {
  const effects: Array<() => void> = []
  const openedBundles: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    async json() {
      return {
        ok: true,
        value: {
          enabled: false,
          workspaceDir: '',
          workspaceDirValid: false,
          aggregateBundles: [
            {
              packageName: '@local/custom-bundle',
              installed: true,
              enabled: false,
              official: false,
              isAggregate: true,
              manageable: true,
              selfMode: 'baseline',
              membersMode: 'bundled',
              canRestoreSelf: false,
              canSwitchSelfToLocal: false,
              canSwitchMembersToLocal: false,
              canRestoreMembers: false,
              localCheckoutAvailable: false,
              members: [{ name: '@local/member-a', checkoutDir: '/repos/member-a', available: false, activeLocal: false }],
              membersReady: false,
              drifted: false,
            },
          ],
        },
      }
    },
  }) as unknown as Response

  const form = {
    snapshot: { status: 'ready', writable: true, revision: 1, value: { localDevEnabled: false, localWorkspaceDir: '' } },
    getSnapshot() { return this.snapshot },
    subscribe: () => () => {},
    async mutate() { return true },
  }

  let hasNavigation = true
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install) { effects.push(install()) },
    on: () => () => {},
    get(service: string) {
      if (service === 'pluginNavigation' && hasNavigation) {
        return {
          openBundle(packageName: string) { openedBundles.push(packageName) },
          openList() {},
        }
      }
      return undefined
    },
    remote: {
      pluginManager: {
        async listBundles() {
          return {
            ok: true,
            value: [
              { name: '@miorin/dsh-atlas-visual', installed: true, availability: 'profile', enabled: true, removable: true, rows: [] },
              { name: '@miorin/dsh-atlas-list', installed: true, availability: 'profile', enabled: false, removable: true, rows: [] },
            ],
          }
        },
      },
      $on: () => () => {},
    },
    configForms: { get: () => form },
    locale: { bind: () => (key: string) => key, register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => 'en' },
    slots: {
      inject: (_: string, register: () => () => void) => register(),
      register(options: { name: string }, render: (props: Record<string, unknown>) => unknown) {
        slots.set(options.name, render)
        return () => {}
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  let view: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })

    // Only the trailing jump arrow navigates to bundle details; titles and icons never navigate.
    const visualOpen = view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-visual' })
    const listOpen = view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-list' })
    const customOpen = view!.root.findByProps({ 'data-atlas-open': '@local/custom-bundle' })
    assert.equal(visualOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(listOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(customOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-link' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-open': '@miorin/dsh-atlas-workspace' }).length, 0)
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-icon dsh-atlas-manager-icon-btn' }).length, 0)

    visualOpen.props.onClick()
    listOpen.props.onClick()
    customOpen.props.onClick()
    assert.deepEqual(openedBundles, [
      '@miorin/dsh-atlas-visual',
      '@miorin/dsh-atlas-list',
      '@local/custom-bundle',
    ])

    // When pluginNavigation is absent, trailing jump arrows disappear cleanly.
    hasNavigation = false
    await act(async () => {
      view!.update(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })
    assert.equal(view!.root.findAll(node => typeof node.props['data-atlas-open'] === 'string').length, 0)
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-icon dsh-atlas-manager-icon-btn' }).length, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (view !== undefined) act(() => view.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
})
