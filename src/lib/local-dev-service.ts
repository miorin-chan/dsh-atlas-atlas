import type { BundleInfo, ChangeResult, InstallBundleOptions, PluginSpecInspection } from '@deepseek-ai/dsh-plugin-manager'
import { realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import {
  inspectSiblingCheckout,
  isInside,
  readCheckedBundle,
  resolveBundleRootFromInfo,
  resolveInstalledDependency,
  validateWorkspaceDir,
  type CheckedBundle,
} from './bundle-inspector.js'
import {
  LocalDevError,
  NPM_REGISTRY,
  PACKAGE,
  packageBasename,
  type BundleLocalDevStatus,
  type LocalDevOverview,
  type LocalDevRequest,
  type MemberLocalStatus,
  type PreparedLocalSpec,
  type SourceMode,
  type UnmanageableReason,
} from './local-dev-types.js'
import { buildLocalOverlay, gcOverlays, isManagedOverlayDir, verifyOverlay, type BuiltOverlay } from './overlay-builder.js'

export interface PluginManagerLike {
  listBundles(): Promise<BundleInfo[]>
  inspect(spec: string, options?: Record<string, unknown>): Promise<PluginSpecInspection>
  installBundle(spec: string, options: InstallBundleOptions): Promise<ChangeResult>
  removeBundle(name: string): Promise<ChangeResult>
}

export interface LocalDevServiceOptions {
  readonly manager: PluginManagerLike
  readonly profileDir: string
  readonly isEnabled: () => boolean
  readonly getWorkspaceDir: () => string
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function localPathOf(spec: string | undefined): string | undefined {
  return spec?.startsWith('link:') ? spec.slice(5) : undefined
}

function isLocalSource(bundle: BundleInfo): boolean {
  const path = localPathOf(bundle.source)
  return path !== undefined && isAbsolute(path)
}

function isRegistrySource(bundle: BundleInfo): boolean {
  return bundle.update === 'registry' && !bundle.source?.startsWith('link:')
}

function isSupportedSource(bundle: BundleInfo): boolean {
  return isLocalSource(bundle) || isRegistrySource(bundle)
}

async function sameSpec(a: string | undefined, b: string | undefined): Promise<boolean> {
  if (a === undefined || b === undefined) return false
  const pathA = localPathOf(a)
  const pathB = localPathOf(b)
  if (pathA === undefined && pathB === undefined) return a === b
  if (pathA === undefined || pathB === undefined) return false
  try {
    return await realpath(pathA) === await realpath(pathB)
  } catch {
    return pathA === pathB
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

function isAccepted(result: ChangeResult): boolean {
  return result.error === undefined && (result.application === 'applied' || result.application === 'restart-required')
}

function changeDiagnostic(result: ChangeResult): string {
  return result.error?.diagnostic ?? result.warnings?.join('\n') ?? result.application
}

async function isMemberLocalPath(
  resolvedRoot: string,
  realWorkspaceDir: string | undefined,
  memberName: string,
): Promise<boolean> {
  const realResolved = await realpath(resolvedRoot).catch(() => resolvedRoot)
  if (realWorkspaceDir !== undefined) {
    const expected = join(realWorkspaceDir, packageBasename(memberName))
    const realExpected = await realpath(expected).catch(() => expected)
    return realResolved === realExpected
  }
  return !realResolved.split(sep).includes('node_modules')
}

async function resolveBundledMemberRoot(
  localAggregateRoot: string,
  memberName: string,
  realWorkspaceDir: string | undefined,
  realProfileDir: string,
): Promise<string | undefined> {
  const resolved = await resolveInstalledDependency(localAggregateRoot, memberName)
  if (resolved === undefined) return undefined
  if (isInside(realProfileDir, resolved)) return undefined
  if (await isMemberLocalPath(resolved, realWorkspaceDir, memberName)) return undefined
  return resolved
}

async function allMembersAvailableLocally(workspaceDir: string, plugins: readonly string[]): Promise<boolean> {
  for (const memberName of plugins) {
    try {
      await inspectSiblingCheckout(workspaceDir, memberName)
    } catch {
      return false
    }
  }
  return true
}

async function readInstalledLocalMembers(
  installedRoot: string,
  plugins: readonly string[],
  realWorkspaceDir: string | undefined,
): Promise<Set<string>> {
  const local = new Set<string>()
  for (const memberName of plugins) {
    const resolved = await resolveInstalledDependency(installedRoot, memberName)
    if (resolved !== undefined && await isMemberLocalPath(resolved, realWorkspaceDir, memberName)) {
      local.add(memberName)
    }
  }
  return local
}

export class LocalDevService {
  private busy = false

  constructor(private readonly options: LocalDevServiceOptions) {}

  async handle(request: LocalDevRequest): Promise<LocalDevOverview | BundleLocalDevStatus | PreparedLocalSpec> {
    switch (request.action) {
      case 'overview':
        return this.overview()
      case 'inspect':
        return this.inspectBundle(request.packageName)
      case 'switch':
        return this.switchSource(request.packageName, request.mode)
      case 'switch-member':
        return this.switchMember(request.packageName, request.memberName, request.mode)
      case 'prepare-local':
        return this.prepareLocal(request.packageName)
    }
  }

  async overview(): Promise<LocalDevOverview> {
    const enabled = this.options.isEnabled()
    const workspaceDir = this.options.getWorkspaceDir().trim()
    let realWorkspaceDir: string | undefined
    let workspaceDirIssue: string | undefined
    if (workspaceDir !== '') {
      try {
        realWorkspaceDir = await validateWorkspaceDir(workspaceDir)
      } catch (error) {
        workspaceDirIssue = error instanceof Error ? error.message : String(error)
      }
    }

    const bundles = await this.options.manager.listBundles()
    const aggregateBundles: BundleLocalDevStatus[] = []
    for (const bundle of bundles) {
      if (!bundle.installed || bundle.name === PACKAGE) continue
      const status = await this.computeStatus(bundle.name, bundle, realWorkspaceDir)
      if (status.isAggregate) {
        aggregateBundles.push(status)
      }
    }

    return {
      enabled,
      workspaceDir,
      workspaceDirValid: realWorkspaceDir !== undefined,
      ...(workspaceDirIssue !== undefined ? { workspaceDirIssue } : {}),
      aggregateBundles,
    }
  }

  async inspectBundle(packageName: string, restartRequired = false): Promise<BundleLocalDevStatus> {
    const bundles = await this.options.manager.listBundles()
    const bundle = bundles.find(item => item.name === packageName && item.installed)
    let realWorkspaceDir: string | undefined
    const rawWorkspace = this.options.getWorkspaceDir().trim()
    if (rawWorkspace !== '') {
      realWorkspaceDir = await validateWorkspaceDir(rawWorkspace).catch(() => undefined)
    }
    return this.computeStatus(packageName, bundle, realWorkspaceDir, restartRequired)
  }

  async prepareLocal(packageName: string): Promise<PreparedLocalSpec> {
    this.assertEnabled()
    if (packageName === PACKAGE) throw new LocalDevError('protected', `${PACKAGE} cannot replace itself`)
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
      const checkout = await inspectSiblingCheckout(workspaceDir, packageName)
      const bundles = await this.options.manager.listBundles()
      const currentlyInstalled = bundles.some(item => item.name === packageName && item.installed)

      if (checkout.aggregate && await allMembersAvailableLocally(workspaceDir, checkout.aggregate.plugins)) {
        const overlay = await buildLocalOverlay({
          profileDir: this.options.profileDir,
          baseBundle: checkout,
          workspaceDir,
        })
        if (!currentlyInstalled) {
          await gcOverlays(this.options.profileDir, packageName, overlay.overlayDir)
        }
        return {
          spec: `link:${overlay.overlayDir}`,
          version: overlay.version,
          isAggregate: true,
          overlayDir: overlay.overlayDir,
        }
      }

      return {
        spec: `link:${checkout.root}`,
        version: checkout.version,
        isAggregate: checkout.aggregate !== undefined,
      }
    } finally {
      this.busy = false
    }
  }

  async switchSource(packageName: string, mode: SourceMode): Promise<BundleLocalDevStatus> {
    this.assertEnabled()
    if (packageName === PACKAGE) throw new LocalDevError('protected', `${PACKAGE} cannot replace itself`)
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      const bundles = await this.options.manager.listBundles()
      const bundle = bundles.find(item => item.name === packageName && item.installed)
      if (!bundle) throw new LocalDevError('not-installed', packageName)
      this.assertManageable(bundle)

      const currentMode: SourceMode = isLocalSource(bundle) ? 'local' : 'npm'

      if (mode === 'local') {
        const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
        const checkout = await inspectSiblingCheckout(workspaceDir, packageName)

        if (currentMode === 'local') {
          if (!checkout.aggregate) {
            return await this.inspectBundle(packageName)
          }
          const installedRoot = resolveBundleRootFromInfo(this.options.profileDir, bundle)
          const currentLocalMembers = await readInstalledLocalMembers(
            installedRoot,
            checkout.aggregate.plugins,
            workspaceDir,
          )
          const localPath = localPathOf(bundle.source)
          const hasActiveOverlay = localPath !== undefined
            && await isManagedOverlayDir(this.options.profileDir, packageName, localPath)
          if (currentLocalMembers.size === checkout.aggregate.plugins.length && hasActiveOverlay) {
            return await this.inspectBundle(packageName)
          }
        }

        let overlay: BuiltOverlay | undefined
        let targetSpec: string
        let targetVersion: string
        if (
          checkout.aggregate
          && (currentMode === 'local' || await allMembersAvailableLocally(workspaceDir, checkout.aggregate.plugins))
        ) {
          overlay = await buildLocalOverlay({
            profileDir: this.options.profileDir,
            baseBundle: checkout,
            workspaceDir,
          })
          targetSpec = `link:${overlay.overlayDir}`
          targetVersion = overlay.version
        } else {
          targetSpec = `link:${checkout.root}`
          targetVersion = checkout.version
        }

        return await this.commitLocalTransition({
          packageName,
          bundle,
          targetSpec,
          targetVersion,
          overlay,
        })
      }

      // mode === 'npm' (does not require localWorkspaceDir; retains existing overlays until replacement succeeds)
      if (currentMode === 'npm') {
        return await this.inspectBundle(packageName)
      }

      const previousSpec = bundle.source!
      const previousVersion = bundle.version
      const previousEnabled = bundle.enabled

      try {
        const restart = await this.replaceBundle({
          packageName,
          targetSpec: packageName,
          targetVersion: undefined,
          enabled: previousEnabled,
          isRegistry: true,
        })
        await gcOverlays(this.options.profileDir, packageName, undefined)
        return await this.inspectBundle(packageName, restart)
      } catch (error) {
        await this.tryRestoreLocal(packageName, previousSpec, previousVersion, previousEnabled)
        throw error instanceof LocalDevError
          ? error
          : new LocalDevError('switch-failed', error instanceof Error ? error.message : String(error))
      }
    } finally {
      this.busy = false
    }
  }

  async switchMember(packageName: string, memberName: string, mode: SourceMode): Promise<BundleLocalDevStatus> {
    this.assertEnabled()
    if (packageName === PACKAGE) throw new LocalDevError('protected', `${PACKAGE} cannot replace itself`)
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      const bundles = await this.options.manager.listBundles()
      const bundle = bundles.find(item => item.name === packageName && item.installed)
      if (!bundle) throw new LocalDevError('not-installed', packageName)
      this.assertManageable(bundle)
      if (!isLocalSource(bundle)) {
        throw new LocalDevError('not-manageable', `${packageName} must be switched to local before switching sub-plugins`)
      }

      const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
      const realProfileDir = await realpath(this.options.profileDir).catch(() => this.options.profileDir)
      const checkout = await inspectSiblingCheckout(workspaceDir, packageName)
      if (!checkout.aggregate || !checkout.aggregate.plugins.includes(memberName)) {
        throw new LocalDevError('not-manageable', `${memberName} is not a declared direct member of ${packageName}`)
      }

      const installedRoot = resolveBundleRootFromInfo(this.options.profileDir, bundle)
      const currentLocalMembers = await readInstalledLocalMembers(
        installedRoot,
        checkout.aggregate.plugins,
        workspaceDir,
      )
      const nextLocalMembers = new Set(currentLocalMembers)
      if (mode === 'local') {
        nextLocalMembers.add(memberName)
      } else {
        nextLocalMembers.delete(memberName)
      }

      if (sameSet(currentLocalMembers, nextLocalMembers)) {
        return await this.inspectBundle(packageName)
      }

      if (mode === 'npm') {
        const bundledRoot = await resolveBundledMemberRoot(checkout.root, memberName, workspaceDir, realProfileDir)
        if (bundledRoot === undefined) {
          throw new LocalDevError('not-manageable', `${memberName} has no bundled npm dependency in ${checkout.root}`)
        }
      }

      let overlay: BuiltOverlay | undefined
      let targetSpec: string
      let targetVersion: string
      if (nextLocalMembers.size === 0) {
        for (const member of checkout.aggregate.plugins) {
          if ((await resolveBundledMemberRoot(checkout.root, member, workspaceDir, realProfileDir)) === undefined) {
            throw new LocalDevError('not-manageable', `${member} has no bundled npm dependency in ${checkout.root}`)
          }
        }
        targetSpec = `link:${checkout.root}`
        targetVersion = checkout.version
      } else {
        overlay = await buildLocalOverlay({
          profileDir: this.options.profileDir,
          baseBundle: checkout,
          workspaceDir,
          localMembers: nextLocalMembers,
        })
        targetSpec = `link:${overlay.overlayDir}`
        targetVersion = overlay.version
      }

      return await this.commitLocalTransition({
        packageName,
        bundle,
        targetSpec,
        targetVersion,
        overlay,
      })
    } finally {
      this.busy = false
    }
  }

  private async commitLocalTransition(params: {
    readonly packageName: string
    readonly bundle: BundleInfo
    readonly targetSpec: string
    readonly targetVersion: string
    readonly overlay: BuiltOverlay | undefined
  }): Promise<BundleLocalDevStatus> {
    const { packageName, bundle, targetSpec, targetVersion, overlay } = params
    const wasRegistry = isRegistrySource(bundle)
    const previousSpec = wasRegistry
      ? (bundle.version && EXACT_VERSION.test(bundle.version) ? `${packageName}@${bundle.version}` : packageName)
      : bundle.source!
    const previousVersion = bundle.version
    const previousEnabled = bundle.enabled

    try {
      await this.preflightLocal(packageName, targetSpec, targetVersion)
      const restart = await this.replaceBundle({
        packageName,
        targetSpec,
        targetVersion,
        enabled: previousEnabled,
        isRegistry: false,
      })
      if (overlay) {
        await verifyOverlay(overlay.overlayDir, packageName, overlay.version, overlay.memberPaths)
      }
      await gcOverlays(this.options.profileDir, packageName, overlay?.overlayDir)
      return await this.inspectBundle(packageName, restart)
    } catch (error) {
      if (wasRegistry) {
        await this.tryRestoreRegistry(packageName, previousSpec, previousEnabled)
      } else {
        await this.tryRestoreLocal(packageName, previousSpec, previousVersion, previousEnabled)
      }
      if (overlay) {
        const installedNow = (await this.options.manager.listBundles().catch(() => []))
          .find(item => item.name === packageName && item.installed)
        if (installedNow === undefined || !(await sameSpec(installedNow.source, targetSpec))) {
          await rm(overlay.overlayDir, { recursive: true, force: true }).catch(() => {})
        }
      }
      throw error instanceof LocalDevError
        ? error
        : new LocalDevError('switch-failed', error instanceof Error ? error.message : String(error))
    }
  }

  private assertEnabled(): void {
    if (!this.options.isEnabled()) {
      throw new LocalDevError('disabled', 'Local development mode is disabled in Atlas settings')
    }
  }

  private assertManageable(bundle: BundleInfo): void {
    if (bundle.name === PACKAGE) throw new LocalDevError('protected', PACKAGE)
    if (bundle.official) throw new LocalDevError('not-manageable', `${bundle.name} is an official bundle`)
    if (bundle.availability !== 'profile' || !bundle.removable || bundle.readOnlyReason !== undefined) {
      throw new LocalDevError('not-manageable', `${bundle.name} cannot be replaced in this profile`)
    }
    if (!isSupportedSource(bundle)) {
      throw new LocalDevError('not-manageable', `${bundle.name}: unsupported source`)
    }
  }

  private async preflightLocal(packageName: string, targetSpec: string, targetVersion: string): Promise<void> {
    const inspection = await this.options.manager.inspect(targetSpec, {})
    if (inspection.status === 'accepted') {
      if (
        inspection.name !== packageName
        || inspection.version !== targetVersion
        || inspection.bundle !== true
        || inspection.kind !== 'path'
      ) {
        throw new LocalDevError('invalid-checkout', `${targetSpec} did not inspect as ${packageName}@${targetVersion}`)
      }
      return
    }
    if (inspection.problem === 'already-installed' && inspection.reason === `${packageName} is already installed`) {
      return
    }
    throw new LocalDevError('switch-failed', inspection.reason)
  }

  private async replaceBundle(params: {
    readonly packageName: string
    readonly targetSpec: string
    readonly targetVersion: string | undefined
    readonly enabled: boolean
    readonly isRegistry: boolean
  }): Promise<boolean> {
    const { packageName, targetSpec, targetVersion, enabled, isRegistry } = params
    let restart = false
    const current = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
    if (current) {
      const removed = await this.options.manager.removeBundle(packageName)
      if (!isAccepted(removed)) throw new LocalDevError('switch-failed', changeDiagnostic(removed))
      restart ||= removed.application === 'restart-required'
    }

    const installed = isRegistry
      ? await this.options.manager.installBundle(packageName, {
        registry: NPM_REGISTRY,
        saveExact: true,
        enabled,
      })
      : await this.options.manager.installBundle(targetSpec, {
        enabled,
        saveExact: true,
        expected: { name: packageName, version: targetVersion! },
      })
    if (!isAccepted(installed)) throw new LocalDevError('switch-failed', changeDiagnostic(installed))
    restart ||= installed.application === 'restart-required'

    const after = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
    if (
      !after
      || after.enabled !== enabled
      || (isRegistry
        ? !isRegistrySource(after)
        : !(await sameSpec(after.source, targetSpec)) || after.version !== targetVersion)
    ) {
      throw new LocalDevError('switch-failed', `${packageName}: post-install state verification failed`)
    }
    return restart
  }

  private async tryRestoreRegistry(packageName: string, previousSpec: string, enabled: boolean): Promise<void> {
    try {
      const now = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
      if (now) return
      await this.options.manager.installBundle(previousSpec, {
        registry: NPM_REGISTRY,
        saveExact: true,
        enabled,
      })
    } catch {
      // Best-effort restore; original failure takes precedence.
    }
  }

  private async tryRestoreLocal(
    packageName: string,
    previousSpec: string,
    previousVersion: string | undefined,
    enabled: boolean,
  ): Promise<void> {
    try {
      const now = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
      if (now) return
      await this.options.manager.installBundle(previousSpec, {
        enabled,
        saveExact: true,
        ...(previousVersion !== undefined ? { expected: { name: packageName, version: previousVersion } } : {}),
      })
    } catch {
      // Best-effort restore; original failure takes precedence.
    }
  }

  private async computeStatus(
    packageName: string,
    bundle: BundleInfo | undefined,
    realWorkspaceDir: string | undefined,
    restartRequired = false,
  ): Promise<BundleLocalDevStatus> {
    let unmanageableReason: UnmanageableReason | undefined
    if (packageName === PACKAGE) unmanageableReason = 'self'
    else if (!bundle || !bundle.installed) unmanageableReason = 'not-installed'
    else if (bundle.official) unmanageableReason = 'official'
    else if (bundle.readOnlyReason !== undefined || !bundle.removable || bundle.availability !== 'profile') {
      unmanageableReason = bundle.availability === 'missing' ? 'missing-files' : 'read-only'
    } else if (!isSupportedSource(bundle)) {
      unmanageableReason = 'unsupported-source'
    }

    const realProfileDir = await realpath(this.options.profileDir).catch(() => this.options.profileDir)
    const installedRoot = bundle?.installed && bundle.availability === 'profile'
      ? resolveBundleRootFromInfo(this.options.profileDir, bundle)
      : undefined
    let checkedInstalled: CheckedBundle | undefined
    if (installedRoot !== undefined) {
      try {
        checkedInstalled = await readCheckedBundle(installedRoot, packageName)
      } catch {
        unmanageableReason ??= 'missing-files'
      }
    }

    let localCheckoutDir: string | undefined
    let checkedLocal: CheckedBundle | undefined
    let localCheckoutIssue: string | undefined
    if (realWorkspaceDir !== undefined) {
      localCheckoutDir = join(realWorkspaceDir, packageBasename(packageName))
      try {
        checkedLocal = await inspectSiblingCheckout(realWorkspaceDir, packageName)
      } catch (error) {
        localCheckoutIssue = error instanceof Error ? error.message : String(error)
      }
    }

    const mode: SourceMode = bundle !== undefined && isLocalSource(bundle) ? 'local' : 'npm'
    const manageable = unmanageableReason === undefined
    const localCheckoutAvailable = checkedLocal !== undefined
    const activeAggregate = checkedLocal?.aggregate ?? checkedInstalled?.aggregate
    const isAggregate = activeAggregate !== undefined

    const rawMembers: Array<Omit<MemberLocalStatus, 'canSwitchToLocal' | 'canSwitchToNpm'>> = []
    if (activeAggregate) {
      for (const memberName of activeAggregate.plugins) {
        let checkoutDir = realWorkspaceDir !== undefined
          ? join(realWorkspaceDir, packageBasename(memberName))
          : packageBasename(memberName)
        let available = false
        let version: string | undefined
        let issue: string | undefined
        if (realWorkspaceDir !== undefined) {
          try {
            const checkedMember = await inspectSiblingCheckout(realWorkspaceDir, memberName)
            checkoutDir = checkedMember.root
            available = true
            version = checkedMember.version
          } catch (error) {
            issue = error instanceof Error ? error.message : String(error)
          }
        }
        const bundledAvailable = checkedLocal !== undefined
          && (await resolveBundledMemberRoot(checkedLocal.root, memberName, realWorkspaceDir, realProfileDir)) !== undefined
        let memberMode: SourceMode = 'npm'
        if (mode === 'local' && installedRoot !== undefined) {
          const installedMember = await resolveInstalledDependency(installedRoot, memberName)
          if (installedMember !== undefined && await isMemberLocalPath(installedMember, realWorkspaceDir, memberName)) {
            memberMode = 'local'
          }
        }
        rawMembers.push({
          name: memberName,
          checkoutDir,
          available,
          bundledAvailable,
          mode: memberMode,
          ...(version !== undefined ? { version } : {}),
          ...(issue !== undefined ? { issue } : {}),
        })
      }
    }

    const members: MemberLocalStatus[] = rawMembers.map(member => {
      const otherNpmHaveBundled = rawMembers.every(
        other => other.name === member.name || other.mode === 'local' || other.bundledAvailable,
      )
      const otherLocalHaveCheckout = rawMembers.every(
        other => other.name === member.name || other.mode === 'npm' || other.available,
      )
      return {
        ...member,
        canSwitchToLocal: manageable
          && mode === 'local'
          && localCheckoutAvailable
          && member.mode === 'npm'
          && member.available
          && otherNpmHaveBundled
          && otherLocalHaveCheckout,
        canSwitchToNpm: manageable
          && mode === 'local'
          && localCheckoutAvailable
          && member.mode === 'local'
          && member.bundledAvailable
          && otherNpmHaveBundled
          && otherLocalHaveCheckout,
      }
    })

    const membersReady = isAggregate && members.length > 0 && members.every(member => member.available)
    const localIsAggregate = checkedLocal?.aggregate !== undefined
    const hasNonLocalMembers = isAggregate && members.some(member => member.mode !== 'local')
    const canSwitchToLocal = manageable
      && localCheckoutAvailable
      && (mode === 'npm' || (localIsAggregate && membersReady && hasNonLocalMembers))
    const canSwitchToNpm = manageable && mode === 'local'

    let activeOverlayDir: string | undefined
    const localPath = localPathOf(bundle?.source)
    if (mode === 'local' && localPath !== undefined) {
      if (await isManagedOverlayDir(this.options.profileDir, packageName, localPath)) {
        activeOverlayDir = localPath
      }
    }

    return {
      packageName,
      installed: bundle?.installed ?? false,
      enabled: bundle?.enabled ?? false,
      official: bundle?.official ?? false,
      isAggregate,
      ...(activeAggregate ? { aggregateVersion: activeAggregate.version } : {}),
      manageable,
      ...(unmanageableReason ? { unmanageableReason } : {}),
      mode,
      ...(bundle?.source !== undefined ? { currentSource: bundle.source } : {}),
      ...(bundle?.version !== undefined ? { currentVersion: bundle.version } : {}),
      canSwitchToLocal,
      canSwitchToNpm,
      ...(localCheckoutDir !== undefined ? { localCheckoutDir } : {}),
      localCheckoutAvailable,
      ...(checkedLocal ? { localCheckoutVersion: checkedLocal.version } : {}),
      ...(localCheckoutIssue !== undefined ? { localCheckoutIssue } : {}),
      members,
      membersReady,
      ...(activeOverlayDir !== undefined ? { activeOverlayDir } : {}),
      ...(restartRequired ? { restartRequired: true } : {}),
    }
  }
}
