import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import * as ReactNamespace from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { createElement, useState as reactUseState } from 'react'
import { act, create } from 'react-test-renderer'

let registration: { id: string; factory: (require: (id: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } }
;(globalThis as Record<string, unknown>).window = {
  __ModuleLoader__: { load(entry: typeof registration) { registration = entry } },
}
await import('../client.js')
delete (globalThis as Record<string, unknown>).window
assert.equal(registration!.id, '@miorin/dsh-atlas-atlas')

const testRequire = createRequire(import.meta.url)

function SwitchStub({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-label': label,
    'aria-checked': checked,
    disabled,
    className,
    onClick: () => { if (!disabled) onChange(!checked) },
  })
}

const testPrimitivesStub = {
  Button: ({
    icon,
    children,
    variant,
    size,
    ...rest
  }: Record<string, unknown>) => createElement('button', {
    type: 'button',
    'data-button-variant': variant,
    'data-button-size': size,
    ...rest,
  }, icon as never, children as never),
  IconChevronRightOutlineRegular: (props: Record<string, unknown>) => createElement('svg', props),
  IconChevronsUpDownOutlineMedium: (props: Record<string, unknown>) => createElement('svg', props),
  IconRightUpOutlineRegular: (props: Record<string, unknown>) => createElement('svg', props),
  IconTrashOutlineRegular: (props: Record<string, unknown>) => createElement('svg', props),
  Modal: ({
    open,
    onClose,
    title,
    tone,
    description,
    footer,
    closeLabel,
  }: Record<string, unknown>) => (open
    ? createElement('div', {
      'data-primitive-modal': '',
      'data-modal-tone': tone,
      'data-modal-close-label': closeLabel,
      'aria-label': title,
      'aria-description': description,
      onClose,
    }, footer as never)
    : null),
  PluginArtworkSubagent: () => null,
  StateDot: ({ state, size, className }: Record<string, unknown>) => createElement('span', {
    'data-state-dot': state,
    'data-state-dot-size': size,
    className,
  }),
  Switch: SwitchStub,
  Tooltip: ({
    children,
    side,
    delayMs,
    focusDelayMs,
    portal,
    label,
  }: {
    children: unknown
    side?: string
    delayMs?: number
    focusDelayMs?: number
    portal?: boolean
    label?: string
  }) => createElement('span', {
    'data-test-tooltip-side': side,
    'data-test-tooltip-delay': delayMs,
    'data-test-tooltip-focus-delay': focusDelayMs,
    'data-test-tooltip-portal': portal,
    'data-test-tooltip-label': label,
  }, children as never),
}

const plugin = registration!.factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? testPrimitivesStub : testRequire(id))

test('mounts only plugins.bundle.config, validates 8 locales, and disposes cleanly', () => {
  const effects: Array<() => void> = []
  const subscriptions = new Set<string>()
  const slots = new Map<string, { name: string; options: Record<string, unknown>; render: (p: Record<string, unknown>) => unknown }>()
  const locales = new Map<string, Record<string, Record<string, string>>>()
  const subscribe = (event: string) => {
    subscriptions.add(event)
    return () => subscriptions.delete(event)
  }
  const ctx = {
    effect(install: () => () => void) { effects.push(install()) },
    on: subscribe,
    remote: { pluginManager: {}, $on: subscribe },
    locale: {
      bind: () => (key: string) => key,
      register(namespace: string, labels: Record<string, Record<string, string>>) {
        locales.set(namespace, labels)
        return () => locales.delete(namespace)
      },
    },
    slots: {
      inject(slot: string, register: () => () => void) {
        assert.equal(slot, 'plugins.bundle.config')
        return register()
      },
      register(options: Record<string, unknown>, render: (p: Record<string, unknown>) => unknown) {
        slots.set(`${options.name}:${options.key ?? options.id}`, { name: String(options.name), options, render })
        return () => slots.delete(`${options.name}:${options.key ?? options.id}`)
      },
    },
  }
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'remote', 'remote.pluginManager'])
  plugin.apply(ctx)

  assert.equal(slots.get('plugins.bundle.config:@miorin/dsh-atlas-atlas')?.name, 'plugins.bundle.config')
  assert.equal(slots.size, 1)
  assert.deepEqual([...subscriptions].sort(), ['connection/reset', 'plugin-manager/changed'])

  const labels = locales.get('dsh-atlas-atlas')!
  const listTitles: Record<string, string> = {
    en: 'List Modular Improvement Plan',
    zh: '列表模块化改良计划',
    ja: 'リストのモジュール型改善計画',
    de: 'Modularer Verbesserungsplan für Listen',
    es: 'Plan de mejora modular de las listas',
    fr: 'Plan d’amélioration modulaire des listes',
    pt: 'Plano de melhoria modular das listas',
    ru: 'План модульного улучшения списков',
  }
  const visualTitles: Record<string, string> = {
    en: 'Visual Modular Improvement Plan',
    zh: '外观模块化改良计划',
    ja: '外観のモジュール型改善計画',
    de: 'Modularer Verbesserungsplan für das Erscheinungsbild',
    es: 'Plan de mejora modular visual',
    fr: 'Plan d’amélioration modulaire de l’apparence',
    pt: 'Plano de melhoria modular visual',
    ru: 'План модульного улучшения внешнего вида',
  }
  assert.deepEqual(Object.keys(labels).sort(), Object.keys(listTitles).sort())
  for (const [language, localized] of Object.entries(labels)) {
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(labels.en).sort())
    assert.equal(localized.list, listTitles[language], language)
    assert.equal(localized.visual, visualTitles[language], language)
    const visualLocaleUrl = new URL(`../../dsh-atlas-visual/locale/${language}.json`, import.meta.url)
    if (existsSync(visualLocaleUrl)) {
      const visualLocale = JSON.parse(readFileSync(visualLocaleUrl, 'utf8')) as { meta: { title: string } }
      assert.equal(visualLocale.meta.title, visualTitles[language], language)
    }
    const { meta } = JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8')) as {
      meta: { title: string; description: string; detail: string }
    }
    assert.equal(meta.detail, `docs/DETAIL.${language}.md`, language)
    assert.equal(existsSync(new URL(`../${meta.detail}`, import.meta.url)), true, meta.detail)
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

test('renders seven Atlas switches and discovered aggregates without local-dev inputs or detail slots', async () => {
  const effects: Array<() => void> = []
  const fetchUrls: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    fetchUrls.push(String(url))
    return {
      async json() {
        return {
          ok: true,
          value: [
            { packageName: '@local/custom-bundle', memberCount: 2 },
            { packageName: '@miorin/dsh-atlas-list', memberCount: 5 },
          ],
        }
      },
    } as unknown as Response
  }) as unknown as typeof fetch

  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install: () => () => void) { effects.push(install()) },
    on: () => () => {},
    remote: {
      pluginManager: {
        async listBundles() {
          return {
            ok: true,
            value: [
              {
                name: '@local/custom-bundle',
                installed: true,
                availability: 'profile',
                enabled: true,
                meta: { title: 'Custom Aggregate' },
                rows: [
                  { rowId: 'm1', moduleName: '@local/member-a' },
                  { rowId: 'm2', moduleName: '@local/member-b' },
                ],
              },
            ],
          }
        },
      },
      $on: () => () => {},
    },
    locale: {
      bind: () => (key: string) => key,
      resolveText: (value: unknown) => String(value),
      register: () => () => {},
      subscribe: () => () => {},
      getSnapshot: () => 'en',
    },
    slots: {
      inject: (_: string, register: () => () => void) => register(),
      register(options: { name: string }, render: (props: Record<string, unknown>) => unknown) {
        slots.set(options.name, render)
        return () => { slots.delete(options.name) }
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  let view: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })
    assert.deepEqual(fetchUrls, ['/api/dsh-atlas-aggregates'])
    const bundlesList = view!.root.findByProps({ 'data-atlas-panel': 'bundles' })
    const switches = bundlesList.findAllByProps({ role: 'switch' })
    assert.deepEqual(switches.flatMap(item => item.props['aria-label'] ?? []), ['workspace', 'session', 'list', 'continuity', 'visual', 'plugin', 'mobile'])
    assert.equal(switches.find(item => item.props['aria-label'] === 'continuity')?.props.disabled, false)
    assert.equal(switches.find(item => item.props['aria-label'] === 'visual')?.props.disabled, false)

    const discoveredList = view!.root.findByProps({ 'data-discovered-aggregates': '' })
    assert.equal(discoveredList.findAll(n => n.children?.includes('Custom Aggregate')).length > 0, true)
    assert.equal(discoveredList.findAll(n => n.children?.includes('@miorin/dsh-atlas-list')).length, 0)

    assert.equal(view!.root.findAllByProps({ 'data-primitive-input': '' }).length, 0)
    assert.equal(slots.has('plugins.detail.section'), false)
    assert.equal(slots.has('plugins.detail.badge'), false)
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
  globalThis.fetch = (async () => ({
    async json() {
      return {
        ok: true,
        value: [{ packageName: '@local/custom-bundle', memberCount: 1 }],
      }
    },
  })) as unknown as typeof fetch

  const openedBundles: string[] = []
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install: () => () => void) { effects.push(install()) },
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
              {
                name: '@local/custom-bundle',
                installed: true,
                availability: 'profile',
                enabled: true,
                removable: true,
                rows: [{ rowId: 'c1', moduleName: '@local/member-a' }],
              },
            ],
          }
        },
      },
      $on: () => () => {},
    },
    locale: {
      bind: () => (key: string, params?: Record<string, unknown>) => params?.count !== undefined ? `${key}:${params.count}` : key,
      resolveText: (value: unknown) => String(value),
      register: () => () => {},
      subscribe: () => () => {},
      getSnapshot: () => 'en',
    },
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

    view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-visual' }).props.onClick()
    assert.deepEqual(openedBundles, ['@miorin/dsh-atlas-visual'])

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

    const expandAllBtn = view!.root.findByProps({ 'data-atlas-expand-all': '' })
    assert.equal(expandAllBtn.props['aria-label'], 'expandAll')
    const expandAllTooltip = view!.root.findByProps({ 'data-test-tooltip-label': 'expandAll' })
    assert.equal(expandAllTooltip.props['data-test-tooltip-side'], 'right')
    assert.equal(expandAllTooltip.props['data-test-tooltip-delay'], 300)
    assert.equal(expandAllTooltip.props['data-test-tooltip-focus-delay'], 300)
    assert.equal(expandAllTooltip.props['data-test-tooltip-portal'], true)
    await act(async () => { expandAllBtn.props.onClick() })
    const collapseAllBtn = view!.root.findByProps({ 'data-atlas-expand-all': '' })
    assert.equal(collapseAllBtn.props['aria-label'], 'collapseAll')
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-workspace' }))
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }))
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }))
    assert.deepEqual(factoryCalls.slice(-1)[0]?.inputProps.expandCommand, { action: 'expand', seq: 1 })
    await act(async () => { view!.root.findByProps({ 'data-atlas-expand-all': '' }).props.onClick() })
    assert.equal(view!.root.findByProps({ 'data-atlas-expand-all': '' }).props['aria-label'], 'expandAll')
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-workspace' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }).length, 0)

    await act(async () => { view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' }).props.onClick() })
    await act(async () => { view!.root.findByProps({ 'data-atlas-settings-toggle': '@local/custom-bundle' }).props.onClick() })
    assert.ok(view!.root.findByProps({ 'data-atlas-settings-body': '@local/custom-bundle' }))
    await act(async () => { view!.root.findByProps({ 'data-atlas-settings-toggle': '@miorin/dsh-atlas-visual' }).props.onClick() })
    assert.equal(view!.root.findAllByProps({ 'data-atlas-settings-body': '@miorin/dsh-atlas-visual' }).length, 0)

    await act(async () => {
      setFactory('@local/custom-bundle', [])
      emitSlot('dsh-aggregate.member-config:@local/custom-bundle')
    })
    const updatedCustomToggle = view!.root.findByProps({ 'data-atlas-settings-toggle': '@local/custom-bundle' })
    assert.ok(updatedCustomToggle.findAll(n => n.children?.includes('1')).length > 0)

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

test('end-to-end integration with real DSH SlotRegistry, createSlotRenderer, and generated dsh-atlas-list', async t => {
  const listClientUrl = new URL('../../dsh-atlas-list/client.js', import.meta.url)
  if (!existsSync(listClientUrl)) {
    t.skip('sibling dsh-atlas-list checkout not present')
    return
  }
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

  const disposeStatefulRoot = ctx.slots.register({
    name: 'root',
    children: {
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      'plugins.detail.actions': { kind: 'list', scope: 'root' },
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

  const listClientCode = readFileSync(listClientUrl, 'utf8')
  let listEntry: { id: string; factory: (req: (id: string) => unknown) => { apply: (c: unknown) => void } } | undefined
  vm.runInNewContext(listClientCode, {
    window: { __ModuleLoader__: { load(payload: typeof listEntry) { listEntry = payload } } },
    console,
  })
  assert.equal(listEntry?.id, '@miorin/dsh-atlas-list')
  const listPlugin = listEntry!.factory(id =>
    id === 'react'
      ? ReactNamespace
      : id === '@deepseek-ai/dsh-client-ui-primitives'
        ? testPrimitivesStub
        : appRequire(id),
  )
  const listFork = ctx.plugin({
    name: 'test-dsh-atlas-list',
    apply: listPlugin.apply,
  } as never)
  plugin.apply(ctx as never)

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    async json() {
      return { ok: true, value: [] }
    },
  })) as unknown as typeof fetch

  let renderer: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      renderer = create(ctx.slots.renderSlot('root', {}) as never)
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })

    assert.equal(renderer!.root.findAllByProps({ role: 'tab' }).length, 0)
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-section': 'settings' }).length, 0)

    const pluginsPanel = renderer!.root.findByProps({ 'data-dsh-aggregate-panel': 'plugins' })
    const memberSwitches = pluginsPanel.findAllByProps({ role: 'switch' })
    assert.equal(memberSwitches.length, 2)
    assert.equal(memberSwitches[0].props['aria-checked'], false)
    assert.equal(memberSwitches[1].props['aria-checked'], true)
    assert.equal(memberSwitches[0].props.disabled, false)

    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 1)
    const rawToggle = renderer!.root.findByProps({ 'data-dsh-aggregate-raw-rows-toggle': '@miorin/dsh-atlas-list' })
    assert.equal(rawToggle.props['aria-expanded'], false)
    await act(async () => { rawToggle.props.onClick() })
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 0)
    assert.equal(renderer!.root.findByProps({ 'data-dsh-aggregate-raw-rows-toggle': '@miorin/dsh-atlas-list' }).props['aria-expanded'], true)
    await act(async () => { rawToggle.props.onClick() })
    assert.equal(renderer!.root.findAllByProps({ 'data-dsh-aggregate-hide-rows': '@miorin/dsh-atlas-list' }).length, 1)

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

    const detailExpandAll = renderer!.root.findByProps({ 'data-dsh-aggregate-expand-all': '@miorin/dsh-atlas-list' })
    await act(async () => { detailExpandAll.props.onClick() })
    assert.ok(renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }))
    await act(async () => {
      renderer!.root.findByProps({ 'data-dsh-aggregate-expand-all': '@miorin/dsh-atlas-list' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)

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

    await act(async () => { atlasMemberSwitches[0].props.onClick() })
    assert.deepEqual(setPluginEnabledCalls, [{ entryId: 'entry-draft', enabled: true }])

    await act(async () => {
      body.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).props.onClick()
    })
    assert.ok(body.findByProps({ 'data-dsh-aggregate-member': '@miorin/dsh-watched-sessions' }))
    const inlineLeaf = renderer!.root.findByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' })
    assert.deepEqual(inlineLeaf.children, ['leaf-ns:watchMode=true'])

    await act(async () => {
      renderer!.root.findByProps({ 'data-dsh-aggregate-member-toggle': '@miorin/dsh-watched-sessions' }).props.onClick()
    })
    assert.equal(renderer!.root.findAllByProps({ 'data-leaf-setting': '@miorin/dsh-watched-sessions' }).length, 0)

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

test('navigates to bundle detail pages and confirms uninstall with native Modal', async () => {
  const effects: Array<() => void> = []
  const openedBundles: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    async json() {
      return {
        ok: true,
        value: [{ packageName: '@local/custom-bundle', memberCount: 1 }],
      }
    },
  })) as unknown as typeof fetch

  let hasNavigation = true
  const removedBundles: string[] = []
  const slots = new Map<string, (props: Record<string, unknown>) => unknown>()
  plugin.apply({
    effect(install: () => () => void) { effects.push(install()) },
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
              { name: '@local/custom-bundle', installed: true, availability: 'profile', enabled: false, removable: true, rows: [] },
            ],
          }
        },
        async removeBundle(name: string) {
          removedBundles.push(name)
          return { ok: true, value: { application: 'applied' } }
        },
      },
      $on: () => () => {},
    },
    locale: {
      bind: () => (key: string) => key,
      resolveText: (value: unknown) => String(value),
      register: () => () => {},
      subscribe: () => () => {},
      getSnapshot: () => 'en',
    },
    slots: {
      inject: (_: string, register: () => () => void) => register(),
      register(options: { name: string }, render: (props: Record<string, unknown>) => unknown) {
        slots.set(options.name, render)
        return () => { slots.delete(options.name) }
      },
    },
  })

  const Panel = slots.get('plugins.bundle.config')!
  let view: ReturnType<typeof create> | undefined
  try {
    await act(async () => {
      view = create(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })

    const visualOpen = view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-visual' })
    const listOpen = view!.root.findByProps({ 'data-atlas-open': '@miorin/dsh-atlas-list' })
    const customOpen = view!.root.findByProps({ 'data-atlas-open': '@local/custom-bundle' })
    assert.equal(visualOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(listOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(customOpen.props.className, 'dsh-atlas-detail-open')
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-link' }).length, 0)
    assert.equal(view!.root.findAllByProps({ 'data-atlas-open': '@miorin/dsh-atlas-workspace' }).length, 0)
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-icon dsh-atlas-manager-icon-btn' }).length, 0)

    const panelStyleText = String(view!.root.findByType('style').children[0] ?? '')
    assert.doesNotMatch(panelStyleText, /--dsw-alias-brand-primary/)
    assert.match(panelStyleText, /@media \(hover: hover\)[\s\S]*\.dsh-atlas-manager-danger:hover:not\(:disabled\)/)
    assert.equal(view!.root.findAllByProps({ 'data-primitive-modal': '' }).length, 0)
    const trashBtn = view!.root.findByProps({ className: 'dsh-atlas-manager-trash' })
    await act(async () => { trashBtn.props.onClick() })
    const uninstallModal = view!.root.findByProps({ 'data-primitive-modal': '' })
    assert.equal(uninstallModal.props['data-modal-tone'], 'warning')
    assert.equal(uninstallModal.props['data-modal-close-label'], 'closeDialog')
    assert.ok(uninstallModal.findByProps({ 'data-modal-autofocus': '' }))
    const dangerBtn = uninstallModal.findByProps({ className: 'dsh-atlas-manager-danger' })
    await act(async () => { dangerBtn.props.onClick() })
    assert.deepEqual(removedBundles, ['@miorin/dsh-atlas-list'])

    visualOpen.props.onClick()
    listOpen.props.onClick()
    customOpen.props.onClick()
    assert.deepEqual(openedBundles, [
      '@miorin/dsh-atlas-visual',
      '@miorin/dsh-atlas-list',
      '@local/custom-bundle',
    ])

    hasNavigation = false
    await act(async () => {
      view!.update(createElement(Panel as never, { view: 'page', useRemoteAccess: () => true }))
    })
    assert.equal(view!.root.findAll(node => typeof node.props['data-atlas-open'] === 'string').length, 0)
    assert.equal(view!.root.findAllByProps({ className: 'dsh-atlas-manager-icon dsh-atlas-manager-icon-btn' }).length, 0)

    const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    assert.equal(pkgJson.dependencies, undefined)
    assert.equal(pkgJson.scripts?.prepack, 'npm run build 1>&2')
    assert.match(pkgJson.scripts?.['sync:atlas-icons'] ?? '', /scripts\/build\.mjs/)
  } finally {
    globalThis.fetch = originalFetch
    if (view !== undefined) act(() => view.unmount())
    for (const dispose of effects.reverse()) dispose()
  }
})
