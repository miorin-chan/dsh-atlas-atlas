import type { BundleInfo, ChangeResult, InstallBundleOptions, PluginSpecInspection } from '@deepseek-ai/dsh-plugin-manager'
import { isAbsolute, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  inspectSiblingCheckout,
  readCheckedBundle,
  resolveBundleRootFromInfo,
  validateWorkspaceDir,
  type CheckedBundle,
} from './bundle-inspector.js'
import type { LocalDevStore } from './local-dev-store.js'
import {
  LocalDevError,
  PACKAGE,
  packageBasename,
  type BundleLocalDevStatus,
  type LocalDevOverview,
  type LocalDevRequest,
  type ManagedBundleRecord,
  type MemberLocalStatus,
  type MembersMode,
  type SelfMode,
  type SourceRef,
  type UnmanageableReason,
} from './local-dev-types.js'
import { buildLocalMembersOverlay, verifyOverlay } from './overlay-builder.js'

export interface PluginManagerLike {
  listBundles(): Promise<BundleInfo[]>
  inspect(spec: string): Promise<PluginSpecInspection>
  installBundle(spec: string, options: InstallBundleOptions): Promise<ChangeResult>
  removeBundle(name: string): Promise<ChangeResult>
}

export interface LocalDevServiceOptions {
  readonly manager: PluginManagerLike
  readonly profileDir: string
  readonly store: LocalDevStore
  readonly isEnabled: () => boolean
  readonly getWorkspaceDir: () => string
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function localPathOf(spec: string | undefined): string | undefined {
  return spec?.startsWith('link:') ? spec.slice(5) : undefined
}

function resolveBaselineSource(bundle: BundleInfo): SourceRef | undefined {
  if (!bundle.version || !EXACT_VERSION.test(bundle.version) || !bundle.source) return undefined
  if (bundle.update === 'registry' && bundle.source.startsWith(`${bundle.name}@`)) {
    return { spec: `${bundle.name}@${bundle.version}`, version: bundle.version }
  }
  const path = localPathOf(bundle.source)
  if (path && isAbsolute(path)) {
    return { spec: bundle.source, version: bundle.version }
  }
  return undefined
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

async function sameBundleSource(bundle: BundleInfo, spec: string, version: string): Promise<boolean> {
  if (bundle.version !== version || !bundle.source) return false
  const expectedPath = localPathOf(spec)
  if (expectedPath === undefined) {
    return bundle.update === 'registry' && bundle.source.startsWith(`${bundle.name}@`)
  }
  return sameSpec(bundle.source, spec)
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

  async handle(request: LocalDevRequest): Promise<LocalDevOverview | BundleLocalDevStatus> {
    switch (request.action) {
      case 'overview':
        return this.overview()
      case 'inspect':
        return this.inspectBundle(request.packageName)
      case 'set-self-mode':
        return this.setSelfMode(request.packageName, request.mode)
      case 'set-members-mode':
        return this.setMembersMode(request.packageName, request.mode)
      case 'reset-drift':
        return this.resetDrift(request.packageName)
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

    const [bundles, state] = await Promise.all([
      this.options.manager.listBundles(),
      this.options.store.readState(),
    ])
    const aggregateBundles: BundleLocalDevStatus[] = []
    for (const bundle of bundles) {
      if (!bundle.installed) continue
      const record = state.bundles[bundle.name]
      if (bundle.name === PACKAGE) continue
      const status = await this.computeStatus(bundle.name, bundle, record, realWorkspaceDir)
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
    const [bundles, record] = await Promise.all([
      this.options.manager.listBundles(),
      this.options.store.readRecord(packageName),
    ])
    const bundle = bundles.find(item => item.name === packageName && item.installed)
    let realWorkspaceDir: string | undefined
    const rawWorkspace = this.options.getWorkspaceDir().trim()
    if (rawWorkspace !== '') {
      realWorkspaceDir = await validateWorkspaceDir(rawWorkspace).catch(() => undefined)
    }
    return this.computeStatus(packageName, bundle, record, realWorkspaceDir, restartRequired)
  }

  async resetDrift(packageName: string): Promise<BundleLocalDevStatus> {
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      await this.options.store.writeRecord(packageName, undefined)
      await this.options.store.gcOverlays(packageName, undefined)
      return await this.inspectBundle(packageName)
    } finally {
      this.busy = false
    }
  }

  async setSelfMode(packageName: string, mode: SelfMode): Promise<BundleLocalDevStatus> {
    this.assertEnabled()
    if (packageName === PACKAGE) throw new LocalDevError('protected', `${PACKAGE} cannot replace itself`)
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
      const [bundles, existingRecord] = await Promise.all([
        this.options.manager.listBundles(),
        this.options.store.readRecord(packageName),
      ])
      const bundle = bundles.find(item => item.name === packageName && item.installed)
      if (!bundle) throw new LocalDevError('not-installed', packageName)
      this.assertManageable(bundle)

      const currentBaseline = resolveBaselineSource(bundle)
      if (!currentBaseline) throw new LocalDevError('not-manageable', `${packageName}: unsupported source`)

      if (existingRecord && !(await sameBundleSource(bundle, existingRecord.activeSpec, existingRecord.activeVersion))) {
        throw new LocalDevError('external-drift', `${packageName}: installed source changed externally to ${bundle.source}`)
      }

      const checkout = await inspectSiblingCheckout(workspaceDir, packageName)
      const checkoutSpec = `link:${checkout.root}`
      const startedLocal = !existingRecord && (await sameSpec(bundle.source, checkoutSpec))
      const currentSelfMode: SelfMode = existingRecord?.selfMode ?? (startedLocal ? 'local' : 'baseline')
      const currentMembersMode: MembersMode = existingRecord?.membersMode ?? 'bundled'

      if (currentSelfMode === mode) {
        return await this.inspectBundle(packageName)
      }

      const baseline = existingRecord?.baseline ?? {
        spec: currentBaseline.spec,
        version: currentBaseline.version,
        enabled: bundle.enabled,
      }
      const previous: SourceRef = { spec: currentBaseline.spec, version: currentBaseline.version }

      if (mode === 'local') {
        const isAggregate = checkout.aggregate !== undefined
        if (currentMembersMode === 'local') {
          if (!isAggregate) throw new LocalDevError('not-aggregate', packageName)
          const overlay = await buildLocalMembersOverlay({
            store: this.options.store,
            profileDir: this.options.profileDir,
            baseBundle: checkout,
            workspaceDir,
          })
          const target: SourceRef = { spec: `link:${overlay.overlayDir}`, version: overlay.version }
          const nextRecord: ManagedBundleRecord = {
            packageName,
            isAggregate: true,
            baseline,
            selfMode: 'local',
            membersMode: 'local',
            activeSpec: target.spec,
            activeVersion: target.version,
            overlayDir: overlay.overlayDir,
            memberPaths: overlay.memberPaths,
            updatedAt: new Date().toISOString(),
          }
          const restart = await this.commitTransition({
            packageName,
            previous,
            target,
            enabled: bundle.enabled,
            existingRecord,
            nextRecord,
            verify: () => verifyOverlay(overlay.overlayDir, packageName, overlay.version, overlay.memberPaths),
          })
          await this.options.store.gcOverlays(packageName, overlay.overlayDir)
          return await this.inspectBundle(packageName, restart)
        }

        const target: SourceRef = { spec: checkoutSpec, version: checkout.version }
        const nextRecord: ManagedBundleRecord = {
          packageName,
          isAggregate,
          baseline,
          selfMode: 'local',
          membersMode: 'bundled',
          activeSpec: target.spec,
          activeVersion: target.version,
          updatedAt: new Date().toISOString(),
        }
        const restart = await this.commitTransition({
          packageName,
          previous,
          target,
          enabled: bundle.enabled,
          existingRecord,
          nextRecord,
        })
        await this.options.store.gcOverlays(packageName, undefined)
        return await this.inspectBundle(packageName, restart)
      }

      // mode === 'baseline'
      if (!existingRecord || (await sameSpec(baseline.spec, checkoutSpec))) {
        throw new LocalDevError('not-manageable', `${packageName}: no distinct baseline source is recorded`)
      }

      if (currentMembersMode === 'bundled') {
        const target: SourceRef = { spec: baseline.spec, version: baseline.version }
        const restart = await this.commitTransition({
          packageName,
          previous,
          target,
          enabled: bundle.enabled,
          existingRecord,
          nextRecord: undefined,
        })
        await this.options.store.gcOverlays(packageName, undefined)
        return await this.inspectBundle(packageName, restart)
      }

      // Transitioning from (local, local) -> (baseline, local).
      // Obtain the baseline bundle files on disk so we can synthesize a fresh baseline+local-members overlay.
      const restart = await this.transitionBaselineWithLocalMembers({
        packageName,
        baseline,
        previous,
        enabled: bundle.enabled,
        existingRecord,
        workspaceDir,
      })
      return await this.inspectBundle(packageName, restart)
    } finally {
      this.busy = false
    }
  }

  async setMembersMode(packageName: string, mode: MembersMode): Promise<BundleLocalDevStatus> {
    this.assertEnabled()
    if (packageName === PACKAGE) throw new LocalDevError('protected', `${PACKAGE} cannot replace itself`)
    if (this.busy) throw new LocalDevError('busy', 'Another local development operation is in progress')
    this.busy = true
    try {
      const workspaceDir = await validateWorkspaceDir(this.options.getWorkspaceDir())
      const [bundles, existingRecord] = await Promise.all([
        this.options.manager.listBundles(),
        this.options.store.readRecord(packageName),
      ])
      const bundle = bundles.find(item => item.name === packageName && item.installed)
      if (!bundle) throw new LocalDevError('not-installed', packageName)
      this.assertManageable(bundle)

      const currentBaseline = resolveBaselineSource(bundle)
      if (!currentBaseline) throw new LocalDevError('not-manageable', `${packageName}: unsupported source`)

      if (existingRecord && !(await sameBundleSource(bundle, existingRecord.activeSpec, existingRecord.activeVersion))) {
        throw new LocalDevError('external-drift', `${packageName}: installed source changed externally to ${bundle.source}`)
      }

      const installedRoot = resolveBundleRootFromInfo(this.options.profileDir, bundle)
      const checkedCurrent = await readCheckedBundle(installedRoot, packageName)
      if (!checkedCurrent.aggregate) {
        throw new LocalDevError('not-aggregate', `${packageName} is not an aggregate bundle`)
      }

      let localCheckoutRoot: string | undefined
      try {
        localCheckoutRoot = (await inspectSiblingCheckout(workspaceDir, packageName)).root
      } catch {
        localCheckoutRoot = undefined
      }
      const startedLocal = !existingRecord
        && localCheckoutRoot !== undefined
        && (await sameSpec(bundle.source, `link:${localCheckoutRoot}`))
      const currentSelfMode: SelfMode = existingRecord?.selfMode ?? (startedLocal ? 'local' : 'baseline')
      const currentMembersMode: MembersMode = existingRecord?.membersMode ?? 'bundled'

      if (currentMembersMode === mode) {
        return await this.inspectBundle(packageName)
      }

      const baseline = existingRecord?.baseline ?? {
        spec: currentBaseline.spec,
        version: currentBaseline.version,
        enabled: bundle.enabled,
      }
      const previous: SourceRef = { spec: currentBaseline.spec, version: currentBaseline.version }

      if (mode === 'local') {
        const baseRoot = currentSelfMode === 'local'
          ? (localCheckoutRoot ?? (await inspectSiblingCheckout(workspaceDir, packageName)).root)
          : installedRoot
        const baseBundle = await readCheckedBundle(baseRoot, packageName)
        const overlay = await buildLocalMembersOverlay({
          store: this.options.store,
          profileDir: this.options.profileDir,
          baseBundle,
          workspaceDir,
        })
        const target: SourceRef = { spec: `link:${overlay.overlayDir}`, version: overlay.version }
        const nextRecord: ManagedBundleRecord = {
          packageName,
          isAggregate: true,
          baseline,
          selfMode: currentSelfMode,
          membersMode: 'local',
          activeSpec: target.spec,
          activeVersion: target.version,
          overlayDir: overlay.overlayDir,
          memberPaths: overlay.memberPaths,
          updatedAt: new Date().toISOString(),
        }
        const restart = await this.commitTransition({
          packageName,
          previous,
          target,
          enabled: bundle.enabled,
          existingRecord,
          nextRecord,
          verify: () => verifyOverlay(overlay.overlayDir, packageName, overlay.version, overlay.memberPaths),
        })
        await this.options.store.gcOverlays(packageName, overlay.overlayDir)
        return await this.inspectBundle(packageName, restart)
      }

      // mode === 'bundled'
      let target: SourceRef
      if (currentSelfMode === 'local') {
        const checkout = await inspectSiblingCheckout(workspaceDir, packageName)
        target = { spec: `link:${checkout.root}`, version: checkout.version }
      } else {
        target = { spec: baseline.spec, version: baseline.version }
      }

      const returnsToBaseline = await sameSpec(target.spec, baseline.spec) && target.version === baseline.version
      const nextRecord: ManagedBundleRecord | undefined = returnsToBaseline
        ? undefined
        : {
          packageName,
          isAggregate: true,
          baseline,
          selfMode: currentSelfMode,
          membersMode: 'bundled',
          activeSpec: target.spec,
          activeVersion: target.version,
          updatedAt: new Date().toISOString(),
        }

      const restart = await this.commitTransition({
        packageName,
        previous,
        target,
        enabled: bundle.enabled,
        existingRecord,
        nextRecord,
      })
      await this.options.store.gcOverlays(packageName, undefined)
      return await this.inspectBundle(packageName, restart)
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
  }

  private async transitionBaselineWithLocalMembers(options: {
    readonly packageName: string
    readonly baseline: ManagedBundleRecord['baseline']
    readonly previous: SourceRef
    readonly enabled: boolean
    readonly existingRecord: ManagedBundleRecord
    readonly workspaceDir: string
  }): Promise<boolean> {
    const { packageName, baseline, previous, enabled, existingRecord, workspaceDir } = options
    const baselinePath = localPathOf(baseline.spec)
    if (baselinePath !== undefined) {
      const baseBundle = await readCheckedBundle(baselinePath, packageName)
      const overlay = await buildLocalMembersOverlay({
        store: this.options.store,
        profileDir: this.options.profileDir,
        baseBundle,
        workspaceDir,
      })
      const target: SourceRef = { spec: `link:${overlay.overlayDir}`, version: overlay.version }
      const nextRecord: ManagedBundleRecord = {
        packageName,
        isAggregate: true,
        baseline,
        selfMode: 'baseline',
        membersMode: 'local',
        activeSpec: target.spec,
        activeVersion: target.version,
        overlayDir: overlay.overlayDir,
        memberPaths: overlay.memberPaths,
        updatedAt: new Date().toISOString(),
      }
      const restart = await this.commitTransition({
        packageName,
        previous,
        target,
        enabled,
        existingRecord,
        nextRecord,
        verify: () => verifyOverlay(overlay.overlayDir, packageName, overlay.version, overlay.memberPaths),
      })
      await this.options.store.gcOverlays(packageName, overlay.overlayDir)
      return restart
    }

    // Registry baseline: temporarily install baseline (disabled) to materialize its files for overlay copy.
    let restart = false
    const baselineRef: SourceRef = { spec: baseline.spec, version: baseline.version }
    await this.preflight(packageName, baselineRef, true)
    const removed = await this.options.manager.removeBundle(packageName)
    if (!isAccepted(removed)) throw new LocalDevError('switch-failed', changeDiagnostic(removed))
    restart ||= removed.application === 'restart-required'

    try {
      const baseInstall = await this.options.manager.installBundle(baseline.spec, {
        enabled: false,
        saveExact: true,
        expected: { name: packageName, version: baseline.version },
      })
      if (!isAccepted(baseInstall)) throw new LocalDevError('switch-failed', changeDiagnostic(baseInstall))
      restart ||= baseInstall.application === 'restart-required'

      const baseRoot = join(this.options.profileDir, 'node_modules', ...packageName.split('/'))
      const baseBundle = await readCheckedBundle(baseRoot, packageName)
      const overlay = await buildLocalMembersOverlay({
        store: this.options.store,
        profileDir: this.options.profileDir,
        baseBundle,
        workspaceDir,
      })
      const target: SourceRef = { spec: `link:${overlay.overlayDir}`, version: overlay.version }
      const nextRecord: ManagedBundleRecord = {
        packageName,
        isAggregate: true,
        baseline,
        selfMode: 'baseline',
        membersMode: 'local',
        activeSpec: target.spec,
        activeVersion: target.version,
        overlayDir: overlay.overlayDir,
        memberPaths: overlay.memberPaths,
        updatedAt: new Date().toISOString(),
      }
      await this.options.store.writeRecord(packageName, nextRecord)

      const removeTemp = await this.options.manager.removeBundle(packageName)
      if (!isAccepted(removeTemp)) throw new LocalDevError('switch-failed', changeDiagnostic(removeTemp))
      restart ||= removeTemp.application === 'restart-required'

      const overlayInstall = await this.options.manager.installBundle(target.spec, {
        enabled,
        saveExact: true,
        expected: { name: packageName, version: target.version },
      })
      if (!isAccepted(overlayInstall)) throw new LocalDevError('switch-failed', changeDiagnostic(overlayInstall))
      restart ||= overlayInstall.application === 'restart-required'

      await verifyOverlay(overlay.overlayDir, packageName, overlay.version, overlay.memberPaths)
      await this.options.store.gcOverlays(packageName, overlay.overlayDir)
      return restart
    } catch (error) {
      try {
        await this.rollback(packageName, previous, enabled, existingRecord)
      } catch (rollbackError) {
        throw new LocalDevError(
          'rollback-failed',
          `${previous.spec}\n${error instanceof Error ? error.message : String(error)}\n` +
            `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        )
      }
      throw error instanceof LocalDevError
        ? error
        : new LocalDevError('switch-failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async commitTransition(params: {
    readonly packageName: string
    readonly previous: SourceRef
    readonly target: SourceRef
    readonly enabled: boolean
    readonly existingRecord: ManagedBundleRecord | undefined
    readonly nextRecord: ManagedBundleRecord | undefined
    readonly verify?: () => Promise<void>
  }): Promise<boolean> {
    const { packageName, previous, target, enabled, existingRecord, nextRecord, verify } = params
    await this.preflight(packageName, target, true)

    // Persist intent before mutating profile so recovery points survive crashes.
    const pendingRecord: ManagedBundleRecord = nextRecord ?? {
      ...(existingRecord!),
      selfMode: 'baseline',
      membersMode: 'bundled',
      activeSpec: target.spec,
      activeVersion: target.version,
      updatedAt: new Date().toISOString(),
    }
    await this.options.store.writeRecord(packageName, pendingRecord)

    try {
      const restart = await this.replaceBundle(packageName, target, enabled)
      await verify?.()
      await this.options.store.writeRecord(packageName, nextRecord)
      return restart
    } catch (error) {
      try {
        await this.rollback(packageName, previous, enabled, existingRecord)
      } catch (rollbackError) {
        throw new LocalDevError(
          'rollback-failed',
          `${previous.spec}\n${error instanceof Error ? error.message : String(error)}\n` +
            `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        )
      }
      throw error instanceof LocalDevError
        ? error
        : new LocalDevError('switch-failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async preflight(packageName: string, target: SourceRef, currentlyInstalled: boolean): Promise<void> {
    const inspection = await this.options.manager.inspect(target.spec)
    if (inspection.status === 'accepted') {
      const expectedKind = localPathOf(target.spec) !== undefined ? 'path' : 'registry'
      if (inspection.name !== packageName || inspection.version !== target.version
        || inspection.bundle !== true || inspection.kind !== expectedKind) {
        throw new LocalDevError('invalid-checkout', `${target.spec} did not inspect as ${packageName}@${target.version}`)
      }
      return
    }
    if (currentlyInstalled && inspection.problem === 'already-installed'
      && inspection.reason === `${packageName} is already installed`) {
      return
    }
    throw new LocalDevError('switch-failed', inspection.reason)
  }

  private async replaceBundle(packageName: string, target: SourceRef, enabled: boolean): Promise<boolean> {
    let restart = false
    const current = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
    if (current) {
      const removed = await this.options.manager.removeBundle(packageName)
      if (!isAccepted(removed)) throw new LocalDevError('switch-failed', changeDiagnostic(removed))
      restart ||= removed.application === 'restart-required'
    }
    const installed = await this.options.manager.installBundle(target.spec, {
      enabled,
      saveExact: true,
      expected: { name: packageName, version: target.version },
    })
    if (!isAccepted(installed)) throw new LocalDevError('switch-failed', changeDiagnostic(installed))
    restart ||= installed.application === 'restart-required'

    const after = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
    if (!after || !(await sameBundleSource(after, target.spec, target.version)) || after.enabled !== enabled) {
      throw new LocalDevError('switch-failed', `${packageName}: post-install state verification failed`)
    }
    return restart
  }

  private async rollback(
    packageName: string,
    previous: SourceRef,
    enabled: boolean,
    existingRecord: ManagedBundleRecord | undefined,
  ): Promise<void> {
    const now = (await this.options.manager.listBundles()).find(b => b.name === packageName && b.installed)
    if (now && (await sameBundleSource(now, previous.spec, previous.version)) && now.enabled === enabled) {
      await this.options.store.writeRecord(packageName, existingRecord)
      return
    }
    await this.replaceBundle(packageName, previous, enabled)
    await this.options.store.writeRecord(packageName, existingRecord)
  }

  private async computeStatus(
    packageName: string,
    bundle: BundleInfo | undefined,
    record: ManagedBundleRecord | undefined,
    realWorkspaceDir: string | undefined,
    restartRequired = false,
  ): Promise<BundleLocalDevStatus> {
    let unmanageableReason: UnmanageableReason | undefined
    if (packageName === PACKAGE) unmanageableReason = 'self'
    else if (!bundle || !bundle.installed) unmanageableReason = 'not-installed'
    else if (bundle.official) unmanageableReason = 'official'
    else if (bundle.readOnlyReason !== undefined || !bundle.removable || bundle.availability !== 'profile') {
      unmanageableReason = bundle.availability === 'missing' ? 'missing-files' : 'read-only'
    } else if (!resolveBaselineSource(bundle)) {
      unmanageableReason = 'unsupported-source'
    }

    let checked: CheckedBundle | undefined
    if (bundle?.installed && bundle.availability === 'profile') {
      try {
        checked = await readCheckedBundle(resolveBundleRootFromInfo(this.options.profileDir, bundle), packageName)
      } catch {
        unmanageableReason ??= 'missing-files'
      }
    }

    const aggregate = checked?.aggregate
    const isAggregate = aggregate !== undefined || record?.isAggregate === true
    const drifted = bundle !== undefined && record !== undefined
      ? !(await sameBundleSource(bundle, record.activeSpec, record.activeVersion))
      : false

    let localCheckoutDir: string | undefined
    let localCheckoutAvailable = false
    let localCheckoutVersion: string | undefined
    let localCheckoutIssue: string | undefined
    if (realWorkspaceDir !== undefined) {
      localCheckoutDir = join(realWorkspaceDir, packageBasename(packageName))
      try {
        const local = await inspectSiblingCheckout(realWorkspaceDir, packageName)
        localCheckoutAvailable = true
        localCheckoutVersion = local.version
      } catch (error) {
        localCheckoutIssue = error instanceof Error ? error.message : String(error)
      }
    }

    const startedLocal = bundle !== undefined
      && record === undefined
      && localCheckoutAvailable
      && localCheckoutDir !== undefined
      && (await sameSpec(bundle.source, `link:${localCheckoutDir}`))

    const selfMode: SelfMode = record && !drifted
      ? record.selfMode
      : (startedLocal ? 'local' : 'baseline')
    const membersMode: MembersMode = record && !drifted ? record.membersMode : 'bundled'

    const members: MemberLocalStatus[] = []
    if (aggregate) {
      for (const memberName of aggregate.plugins) {
        const checkoutDir = realWorkspaceDir !== undefined
          ? join(realWorkspaceDir, packageBasename(memberName))
          : packageBasename(memberName)
        if (realWorkspaceDir === undefined) {
          members.push({
            name: memberName,
            checkoutDir,
            available: false,
            activeLocal: membersMode === 'local' && !drifted,
          })
          continue
        }
        try {
          const checkedMember = await inspectSiblingCheckout(realWorkspaceDir, memberName)
          members.push({
            name: memberName,
            checkoutDir: checkedMember.root,
            available: true,
            activeLocal: membersMode === 'local' && !drifted,
            version: checkedMember.version,
          })
        } catch (error) {
          members.push({
            name: memberName,
            checkoutDir,
            available: false,
            activeLocal: membersMode === 'local' && !drifted,
            issue: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    const membersReady = isAggregate && members.length > 0 && members.every(member => member.available)
    const manageable = unmanageableReason === undefined
    const baselineDistinctFromLocal = record !== undefined
      && (localCheckoutDir === undefined || !(await sameSpec(record.baseline.spec, `link:${localCheckoutDir}`)))

    return {
      packageName,
      installed: bundle?.installed ?? false,
      enabled: bundle?.enabled ?? false,
      official: bundle?.official ?? false,
      isAggregate,
      ...(aggregate ? { aggregateVersion: aggregate.version } : {}),
      manageable,
      ...(unmanageableReason ? { unmanageableReason } : {}),
      selfMode,
      membersMode,
      ...(bundle?.source !== undefined ? { currentSource: bundle.source } : {}),
      ...(bundle?.version !== undefined ? { currentVersion: bundle.version } : {}),
      ...(record ? { baselineSource: record.baseline.spec, baselineVersion: record.baseline.version } : {}),
      canRestoreSelf: manageable && !drifted && selfMode === 'local' && baselineDistinctFromLocal,
      canSwitchSelfToLocal: manageable && !drifted && selfMode === 'baseline' && localCheckoutAvailable && (membersMode === 'bundled' || membersReady),
      canSwitchMembersToLocal: manageable && !drifted && isAggregate && membersMode === 'bundled' && membersReady && (selfMode === 'baseline' || localCheckoutAvailable),
      canRestoreMembers: manageable && !drifted && isAggregate && membersMode === 'local',
      ...(localCheckoutDir !== undefined ? { localCheckoutDir } : {}),
      localCheckoutAvailable,
      ...(localCheckoutVersion !== undefined ? { localCheckoutVersion } : {}),
      ...(localCheckoutIssue !== undefined ? { localCheckoutIssue } : {}),
      members,
      membersReady,
      drifted,
      ...(record?.overlayDir !== undefined ? { activeOverlayDir: record.overlayDir } : {}),
      ...(restartRequired ? { restartRequired: true } : {}),
    }
  }
}
