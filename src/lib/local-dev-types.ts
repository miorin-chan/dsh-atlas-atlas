export const PACKAGE = '@miorin/dsh-atlas-atlas'
export const ENTRY_ID = 'dsh-atlas-atlas'
export const LOCAL_DEV_ROUTE = '/api/dsh-atlas-local-dev'
export const NPM_REGISTRY = 'https://registry.npmjs.org/'

export type SourceMode = 'npm' | 'local'

export interface LocalDevConfig {
  readonly localDevEnabled: boolean
  readonly localWorkspaceDir: string
}

export interface MemberLocalStatus {
  readonly name: string
  readonly checkoutDir: string
  readonly available: boolean
  readonly bundledAvailable: boolean
  readonly mode: SourceMode
  readonly canSwitchToLocal: boolean
  readonly canSwitchToNpm: boolean
  readonly version?: string
  readonly issue?: string
}

export type UnmanageableReason =
  | 'self'
  | 'official'
  | 'not-installed'
  | 'read-only'
  | 'unsupported-source'
  | 'missing-files'

export interface BundleLocalDevStatus {
  readonly packageName: string
  readonly installed: boolean
  readonly enabled: boolean
  readonly official: boolean
  readonly isAggregate: boolean
  readonly aggregateVersion?: number
  readonly manageable: boolean
  readonly unmanageableReason?: UnmanageableReason
  readonly mode: SourceMode
  readonly currentSource?: string
  readonly currentVersion?: string
  readonly canSwitchToLocal: boolean
  readonly canSwitchToNpm: boolean
  readonly localCheckoutDir?: string
  readonly localCheckoutAvailable: boolean
  readonly localCheckoutVersion?: string
  readonly localCheckoutIssue?: string
  readonly members: readonly MemberLocalStatus[]
  readonly membersReady: boolean
  readonly activeOverlayDir?: string
  readonly restartRequired?: boolean
}

export interface LocalDevOverview {
  readonly enabled: boolean
  readonly workspaceDir: string
  readonly workspaceDirValid: boolean
  readonly workspaceDirIssue?: string
  readonly aggregateBundles: readonly BundleLocalDevStatus[]
}

export interface PreparedLocalSpec {
  readonly spec: string
  readonly version: string
  readonly isAggregate: boolean
  readonly overlayDir?: string
}

export type LocalDevErrorCode =
  | 'disabled'
  | 'no-workspace-dir'
  | 'invalid-request'
  | 'forbidden'
  | 'busy'
  | 'protected'
  | 'not-installed'
  | 'not-manageable'
  | 'missing-checkout'
  | 'invalid-checkout'
  | 'overlay-failed'
  | 'switch-failed'

export class LocalDevError extends Error {
  constructor(
    readonly code: LocalDevErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'LocalDevError'
  }
}

export type LocalDevRequest =
  | { readonly action: 'overview' }
  | { readonly action: 'inspect'; readonly packageName: string }
  | { readonly action: 'switch'; readonly packageName: string; readonly mode: SourceMode }
  | { readonly action: 'switch-member'; readonly packageName: string; readonly memberName: string; readonly mode: SourceMode }
  | { readonly action: 'prepare-local'; readonly packageName: string }

export type LocalDevResponse<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LocalDevErrorCode; readonly detail?: string }

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

export function isPackageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 214 && PACKAGE_NAME.test(value)
}

export function packageBasename(name: string): string {
  if (!isPackageName(name)) throw new LocalDevError('invalid-request', `Invalid package name: ${JSON.stringify(name)}`)
  return name.slice(name.lastIndexOf('/') + 1)
}

export function parseLocalDevRequest(raw: unknown): LocalDevRequest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LocalDevError('invalid-request', 'Expected JSON object')
  }
  const input = raw as Record<string, unknown>
  const { action, packageName, memberName, mode } = input
  if (action === 'overview') return { action }
  if (!isPackageName(packageName)) {
    throw new LocalDevError('invalid-request', 'Valid packageName is required')
  }
  if (action === 'inspect' || action === 'prepare-local') {
    return { action, packageName }
  }
  if (action === 'switch' && (mode === 'npm' || mode === 'local')) {
    return { action, packageName, mode }
  }
  if (action === 'switch-member' && isPackageName(memberName) && (mode === 'npm' || mode === 'local')) {
    return { action, packageName, memberName, mode }
  }
  throw new LocalDevError('invalid-request', `Unsupported action or mode: ${JSON.stringify(action)}`)
}
