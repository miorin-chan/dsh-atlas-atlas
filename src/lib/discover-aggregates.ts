import type { BundleInfo } from '@deepseek-ai/dsh-plugin-manager'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { PACKAGE, type DiscoveredAggregate } from './atlas.js'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function resolveBundleRoot(profileDir: string, bundle: Pick<BundleInfo, 'name' | 'source'>): string | undefined {
  if (bundle.source?.startsWith('link:')) {
    const target = bundle.source.slice(5)
    return isAbsolute(target) ? target : undefined
  }
  return join(profileDir, 'node_modules', ...bundle.name.split('/'))
}

export async function discoverInstalledAggregates(
  manager: { listBundles(): Promise<readonly BundleInfo[]> },
  profileDir: string,
): Promise<DiscoveredAggregate[]> {
  const bundles = await manager.listBundles()
  const discovered: DiscoveredAggregate[] = []
  for (const bundle of bundles) {
    if (!bundle.installed || bundle.availability !== 'profile' || bundle.name === PACKAGE) continue
    const root = resolveBundleRoot(profileDir, bundle)
    if (root === undefined) continue
    try {
      const manifest = asRecord(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')))
      const aggregate = asRecord(asRecord(manifest?.dsh)?.aggregate)
      const plugins = aggregate?.plugins
      if (
        typeof aggregate?.version === 'number'
        && Number.isInteger(aggregate.version)
        && Array.isArray(plugins)
        && plugins.length > 0
        && plugins.every(item => typeof item === 'string' && item.trim() !== '')
      ) {
        discovered.push({ packageName: bundle.name, memberCount: plugins.length })
      }
    } catch {
      // Ignore bundles whose manifest is unreadable or invalid JSON.
    }
  }
  discovered.sort((a, b) => (a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0))
  return discovered
}
