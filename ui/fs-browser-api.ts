// file-browser (FB2.1): client for the universal file-open dialog. Two origins are involved:
//  - /api/fs/info is served by the MAIN server (relative path, covered by the Vite dev proxy) and
//    tells us whether the loopback browse server is available + its absolute URL.
//  - /fs/roots|/fs/list|/fs/stat live on the loopback-only server (FB-D2), a DIFFERENT origin, so we
//    call them with an ABSOLUTE url built from info.url. That server sends permissive CORS.
import type { FsInfoResponse, FsRootsResponse, ListDirResult, StatResult } from '@protocol'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

function parseJsonText(text: string, errorMessage: string): unknown {
  if (text === '') {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(errorMessage)
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    // No default 'content-type': every fs call is a body-less GET, so it is meaningless — and on a
    // cross-origin GET (dev UI :9000 -> loopback fs server) a non-simple content-type forces a CORS
    // *preflight* (OPTIONS). That preflighted request intermittently stalls in the WebView2 network
    // stack and never reaches the server (the "hourglass forever" bug, diagnosed 2026-07-22 via
    // var/fs-browser.log: a stuck /fs/list had no server REQ line, while the header-less beacon to the
    // same origin always got through). Sending no custom header keeps every fs call a *simple*
    // cross-origin GET — exactly like that beacon, which never hangs.
    headers: {
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  const payload = parseJsonText(text, `Invalid JSON response from ${url}`)

  if (!response.ok) {
    if (isRecord(payload) && typeof payload.error === 'string') {
      throw new Error(payload.error)
    }

    throw new Error(`Request failed with status ${response.status}`)
  }

  return payload as T
}

// Strip a trailing slash so `${base}/fs/...` never doubles up.
const normalizeBase = (baseUrl: string): string => {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export const fsBrowserApi = {
  // Discovery on the main server. available:false means this client is not on the loopback host.
  fetchInfo(signal?: AbortSignal): Promise<FsInfoResponse> {
    return requestJson<FsInfoResponse>('/api/fs/info', { method: 'GET', signal })
  },

  listRoots(baseUrl: string, provider: string, signal?: AbortSignal): Promise<FsRootsResponse> {
    const search = new URLSearchParams({ provider })
    return requestJson<FsRootsResponse>(`${normalizeBase(baseUrl)}/fs/roots?${search.toString()}`, {
      method: 'GET',
      signal,
    })
  },

  listDir(
    baseUrl: string,
    provider: string,
    path: string,
    options?: { readonly showHidden?: boolean },
    signal?: AbortSignal,
  ): Promise<ListDirResult> {
    const search = new URLSearchParams({ provider, path })
    if (options?.showHidden === true) {
      search.set('hidden', '1')
    }
    return requestJson<ListDirResult>(`${normalizeBase(baseUrl)}/fs/list?${search.toString()}`, {
      method: 'GET',
      signal,
    })
  },

  stat(baseUrl: string, provider: string, path: string, signal?: AbortSignal): Promise<StatResult> {
    const search = new URLSearchParams({ provider, path })
    return requestJson<StatResult>(`${normalizeBase(baseUrl)}/fs/stat?${search.toString()}`, {
      method: 'GET',
      signal,
    })
  },
} as const
