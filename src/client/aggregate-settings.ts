import type { LiveFactoryNode, RenderFactorySlot, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useEffect, useState, type ReactNode } from 'react'

export const AGGREGATE_CONFIG_FACTORY_PREFIX = 'dsh-aggregate.config:'
export const AGGREGATE_MEMBER_SLOT_PREFIX = 'dsh-aggregate.member-config:'

export function aggregateConfigFactoryName(packageName: string): string {
  return `${AGGREGATE_CONFIG_FACTORY_PREFIX}${packageName}`
}

export function aggregateMemberSlotName(packageName: string): string {
  return `${AGGREGATE_MEMBER_SLOT_PREFIX}${packageName}`
}

export interface AggregateSettingsAvailability {
  readonly factoryName: string
  readonly count?: number
}

type SlotsReader = Pick<SlotRegistry, 'snapshot' | 'subscribe'>

export function inspectAggregateSettings(
  slots: Pick<SlotRegistry, 'snapshot'>,
  packageName: string,
): AggregateSettingsAvailability | undefined {
  if (typeof slots.snapshot !== 'function') return undefined
  const factoryName = aggregateConfigFactoryName(packageName)
  const nodes = slots.snapshot(`factory:${factoryName}`)
  const factoryNode = nodes.find(
    (node): node is LiveFactoryNode => node.type === 'factory' && node.name === factoryName,
  )
  if (factoryNode === undefined) return undefined
  let count = 0
  for (const child of factoryNode.children) {
    for (const occupant of child.occupants) {
      if (occupant.active) count += 1
    }
  }
  return count > 0 ? { factoryName, count } : { factoryName }
}

export function readAggregateSettingsMap(
  slots: Pick<SlotRegistry, 'snapshot'>,
  packageNames: readonly string[],
): ReadonlyMap<string, AggregateSettingsAvailability> {
  const result = new Map<string, AggregateSettingsAvailability>()
  for (const packageName of packageNames) {
    if (result.has(packageName)) continue
    const availability = inspectAggregateSettings(slots, packageName)
    if (availability !== undefined) result.set(packageName, availability)
  }
  return result
}

export function sameAggregateSettingsMap(
  a: ReadonlyMap<string, AggregateSettingsAvailability>,
  b: ReadonlyMap<string, AggregateSettingsAvailability>,
): boolean {
  if (a.size !== b.size) return false
  for (const [key, left] of a) {
    const right = b.get(key)
    if (right === undefined || left.factoryName !== right.factoryName || left.count !== right.count) {
      return false
    }
  }
  return true
}

export function useAggregateSettingsMap(
  slots: Partial<SlotsReader>,
  packageNames: readonly string[],
): ReadonlyMap<string, AggregateSettingsAvailability> {
  const uniquePackages = [...new Set(packageNames)]
  const packagesKey = uniquePackages.join('\0')
  const [settingsMap, setSettingsMap] = useState<ReadonlyMap<string, AggregateSettingsAvailability>>(() =>
    typeof slots.snapshot === 'function'
      ? readAggregateSettingsMap(slots as Pick<SlotRegistry, 'snapshot'>, uniquePackages)
      : new Map(),
  )

  useEffect(() => {
    const sync = () => {
      const next = typeof slots.snapshot === 'function'
        ? readAggregateSettingsMap(slots as Pick<SlotRegistry, 'snapshot'>, uniquePackages)
        : new Map<string, AggregateSettingsAvailability>()
      setSettingsMap(prev => (sameAggregateSettingsMap(prev, next) ? prev : next))
    }
    sync()
    if (typeof slots.subscribe !== 'function') return undefined
    const unsubscribes: Array<() => void> = [
      slots.subscribe('plugins.bundle.config', sync),
    ]
    for (const packageName of uniquePackages) {
      unsubscribes.push(slots.subscribe(aggregateMemberSlotName(packageName) as keyof SlotMap & string, sync))
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [slots, packagesKey])

  return settingsMap
}

export function renderDynamicFactorySlot(
  renderFactorySlot: RenderFactorySlot,
  factoryName: string,
  inputProps: {
    readonly view: 'summary' | 'page'
    readonly canToggle?: boolean
    readonly expandCommand?: { readonly action: 'expand' | 'collapse'; readonly seq: number }
  },
): ReactNode {
  return (renderFactorySlot as unknown as (name: string, props: Record<string, unknown>) => ReactNode)(
    factoryName,
    inputProps,
  )
}
