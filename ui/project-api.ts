// project-store PR1.5 (PR-D5): UI client for the "Project" entity REST surface (/api/projects*),
// modeled on audio-api.ts. The reactive layer (debounced section writes, flush on file switch)
// lives in composables/use-project.ts — subsystems normally go through that, not this file.
import type {
  ProjectInfo,
  ProjectListResponse,
  ProjectRelinkRequest,
  ProjectSectionPutRequest,
  ProjectSectionResponse,
  ProjectSettingsPatchRequest,
  ProjectSettingsResponse,
  ProjectUndoLogAppendRequest,
  ProjectUndoLogAppendResponse,
  ProjectUndoLogBranchesResponse,
  ProjectUndoLogChainResponse,
  ProjectUndoLogCommitType,
  ProjectUndoLogDeleteBranchRequest,
  ProjectUndoLogDeleteBranchResponse,
  ProjectUndoLogRefsRequest,
  ProjectUndoLogRefsResponse,
} from '@protocol'

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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  const payload = parseJsonText(text, `Invalid JSON response from ${path}`)

  if (!response.ok) {
    if (isRecord(payload) && typeof payload.error === 'string') {
      throw new Error(payload.error)
    }

    throw new Error(`Request failed with status ${response.status}`)
  }

  return payload as T
}

export const projectApi = {
  /** Find-or-create the project for a source file; provisions the folder server-side. */
  openProject(path: string, signal?: AbortSignal): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>('/api/projects/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
      signal,
    })
  },

  fetchProjects(signal?: AbortSignal): Promise<ProjectListResponse> {
    return requestJson<ProjectListResponse>('/api/projects', { method: 'GET', cache: 'no-store', signal })
  },

  fetchProject(id: string, signal?: AbortSignal): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>(`/api/projects/info?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  fetchSection(id: string, name: string, signal?: AbortSignal): Promise<ProjectSectionResponse> {
    const search = new URLSearchParams({ id, name })
    return requestJson<ProjectSectionResponse>(`/api/projects/section?${search.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  /** value: null removes the section. keepalive only for the unload flush — a >64 KB keepalive body is
   *  refused by the browser (TypeError: Failed to fetch), so regular debounced writes must NOT use it. */
  putSection(request: ProjectSectionPutRequest, signal?: AbortSignal, keepalive = false): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>('/api/projects/section', {
      method: 'POST',
      body: JSON.stringify(request),
      keepalive,
      signal,
    })
  },

  // undo-versioned-log VL4.1 (VL-D4): the append-only commit log transport (/api/projects/undo-log*).
  fetchUndoLogChain(
    id: string,
    options: { from?: string; limit?: number; untilType?: ProjectUndoLogCommitType } = {},
    signal?: AbortSignal,
  ): Promise<ProjectUndoLogChainResponse> {
    const search = new URLSearchParams({ id })
    if (options.from !== undefined) {
      search.set('from', options.from)
    }
    if (options.limit !== undefined) {
      search.set('limit', String(options.limit))
    }
    if (options.untilType !== undefined) {
      search.set('untilType', options.untilType)
    }
    return requestJson<ProjectUndoLogChainResponse>(`/api/projects/undo-log?${search.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  /** A 409 (batch cut at rejectedFrom, S3) carries the same body and is RETURNED, not thrown —
   *  the accepted prefix IS persisted and the caller reconciles by re-reading the chain.
   *  keepalive only for the unload flush (see putSection). */
  async appendUndoLog(
    request: ProjectUndoLogAppendRequest,
    signal?: AbortSignal,
    keepalive = false,
  ): Promise<ProjectUndoLogAppendResponse> {
    const response = await fetch('/api/projects/undo-log/append', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      keepalive,
      signal,
    })
    const text = await response.text()
    const payload = parseJsonText(text, 'Invalid JSON response from /api/projects/undo-log/append')

    if (!response.ok && response.status !== 409) {
      if (isRecord(payload) && typeof payload.error === 'string') {
        throw new Error(payload.error)
      }
      throw new Error(`Request failed with status ${response.status}`)
    }

    return payload as ProjectUndoLogAppendResponse
  },

  /** keepalive only for the unload flush — a refs body is tiny, but the rule stays uniform. */
  putUndoLogRefs(request: ProjectUndoLogRefsRequest, signal?: AbortSignal, keepalive = false): Promise<ProjectUndoLogRefsResponse> {
    return requestJson<ProjectUndoLogRefsResponse>('/api/projects/undo-log/refs', {
      method: 'POST',
      body: JSON.stringify(request),
      keepalive,
      signal,
    })
  },

  async clearUndoLog(id: string, signal?: AbortSignal): Promise<void> {
    await requestJson<null>('/api/projects/undo-log/clear', {
      method: 'POST',
      body: JSON.stringify({ id }),
      signal,
    })
  },

  // undo-orphan-branches (OB-D5): abandoned lines of the log — list and targeted deletion.
  fetchUndoLogBranches(id: string, signal?: AbortSignal): Promise<ProjectUndoLogBranchesResponse> {
    return requestJson<ProjectUndoLogBranchesResponse>(`/api/projects/undo-log/branches?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  /** 409 (not a tip / tagged branch) is THROWN with the server's message — the panel notifies. */
  deleteUndoLogBranch(request: ProjectUndoLogDeleteBranchRequest, signal?: AbortSignal): Promise<ProjectUndoLogDeleteBranchResponse> {
    return requestJson<ProjectUndoLogDeleteBranchResponse>('/api/projects/undo-log/delete-branch', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  relinkProject(request: ProjectRelinkRequest, signal?: AbortSignal): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>('/api/projects/relink', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  async deleteProject(id: string, signal?: AbortSignal): Promise<void> {
    await requestJson<null>(`/api/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal })
  },

  // PR5.1/PR5.2 (PR-D10): one-file text bundle export/import.
  exportProject(id: string, signal?: AbortSignal): Promise<unknown> {
    return requestJson<unknown>(`/api/projects/export?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  importProject(bundle: unknown, overwrite: boolean, signal?: AbortSignal): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>('/api/projects/import', {
      method: 'POST',
      body: JSON.stringify({ bundle, overwrite }),
      signal,
    })
  },

  // PR4.3: open the project folder in the OS file manager (Windows desktop host).
  async revealProject(id: string, signal?: AbortSignal): Promise<void> {
    await requestJson<null>('/api/projects/reveal', {
      method: 'POST',
      body: JSON.stringify({ id }),
      signal,
    })
  },

  // PR3.1 (PR-D6): the user-data root setting.
  fetchProjectSettings(signal?: AbortSignal): Promise<ProjectSettingsResponse> {
    return requestJson<ProjectSettingsResponse>('/api/project-settings', { method: 'GET', cache: 'no-store', signal })
  },

  updateProjectSettings(request: ProjectSettingsPatchRequest, signal?: AbortSignal): Promise<ProjectSettingsResponse> {
    return requestJson<ProjectSettingsResponse>('/api/project-settings', {
      method: 'PATCH',
      body: JSON.stringify(request),
      signal,
    })
  },
} as const
