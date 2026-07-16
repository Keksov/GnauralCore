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
  ProjectUndoPutRequest,
  ProjectUndoResponse,
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

  /** value: null removes the section. keepalive so a flush issued on page unload still lands. */
  putSection(request: ProjectSectionPutRequest, signal?: AbortSignal): Promise<ProjectInfo> {
    return requestJson<ProjectInfo>('/api/projects/section', {
      method: 'POST',
      body: JSON.stringify(request),
      keepalive: true,
      signal,
    })
  },

  fetchUndoJournal(id: string, signal?: AbortSignal): Promise<ProjectUndoResponse> {
    return requestJson<ProjectUndoResponse>(`/api/projects/undo?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  /** journal: null clears the stored journal. */
  async putUndoJournal(request: ProjectUndoPutRequest, signal?: AbortSignal): Promise<void> {
    await requestJson<null>('/api/projects/undo', {
      method: 'POST',
      body: JSON.stringify(request),
      keepalive: true,
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
