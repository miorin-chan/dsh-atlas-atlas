import {
  LOCAL_DEV_ROUTE,
  type BundleLocalDevStatus,
  type LocalDevErrorCode,
  type LocalDevOverview,
  type LocalDevRequest,
  type LocalDevResponse,
} from '../lib/local-dev-types.js'

type TransportFetch = (input: string, init?: RequestInit) => Promise<Response>

function resolveFetch(): TransportFetch {
  const hostWindow = globalThis as { __DSH_TRANSPORT__?: { fetch?: TransportFetch }; fetch?: TransportFetch }
  const transportFetch = hostWindow.__DSH_TRANSPORT__?.fetch
  if (typeof transportFetch === 'function') return transportFetch
  if (typeof hostWindow.fetch === 'function') return hostWindow.fetch.bind(globalThis)
  throw new Error('Fetch transport unavailable')
}

export async function requestLocalDev<T>(
  request: LocalDevRequest,
  signal?: AbortSignal,
): Promise<LocalDevResponse<T>> {
  try {
    const fetchImpl = resolveFetch()
    const response = await fetchImpl(LOCAL_DEV_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal !== undefined ? { signal } : {}),
    })
    const payload = (await response.json()) as LocalDevResponse<T>
    if (payload && typeof payload === 'object' && 'ok' in payload) {
      return payload
    }
    return { ok: false, error: 'switch-failed', detail: `HTTP ${response.status}` }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'busy' }
    }
    return {
      ok: false,
      error: 'switch-failed' satisfies LocalDevErrorCode,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export function fetchLocalDevOverview(signal?: AbortSignal): Promise<LocalDevResponse<LocalDevOverview>> {
  return requestLocalDev<LocalDevOverview>({ action: 'overview' }, signal)
}

export function inspectBundleLocalDev(packageName: string, signal?: AbortSignal): Promise<LocalDevResponse<BundleLocalDevStatus>> {
  return requestLocalDev<BundleLocalDevStatus>({ action: 'inspect', packageName }, signal)
}
