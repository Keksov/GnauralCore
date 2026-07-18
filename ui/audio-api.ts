import type {
  AudioFileKind,
  AudioEditorAutosaveRequest,
  AudioEditorDocumentResponse,
  AudioEditorHistoryContentResponse,
  AudioEditorHistoryResponse,
  AudioEditorRestoreRequest,
  AudioEditorRestoreResponse,
  AudioEditorSaveRequest,
  AudioEditorSaveResponse,
  AudioScheduleVoicePatchRequest,
  AudioScheduleVoicePatchResponse,
  AudioSettings,
  GnauralScheduleData,
} from '@protocol'

// GT6.2 (GT-D11): mirrors the server's CacheSummary (server/audio-cache-manifest.ts).
export interface AudioCacheEntry {
  readonly cacheFile: string
  readonly kind: string
  readonly discriminator: string
  readonly bytes: number
  readonly createdAt: string | null
}
export interface AudioCacheSource {
  readonly sourcePath: string
  readonly sourceName: string
  readonly totalBytes: number
  readonly entries: AudioCacheEntry[]
}
export interface AudioCacheSummary {
  readonly totalBytes: number
  readonly sources: AudioCacheSource[]
  readonly orphanBytes: number
  readonly orphans: AudioCacheEntry[]
}

interface AudioScheduleVoiceBatchPatch {
  readonly voiceId: number
  readonly hidden?: boolean
  readonly muted?: boolean
  readonly color?: string
}

interface AudioScheduleVoiceBatchPatchResponse {
  readonly filePath: string
  readonly modifiedAtMs: number
  readonly savedAt: string
  readonly changed: boolean
  readonly historyFileName: string | null
  readonly items: readonly {
    readonly voiceId: number
    readonly voiceIndex: number
    readonly changed: boolean
  }[]
}

type LocalAudioFileKind = Exclude<AudioFileKind, 'gnaural'>

interface AudioFileRequestOptions {
  readonly format?: LocalAudioFileKind
  /** GT2.6: for a gnaural WAV render, cap to a single loop (spectrogram display, not export). */
  readonly singleLoop?: boolean
}

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

function buildAudioFileUrl(filePath: string, options?: AudioFileRequestOptions): string {
  const params = new URLSearchParams({ path: filePath })
  if (options?.format !== undefined) {
    params.set('format', options.format)
  }
  if (options?.singleLoop === true) {
    params.set('singleLoop', '1')
  }

  return `/api/audio/file?${params.toString()}`
}

export const audioApi = {
  fetchAudioSettings(): Promise<AudioSettings> {
    return requestJson<AudioSettings>('/api/audio-settings', { method: 'GET' })
  },

  updateAudioSettings(presetsRoot: string): Promise<AudioSettings> {
    return requestJson<AudioSettings>('/api/audio-settings', {
      method: 'PATCH',
      body: JSON.stringify({ presetsRoot }),
    })
  },

  fetchSchedule(filePath: string, signal?: AbortSignal): Promise<GnauralScheduleData> {
    return requestJson<GnauralScheduleData>(`/api/audio/schedule?path=${encodeURIComponent(filePath)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  // GT6.2 (owner req. 13, GT-D11): audio output cache management.
  fetchAudioCacheSummary(signal?: AbortSignal): Promise<AudioCacheSummary> {
    return requestJson<AudioCacheSummary>('/api/audio/cache', { method: 'GET', cache: 'no-store', signal })
  },
  deleteAudioCache(query: { all?: boolean; source?: string; cacheFile?: string }, signal?: AbortSignal): Promise<{ deleted: number }> {
    const params = new URLSearchParams()
    if (query.all === true) params.set('all', '1')
    if (query.source !== undefined) params.set('source', query.source)
    if (query.cacheFile !== undefined) params.set('cacheFile', query.cacheFile)
    return requestJson<{ deleted: number }>(`/api/audio/cache?${params.toString()}`, { method: 'DELETE', signal })
  },

  fetchEditorDocument(filePath: string, signal?: AbortSignal): Promise<AudioEditorDocumentResponse> {
    return requestJson<AudioEditorDocumentResponse>(`/api/audio/editor?path=${encodeURIComponent(filePath)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  saveEditorDocument(request: AudioEditorSaveRequest, signal?: AbortSignal): Promise<AudioEditorSaveResponse> {
    return requestJson<AudioEditorSaveResponse>('/api/audio/editor/save', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  autosaveEditorDocument(request: AudioEditorAutosaveRequest, signal?: AbortSignal): Promise<{
    readonly fileName: string
    readonly createdAt: string
    readonly modifiedAtMs: number
    readonly size: number
    readonly isAutosave: boolean
  }> {
    return requestJson('/api/audio/editor/autosave', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  fetchEditorHistory(filePath: string, signal?: AbortSignal): Promise<AudioEditorHistoryResponse> {
    return requestJson<AudioEditorHistoryResponse>(`/api/audio/editor/history?path=${encodeURIComponent(filePath)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  fetchEditorHistoryContent(filePath: string, historyFileName: string, signal?: AbortSignal): Promise<AudioEditorHistoryContentResponse> {
    const search = new URLSearchParams({
      path: filePath,
      name: historyFileName,
    })

    return requestJson<AudioEditorHistoryContentResponse>(`/api/audio/editor/history/content?${search.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
  },

  restoreEditorHistory(request: AudioEditorRestoreRequest, signal?: AbortSignal): Promise<AudioEditorRestoreResponse> {
    return requestJson<AudioEditorRestoreResponse>('/api/audio/editor/history/restore', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  // project-store PR2.4: live mute for the RUNNING engine only — persistence lives in the
  // project's voiceState section, the .gnaural file is not touched (owner req 9).
  applyLiveVoiceMute(
    filePath: string,
    items: readonly { readonly voiceIndex: number; readonly muted: boolean }[],
    signal?: AbortSignal,
  ): Promise<{ readonly applied: number }> {
    return requestJson<{ readonly applied: number }>('/api/audio/voice-mute', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, items }),
      signal,
    })
  },

  /** @deprecated project-store PR2.4: the UI no longer writes voice state into the .gnaural. */
  patchScheduleVoiceState(request: AudioScheduleVoicePatchRequest, signal?: AbortSignal): Promise<AudioScheduleVoicePatchResponse> {
    return requestJson<AudioScheduleVoicePatchResponse>('/api/audio/schedule/voice-state', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    })
  },

  patchScheduleVoiceStates(
    filePath: string,
    patches: readonly AudioScheduleVoiceBatchPatch[],
    signal?: AbortSignal,
  ): Promise<AudioScheduleVoiceBatchPatchResponse> {
    return requestJson<AudioScheduleVoiceBatchPatchResponse>('/api/audio/schedule/voice-state', {
      method: 'POST',
      body: JSON.stringify({
        path: filePath,
        patches,
      }),
      signal,
    })
  },

  async fetchAudioFileBlob(
    filePath: string,
    signal?: AbortSignal,
    options?: AudioFileRequestOptions,
  ): Promise<Blob> {
    const response = await fetch(buildAudioFileUrl(filePath, options), {
      method: 'GET',
      cache: 'no-store',
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      const payload = parseJsonText(text, 'Invalid JSON error response while loading the audio file')
      if (isRecord(payload) && typeof payload.error === 'string') {
        throw new Error(payload.error)
      }

      throw new Error(`Request failed with status ${response.status}`)
    }

    return response.blob()
  },

  getFileUrl(filePath: string, options?: AudioFileRequestOptions): string {
    return buildAudioFileUrl(filePath, options)
  },
} as const