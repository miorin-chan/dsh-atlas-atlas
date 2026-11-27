import type { BundleInfo, ChangeResult, InstallBundleOptions, PluginSpecInspection } from '@deepseek-ai/dsh-plugin-manager'
import { rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  inspectSiblingCheckout,
  readCheckedBundle,
  resolveBundleRootFromInfo,
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

function isAccepted(result: ChangeResult): boolean {
  return result.error === undefined && (result.application === 'applied' || result.application === 'restart-required')
}

function changeDiagnostic(result: ChangeResult): string {
  return result.error?.diagnostic ?? result.warnings?.join('\n') ?? result.application
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

      if (checkout.aggregate) {
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
        isAggregate: false,
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
      if (currentMode === mode) {
        return await this.inspectBundle(packageName)
      }

      if (mode === 'local') {
        const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
        const checkout = await inspectSiblingCheckout(workspaceDir, packageName)

        let overlay: BuiltOverlay | undefined
        let targetSpec: string
        let targetVersion: string
        if (checkout.aggregate) {
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

        const previousSpec = bundle.version && EXACT_VERSION.test(bundle.version)
          ? `${packageName}@${bundle.version}`
          : packageName
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
          await this.tryRestoreRegistry(packageName, previousSpec, previousEnabled)
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

      // mode === 'npm' (does not require localWorkspaceDir; retains existing overlays until replacement succeeds)
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

    let checkedInstalled: CheckedBundle | undefined
    if (bundle?.installed && bundle.availability === 'profile') {
      try {
        checkedInstalled = await readCheckedBundle(resolveBundleRootFromInfo(this.options.profileDir, bundle), packageName)
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
    const activeAggregate = checkedLocal?.aggregate ?? checkedInstalled?.aggregate
    const isAggregate = activeAggregate !== undefined

    const members: MemberLocalStatus[] = []
    if (activeAggregate) {
      for (const memberName of activeAggregate.plugins) {
        const checkoutDir = realWorkspaceDir !== undefined
          ? join(realWorkspaceDir, packageBasename(memberName))
          : packageBasename(memberName)
        if (realWorkspaceDir === undefined) {
          members.push({ name: memberName, checkoutDir, available: false })
          continue
        }
        try {
          const checkedMember = await inspectSiblingCheckout(realWorkspaceDir, memberName)
          members.push({
            name: memberName,
            checkoutDir: checkedMember.root,
            available: true,
            version: checkedMember.version,
          })
        } catch (error) {
          members.push({
            name: memberName,
            checkoutDir,
            available: false,
            issue: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    const localCheckoutAvailable = checkedLocal !== undefined
    const membersReady = isAggregate && members.length > 0 && members.every(member => member.available)
    const manageable = unmanageableReason === undefined
    const localIsAggregate = checkedLocal?.aggregate !== undefined
    const canSwitchToLocal = manageable && mode === 'npm' && localCheckoutAvailable && (!localIsAggregate || membersReady)
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
