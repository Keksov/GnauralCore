import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  AudioErrorEvent,
  AudioExitEvent,
  AudioFileKind,
  AudioProgressEvent,
  AudioRenderDoneEvent,
  AudioRenderProgressEvent,
  AudioRenderState,
  AudioScheduleChangedEvent,
  AudioScheduleLoadedEvent,
  AudioSettings,
  AudioStatusEvent,
  AudioTransportState,
  GnauralScheduleData,
  PresetTreeNode,
} from '@protocol'
import { audioApi } from '../audio-api'

// SF20: recent files (most-recent first, cap 5) for the toolbar quick-pick dropdown.
// Replaces the old single "restore last selected path" (which auto-loaded on tab open).
const STORAGE_AUDIO_RECENT_FILES = 'mindwave-audio-recent-files'
const RECENT_FILES_LIMIT = 5

const loadRecentFiles = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_RECENT_FILES)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string' && p !== '').slice(0, RECENT_FILES_LIMIT)
  } catch {
    return []
  }
}

type AudioContextCtor = typeof AudioContext

const getAudioContextCtor = (): AudioContextCtor | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const webkitAudioContext = (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  return window.AudioContext ?? webkitAudioContext ?? null
}

let decodeContext: AudioContext | null = null

const getDecodeContext = (): AudioContext | null => {
  if (decodeContext !== null) {
    return decodeContext
  }

  const AudioContextCtor = getAudioContextCtor()
  if (AudioContextCtor === null) {
    return null
  }

  decodeContext = new AudioContextCtor()
  return decodeContext
}

const createAudioElement = (): HTMLAudioElement | null => {
  if (typeof Audio === 'undefined') {
    return null
  }

  const element = new Audio()
  element.preload = 'auto'
  return element
}

const findNodeByPath = (
  nodes: readonly PresetTreeNode[],
  path: string,
): PresetTreeNode | null => {
  for (const node of nodes) {
    if (node.path === path) {
      return node
    }

    if (node.children !== undefined) {
      const childNode = findNodeByPath(node.children, path)
      if (childNode !== null) {
        return childNode
      }
    }
  }

  return null
}

type LocalAudioFileKind = Exclude<AudioFileKind, 'gnaural'>

const isLocalAudioFileKind = (
  aFileKind: AudioFileKind | null | undefined,
): aFileKind is LocalAudioFileKind => {
  return aFileKind === 'wav' || aFileKind === 'flac'
}

export const useAudioStore = defineStore('audio', () => {
  const audioElement = createAudioElement()
  let gnauralScheduleRequestId = 0
  let wavLoadRequestId = 0
  let gnauralScheduleAbortController: AbortController | null = null
  let wavLoadAbortController: AbortController | null = null
  let renderSpectrogramLoadRequestId = 0
  let renderSpectrogramAbortController: AbortController | null = null
  const settings = ref<AudioSettings>({ presetsRoot: '' })
  const presetsTree = ref<readonly PresetTreeNode[]>([])
  // SF20: no auto-load on Audio-tab open — the last file is NOT restored into the selection.
  const selectedPath = ref<string | null>(null)
  const recentFiles = ref<string[]>(loadRecentFiles())
  const selectedNode = ref<PresetTreeNode | null>(null)
  const remoteTransportState = ref<AudioTransportState>('idle')
  const localTransportState = ref<AudioTransportState>('idle')
  const renderState = ref<AudioRenderState>('idle')
  const activeFilePath = ref<string | null>(null)
  const activeFileKind = ref<AudioFileKind | null>(null)
  const remoteFilePath = ref<string | null>(null)
  const remoteFileKind = ref<AudioFileKind | null>(null)
  const remotePositionSec = ref(0)
  const localPositionSec = ref(0)
  const remoteDurationSec = ref(0)
  const localDurationSec = ref(0)
  const localFileKind = ref<LocalAudioFileKind | null>(null)
  const settingsLoading = ref(false)
  const presetsLoading = ref(false)
  const wavLoading = ref(false)
  const wavObjectUrl = ref<string | null>(null)
  const wavSourcePath = ref<string | null>(null)
  const wavAudioBuffer = ref<AudioBuffer | null>(null)
  const gnauralScheduleCache = ref<Record<string, GnauralScheduleData>>({})
  const gnauralScheduleLoadingPath = ref<string | null>(null)
  const gnauralScheduleErrorPath = ref<string | null>(null)
  const gnauralScheduleErrorMessage = ref<string | null>(null)
  const gnauralSpectrogramBuffer = ref<AudioBuffer | null>(null)
  const gnauralSpectrogramSourcePath = ref<string | null>(null)
  const gnauralSpectrogramLoading = ref(false)
  const pendingLocalStartPath = ref<string | null>(null)
  const spectrogramError = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const lastExitCode = ref<number | null>(null)

  const selectedFileKind = computed(() => selectedNode.value?.fileKind ?? null)
  const activePlaybackMode = computed<AudioFileKind | null>(() => {
    if (remoteTransportState.value !== 'idle') {
      return 'gnaural'
    }

    if (localTransportState.value !== 'idle' || wavLoading.value) {
      if (localFileKind.value !== null) {
        return localFileKind.value
      }

      return isLocalAudioFileKind(selectedFileKind.value) ? selectedFileKind.value : null
    }

    return null
  })
  const displayMode = computed<AudioFileKind | null>(() => {
    return activePlaybackMode.value ?? selectedFileKind.value
  })
  const displayFilePath = computed(() => {
    if (activePlaybackMode.value === 'gnaural') {
      return remoteFilePath.value
    }

    if (activePlaybackMode.value === 'wav') {
      return wavSourcePath.value
    }

    return selectedPath.value
  })
  const displayFileKind = computed(() => {
    if (activePlaybackMode.value === 'gnaural') {
      return remoteFileKind.value
    }

    if (isLocalAudioFileKind(activePlaybackMode.value)) {
      return localFileKind.value
    }

    return selectedFileKind.value
  })
  const gnauralSchedule = computed(() => {
    if (displayMode.value !== 'gnaural' || displayFilePath.value === null) {
      return null
    }

    return gnauralScheduleCache.value[displayFilePath.value] ?? null
  })
  const gnauralScheduleLoading = computed(() => {
    return displayMode.value === 'gnaural' && displayFilePath.value !== null && gnauralScheduleLoadingPath.value === displayFilePath.value
  })
  const gnauralScheduleError = computed(() => {
    if (
      displayMode.value !== 'gnaural' ||
      displayFilePath.value === null ||
      gnauralScheduleErrorPath.value !== displayFilePath.value
    ) {
      return null
    }

    return gnauralScheduleErrorMessage.value
  })
  const transportState = computed(() => {
    return isLocalAudioFileKind(displayMode.value) ? localTransportState.value : remoteTransportState.value
  })
  const positionSec = computed(() => {
    return isLocalAudioFileKind(displayMode.value) ? localPositionSec.value : remotePositionSec.value
  })
  const durationSec = computed(() => {
    if (isLocalAudioFileKind(displayMode.value)) {
      return localDurationSec.value
    }

    if (displayMode.value === 'gnaural') {
      if (
        displayFilePath.value !== null
        && displayFilePath.value === remoteFilePath.value
        && remoteDurationSec.value > 0
      ) {
        return remoteDurationSec.value
      }

      return gnauralSchedule.value?.totalTimeSec ?? 0
    }

    return remoteDurationSec.value
  })
  const spectrogramLoading = computed(() => {
    if (isLocalAudioFileKind(displayMode.value)) {
      return wavLoading.value
    }

    if (displayMode.value === 'gnaural') {
      return gnauralSpectrogramLoading.value || renderState.value === 'rendering'
    }

    return false
  })
  const spectrogramBuffer = computed(() => {
    if (isLocalAudioFileKind(displayMode.value) && displayFilePath.value === wavSourcePath.value) {
      return wavAudioBuffer.value
    }

    if (displayMode.value === 'gnaural' && displayFilePath.value === gnauralSpectrogramSourcePath.value) {
      return gnauralSpectrogramBuffer.value
    }

    return null
  })
  const canStart = computed(() => selectedNode.value?.isDir === false)
  const canPause = computed(() => {
    if (isLocalAudioFileKind(activePlaybackMode.value)) {
      return localTransportState.value === 'playing'
    }

    if (activePlaybackMode.value === 'gnaural') {
      return remoteTransportState.value === 'playing'
    }

    return false
  })
  const canResume = computed(() => {
    if (isLocalAudioFileKind(activePlaybackMode.value)) {
      return localTransportState.value === 'paused'
    }

    if (activePlaybackMode.value === 'gnaural') {
      return remoteTransportState.value === 'paused'
    }

    return false
  })
  const canStop = computed(() => {
    return activePlaybackMode.value !== null
  })
  const canSeek = computed(() => {
    if (isLocalAudioFileKind(activePlaybackMode.value)) {
      return localDurationSec.value > 0
    }

    if (activePlaybackMode.value === 'gnaural') {
      return remoteDurationSec.value > 0
    }

    if (displayMode.value === 'gnaural') {
      return displayFilePath.value !== null && displayFilePath.value === remoteFilePath.value && remoteDurationSec.value > 0
    }

    return isLocalAudioFileKind(displayMode.value) && localDurationSec.value > 0
  })

  // SF20: persist the recent-files list (the toolbar quick-pick uses it).
  watch(recentFiles, (value) => {
    try {
      localStorage.setItem(STORAGE_AUDIO_RECENT_FILES, JSON.stringify(value))
    } catch {
      // Ignore storage failures and keep the in-memory list working.
    }
  }, { deep: true })

  // Record a picked file at the front of the recent list (dedupe, cap RECENT_FILES_LIMIT).
  function recordRecentFile(path: string): void {
    recentFiles.value = [path, ...recentFiles.value.filter((p) => p !== path)].slice(0, RECENT_FILES_LIMIT)
  }

  function releaseWavObjectUrl(): void {
    if (wavObjectUrl.value !== null) {
      URL.revokeObjectURL(wavObjectUrl.value)
      wavObjectUrl.value = null
    }
  }

  function cancelPendingWavLoad(): void {
    wavLoadRequestId += 1

    if (wavLoadAbortController !== null) {
      wavLoadAbortController.abort()
      wavLoadAbortController = null
    }

    if (localTransportState.value === 'loading') {
      localTransportState.value = 'idle'
    }

    wavLoading.value = false
  }

  function cancelPendingRenderedSpectrogramLoad(): void {
    renderSpectrogramLoadRequestId += 1

    if (renderSpectrogramAbortController !== null) {
      renderSpectrogramAbortController.abort()
      renderSpectrogramAbortController = null
    }

    gnauralSpectrogramLoading.value = false
  }

  function clearRenderedSpectrogram(): void {
    cancelPendingRenderedSpectrogramLoad()
    gnauralSpectrogramBuffer.value = null
    gnauralSpectrogramSourcePath.value = null
  }

  function cancelPendingGnauralScheduleLoad(): void {
    gnauralScheduleRequestId += 1

    if (gnauralScheduleAbortController !== null) {
      gnauralScheduleAbortController.abort()
      gnauralScheduleAbortController = null
    }

    gnauralScheduleLoadingPath.value = null
  }

  function setGnauralSchedule(filePath: string, schedule: GnauralScheduleData): void {
    gnauralScheduleCache.value = {
      ...gnauralScheduleCache.value,
      [filePath]: schedule,
    }

    if (gnauralScheduleLoadingPath.value === filePath) {
      gnauralScheduleLoadingPath.value = null
    }

    if (gnauralScheduleErrorPath.value === filePath) {
      gnauralScheduleErrorPath.value = null
      gnauralScheduleErrorMessage.value = null
    }
  }

  async function loadGnauralSchedule(filePath: string, force = false): Promise<void> {
    const cachedSchedule = gnauralScheduleCache.value[filePath]
    if (!force && cachedSchedule !== undefined) {
      if (displayMode.value === 'gnaural' && displayFilePath.value === filePath && remoteDurationSec.value <= 0) {
        remoteDurationSec.value = cachedSchedule.totalTimeSec
      }

      if (gnauralScheduleErrorPath.value === filePath) {
        gnauralScheduleErrorPath.value = null
        gnauralScheduleErrorMessage.value = null
      }
      return
    }

    cancelPendingGnauralScheduleLoad()

    const requestId = gnauralScheduleRequestId + 1
    const abortController = new AbortController()
    gnauralScheduleRequestId = requestId
    gnauralScheduleAbortController = abortController
    gnauralScheduleLoadingPath.value = filePath
    gnauralScheduleErrorPath.value = null
    gnauralScheduleErrorMessage.value = null

    try {
      const schedule = await audioApi.fetchSchedule(filePath, abortController.signal)

      if (abortController.signal.aborted || requestId !== gnauralScheduleRequestId) {
        return
      }

      setGnauralSchedule(filePath, schedule)

      if (
        (displayMode.value === 'gnaural' && displayFilePath.value === filePath) ||
        remoteFilePath.value === filePath ||
        activeFilePath.value === filePath
      ) {
        remoteDurationSec.value = schedule.totalTimeSec
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      gnauralScheduleErrorPath.value = filePath
      gnauralScheduleErrorMessage.value = error instanceof Error
        ? error.message
        : 'Failed to load the selected Gnaural schedule.'
    } finally {
      if (gnauralScheduleAbortController === abortController) {
        gnauralScheduleAbortController = null
      }

      if (requestId === gnauralScheduleRequestId && gnauralScheduleLoadingPath.value === filePath) {
        gnauralScheduleLoadingPath.value = null
      }
    }
  }

  function cancelPendingLocalStart(): void {
    pendingLocalStartPath.value = null
  }

  function clearLocalError(): void {
    if (lastError.value !== null) {
      lastError.value = null
    }
  }

  async function maybeStartQueuedLocalPlayback(): Promise<void> {
    const queuedFilePath = pendingLocalStartPath.value
    const queuedFileKind = selectedFileKind.value
    if (
      queuedFilePath === null ||
      remoteTransportState.value !== 'idle' ||
      selectedPath.value !== queuedFilePath ||
      !isLocalAudioFileKind(queuedFileKind)
    ) {
      return
    }

    pendingLocalStartPath.value = null
    await startLocalPlayback(queuedFilePath, queuedFileKind)
  }

  function syncAudioElementDuration(): void {
    if (audioElement === null) {
      return
    }

    if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
      localDurationSec.value = audioElement.duration
    }
  }

  const handleAudioElementLoadedMetadata = (): void => {
    syncAudioElementDuration()
  }

  const handleAudioElementTimeUpdate = (): void => {
    if (audioElement === null) {
      return
    }

    localPositionSec.value = audioElement.currentTime
  }

  const handleAudioElementPlay = (): void => {
    localTransportState.value = 'playing'
    clearLocalError()
  }

  const handleAudioElementPause = (): void => {
    if (audioElement === null || audioElement.ended) {
      return
    }

    if (localTransportState.value === 'playing') {
      localTransportState.value = 'paused'
    }
  }

  const handleAudioElementEnded = (): void => {
    localTransportState.value = 'idle'
    localPositionSec.value = 0
  }

  const handleAudioElementError = (): void => {
    localTransportState.value = 'idle'
    lastError.value = 'Failed to play the selected audio file'
  }

  if (audioElement !== null) {
    audioElement.addEventListener('loadedmetadata', handleAudioElementLoadedMetadata)
    audioElement.addEventListener('timeupdate', handleAudioElementTimeUpdate)
    audioElement.addEventListener('play', handleAudioElementPlay)
    audioElement.addEventListener('pause', handleAudioElementPause)
    audioElement.addEventListener('ended', handleAudioElementEnded)
    audioElement.addEventListener('error', handleAudioElementError)
  }

  function hasDecodeContextSupport(): boolean {
    return getAudioContextCtor() !== null
  }

  function browserSupportsFlacPlayback(): boolean {
    if (audioElement === null) {
      return false
    }

    return audioElement.canPlayType('audio/flac') !== '' || audioElement.canPlayType('audio/x-flac') !== ''
  }

  function shouldRequestWavFallback(fileKind: LocalAudioFileKind, forceFallback = false): boolean {
    return fileKind === 'flac' && (forceFallback || !browserSupportsFlacPlayback())
  }

  // GT7.5/GT7.4 (owner 2026-07-13): the spectrogram + waveform are rendered from the BACKEND analysis
  // now, so a client-side decode failure (e.g. a browser that can't decode FLAC via Web Audio) must
  // NOT surface a "spectrogram" error — it only means the optional client-decoded buffer is absent.
  // Fail silently; the display comes from the backend regardless. (The decoded buffer only still
  // feeds the wave overlay + duration until GT7.3/GT7.4 finish the thin-client cleanup.)
  async function decodeAudioBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> {
    const context = getDecodeContext()
    if (context === null) {
      return null
    }

    try {
      return await context.decodeAudioData(arrayBuffer.slice(0))
    } catch {
      return null
    }
  }

  async function fetchLocalAudioBlob(
    filePath: string,
    fileKind: LocalAudioFileKind,
    abortSignal: AbortSignal,
  ): Promise<{ blob: Blob; decodedBuffer: AudioBuffer | null }> {
    const needsInitialFallback = shouldRequestWavFallback(fileKind)
    const initialOptions = needsInitialFallback ? { format: 'wav' as const } : undefined
    const initialBlob = await audioApi.fetchAudioFileBlob(filePath, abortSignal, initialOptions)
    const initialArrayBuffer = await initialBlob.arrayBuffer()
    const canRetryWithWavFallback = fileKind === 'flac' && !needsInitialFallback && hasDecodeContextSupport()
    let decodedBuffer = await decodeAudioBuffer(initialArrayBuffer)

    if (!canRetryWithWavFallback || decodedBuffer !== null) {
      return {
        blob: initialBlob,
        decodedBuffer,
      }
    }

    const fallbackBlob = await audioApi.fetchAudioFileBlob(filePath, abortSignal, { format: 'wav' })
    const fallbackArrayBuffer = await fallbackBlob.arrayBuffer()
    decodedBuffer = await decodeAudioBuffer(fallbackArrayBuffer)

    return {
      blob: fallbackBlob,
      decodedBuffer,
    }
  }

  async function loadRenderedSpectrogram(sourceFilePath: string, tempWavPath: string): Promise<void> {
    cancelPendingRenderedSpectrogramLoad()

    const requestId = renderSpectrogramLoadRequestId + 1
    const abortController = new AbortController()
    renderSpectrogramLoadRequestId = requestId
    renderSpectrogramAbortController = abortController
    gnauralSpectrogramLoading.value = true
    spectrogramError.value = null

    try {
      const blob = await audioApi.fetchAudioFileBlob(tempWavPath, abortController.signal)
      const arrayBuffer = await blob.arrayBuffer()
      const decodedBuffer = await decodeAudioBuffer(arrayBuffer)

      if (
        abortController.signal.aborted ||
        requestId !== renderSpectrogramLoadRequestId ||
        decodedBuffer === null ||
        (selectedPath.value !== sourceFilePath && activeFilePath.value !== sourceFilePath && remoteFilePath.value !== sourceFilePath)
      ) {
        return
      }

      gnauralSpectrogramBuffer.value = decodedBuffer
      gnauralSpectrogramSourcePath.value = sourceFilePath
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      spectrogramError.value = error instanceof Error
        ? error.message
        : 'Failed to load the rendered Gnaural spectrogram WAV file.'
    } finally {
      if (renderSpectrogramAbortController === abortController) {
        renderSpectrogramAbortController = null
      }

      if (requestId === renderSpectrogramLoadRequestId) {
        gnauralSpectrogramLoading.value = false
      }
    }
  }

  // GT2.6: render a .gnaural to WAV for its spectrum WITHOUT playback. The server renders on
  // demand (GET /api/audio/file?format=wav → renderGnauralAudioFile, cached by content hash), so
  // the Треки tab can show the waveform + spectrum automatically instead of asking the user to
  // press play. Reuses the rendered-spectrogram decode + request/abort bookkeeping.
  async function ensureGnauralSpectrogram(filePath: string, force = false): Promise<void> {
    // GT3.4: after a Save the file changed on disk but the path is unchanged — force clears the
    // cached render so the waveform + spectrum re-fetch the freshly-rendered WAV.
    if (force) {
      clearRenderedSpectrogram()
    }
    if (!force && gnauralSpectrogramSourcePath.value === filePath && gnauralSpectrogramBuffer.value !== null) {
      return
    }
    if (gnauralSpectrogramLoading.value) {
      return
    }

    cancelPendingRenderedSpectrogramLoad()
    const requestId = renderSpectrogramLoadRequestId + 1
    const abortController = new AbortController()
    renderSpectrogramLoadRequestId = requestId
    renderSpectrogramAbortController = abortController
    gnauralSpectrogramLoading.value = true
    spectrogramError.value = null

    try {
      // GT2.6 fix: cap the gnaural render to a single loop so files like "1 s x 4900 loops" don't
      // produce a huge WAV the browser cannot decode.
      const blob = await audioApi.fetchAudioFileBlob(filePath, abortController.signal, { format: 'wav', singleLoop: true })
      const arrayBuffer = await blob.arrayBuffer()
      const decodedBuffer = await decodeAudioBuffer(arrayBuffer)

      if (
        abortController.signal.aborted ||
        requestId !== renderSpectrogramLoadRequestId ||
        decodedBuffer === null ||
        displayFilePath.value !== filePath
      ) {
        return
      }

      gnauralSpectrogramBuffer.value = decodedBuffer
      gnauralSpectrogramSourcePath.value = filePath
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      spectrogramError.value = error instanceof Error
        ? error.message
        : 'Failed to render the selected Gnaural file for spectrogram display.'
    } finally {
      if (renderSpectrogramAbortController === abortController) {
        renderSpectrogramAbortController = null
      }

      if (requestId === renderSpectrogramLoadRequestId) {
        gnauralSpectrogramLoading.value = false
      }
    }
  }

  async function ensureLocalAudioReady(filePath: string, fileKind: LocalAudioFileKind): Promise<boolean> {
    if (audioElement === null) {
      lastError.value = 'HTML audio playback is not available in this browser.'
      return false
    }

    if (wavSourcePath.value === filePath && wavObjectUrl.value !== null && localFileKind.value === fileKind) {
      return true
    }

    cancelPendingWavLoad()

    const requestId = wavLoadRequestId + 1
    const abortController = new AbortController()
    wavLoadRequestId = requestId
    wavLoadAbortController = abortController
    lastError.value = null
    spectrogramError.value = null
    wavLoading.value = true
    localTransportState.value = 'loading'

    try {
      const { blob, decodedBuffer } = await fetchLocalAudioBlob(filePath, fileKind, abortController.signal)

      if (
        abortController.signal.aborted ||
        requestId !== wavLoadRequestId ||
        selectedPath.value !== filePath
      ) {
        return false
      }

      const objectUrl = URL.createObjectURL(blob)

      if (!audioElement.paused) {
        audioElement.pause()
      }

      releaseWavObjectUrl()
      wavObjectUrl.value = objectUrl
      wavSourcePath.value = filePath
      wavAudioBuffer.value = decodedBuffer
      localFileKind.value = fileKind
      localPositionSec.value = 0
      localDurationSec.value = decodedBuffer?.duration ?? 0
      activeFilePath.value = filePath
      activeFileKind.value = fileKind
      audioElement.src = objectUrl
      audioElement.load()
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return false
      }

      lastError.value = error instanceof Error ? error.message : 'Failed to load the selected audio file'
      return false
    } finally {
      if (wavLoadAbortController === abortController) {
        wavLoadAbortController = null
      }

      if (requestId === wavLoadRequestId) {
        wavLoading.value = false
        if (localTransportState.value === 'loading') {
          localTransportState.value = 'idle'
        }
      }
    }
  }

  async function startLocalPlayback(filePath: string, fileKind: LocalAudioFileKind): Promise<boolean> {
    const ready = await ensureLocalAudioReady(filePath, fileKind)
    if (!ready || audioElement === null) {
      return false
    }

    try {
      await audioElement.play()
      localTransportState.value = 'playing'
      clearLocalError()
      return true
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to start local audio playback'
      localTransportState.value = 'idle'
      return false
    }
  }

  function pauseLocalPlayback(): void {
    if (audioElement === null) {
      return
    }

    audioElement.pause()
    if (localTransportState.value !== 'idle') {
      localTransportState.value = 'paused'
    }
  }

  async function resumeLocalPlayback(): Promise<boolean> {
    const fileKind = selectedFileKind.value
    if (selectedPath.value === null || !isLocalAudioFileKind(fileKind)) {
      return false
    }

    if (wavSourcePath.value !== selectedPath.value || localFileKind.value !== fileKind) {
      return startLocalPlayback(selectedPath.value, fileKind)
    }

    if (audioElement === null) {
      lastError.value = 'HTML audio playback is not available in this browser.'
      return false
    }

    try {
      await audioElement.play()
      localTransportState.value = 'playing'
      clearLocalError()
      return true
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to resume local audio playback'
      return false
    }
  }

  function stopLocalPlayback(): void {
    cancelPendingWavLoad()
    cancelPendingLocalStart()

    if (audioElement === null) {
      localTransportState.value = 'idle'
      localPositionSec.value = 0
      return
    }

    audioElement.pause()
    audioElement.currentTime = 0
    localPositionSec.value = 0
    localTransportState.value = 'idle'
  }

  function seekLocalPlayback(position: number): void {
    if (audioElement === null) {
      return
    }

    const nextPosition = Math.max(0, Math.min(position, localDurationSec.value || position))
    audioElement.currentTime = nextPosition
    localPositionSec.value = nextPosition
  }

  async function loadSettings(): Promise<void> {
    settingsLoading.value = true
    try {
      settings.value = await audioApi.fetchAudioSettings()
      lastError.value = null
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to load audio settings'
    } finally {
      settingsLoading.value = false
    }
  }

  function queueLocalStartAfterRemoteStop(filePath: string): void {
    pendingLocalStartPath.value = filePath
  }

  async function saveSettings(presetsRoot: string): Promise<boolean> {
    settingsLoading.value = true
    try {
      settings.value = await audioApi.updateAudioSettings(presetsRoot)
      lastError.value = null
      return true
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to save audio settings'
      return false
    } finally {
      settingsLoading.value = false
    }
  }

  async function refreshPresets(): Promise<void> {
    presetsLoading.value = true
    try {
      const response = await audioApi.fetchPresets()
      settings.value = { presetsRoot: response.presetsRoot }
      presetsTree.value = response.items
      // SF20: do NOT re-select/auto-load a previously stored path on refresh — the user
      // picks from the toolbar recent-files dropdown or the tree instead.
      lastError.value = null
    } catch (error) {
      presetsTree.value = []
      lastError.value = error instanceof Error ? error.message : 'Failed to load presets'
    } finally {
      presetsLoading.value = false
    }
  }

  function selectPath(path: string | null): void {
    const nextNode = path === null ? null : findNodeByPath(presetsTree.value, path)
    const nextSelectedPath = nextNode?.isDir === false ? nextNode.path : null

    if (pendingLocalStartPath.value !== null && pendingLocalStartPath.value !== nextSelectedPath) {
      cancelPendingLocalStart()
    }

    selectedNode.value = nextNode
    selectedPath.value = nextSelectedPath

    // SF20: remember picked files for the toolbar quick-pick.
    if (nextSelectedPath !== null) recordRecentFile(nextSelectedPath)

    if (
      !isLocalAudioFileKind(selectedNode.value?.fileKind) ||
      nextSelectedPath !== wavSourcePath.value ||
      selectedNode.value.fileKind !== localFileKind.value
    ) {
      stopLocalPlayback()
    }

    if (nextNode?.fileKind === 'gnaural' && nextSelectedPath !== null) {
      void loadGnauralSchedule(nextSelectedPath)
    }

    clearLocalError()
  }

  // FB3.2 (file-browser FB-D7): select a file chosen from the universal open dialog. That file lives
  // OUTSIDE presetsTree, so selectPath (which resolves nodes from the tree) would yield null; here we
  // build the node from the known path + fileKind returned by the dialog instead.
  function selectExternalPath(path: string, fileKind: AudioFileKind): void {
    const name = path.split(/[\\/]/u).pop() ?? path
    const node: PresetTreeNode = { name, path, isDir: false, fileKind }

    if (pendingLocalStartPath.value !== null && pendingLocalStartPath.value !== path) {
      cancelPendingLocalStart()
    }

    selectedNode.value = node
    selectedPath.value = path
    recordRecentFile(path)

    if (
      !isLocalAudioFileKind(node.fileKind) ||
      path !== wavSourcePath.value ||
      node.fileKind !== localFileKind.value
    ) {
      stopLocalPlayback()
    }

    if (fileKind === 'gnaural') {
      void loadGnauralSchedule(path)
    }

    clearLocalError()
  }

  function setClientError(message: string | null): void {
    lastError.value = message
  }

  function handleStatus(event: AudioStatusEvent): void {
    remoteTransportState.value = event.transportState
    renderState.value = event.renderState
    activeFilePath.value = event.filePath ?? null
    activeFileKind.value = event.fileKind ?? null
    remoteFilePath.value = event.filePath ?? remoteFilePath.value
    remoteFileKind.value = event.fileKind ?? remoteFileKind.value
    remotePositionSec.value = event.positionSec ?? 0
    remoteDurationSec.value = event.durationSec ?? (event.transportState === 'loading' ? 0 : remoteDurationSec.value)

    if (event.fileKind === 'gnaural' && event.filePath !== undefined) {
      const cachedSchedule = gnauralScheduleCache.value[event.filePath]
      if (cachedSchedule === undefined) {
        void loadGnauralSchedule(event.filePath)
      } else if (event.durationSec === undefined && remoteDurationSec.value <= 0) {
        remoteDurationSec.value = cachedSchedule.totalTimeSec
      }
    }

    if (event.transportState === 'loading' && event.fileKind === 'gnaural') {
      clearRenderedSpectrogram()
    }

    if (event.transportState === 'loading' || event.transportState === 'playing' || event.transportState === 'paused') {
      clearLocalError()
    }

    if (event.renderState === 'rendering') {
      spectrogramError.value = null
    }

    if (event.renderState === 'failed' && event.fileKind === 'gnaural') {
      spectrogramError.value = 'Failed to render the selected Gnaural file for spectrogram display.'
    }

    if (event.transportState === 'idle') {
      void maybeStartQueuedLocalPlayback()
    }
  }

  function handleProgress(event: AudioProgressEvent): void {
    remotePositionSec.value = event.positionSec
    clearLocalError()
  }

  function handleError(event: AudioErrorEvent): void {
    lastError.value = event.message
  }

  function handleRenderProgress(event: AudioRenderProgressEvent): void {
    if (
      selectedPath.value !== event.filePath &&
      activeFilePath.value !== event.filePath &&
      remoteFilePath.value !== event.filePath
    ) {
      return
    }

    clearRenderedSpectrogram()
    gnauralSpectrogramLoading.value = true
    spectrogramError.value = null
  }

  function handleRenderDone(event: AudioRenderDoneEvent): void {
    if (
      selectedPath.value !== event.filePath &&
      activeFilePath.value !== event.filePath &&
      remoteFilePath.value !== event.filePath
    ) {
      return
    }

    void loadRenderedSpectrogram(event.filePath, event.tempWavPath)
  }

  function handleScheduleLoaded(event: AudioScheduleLoadedEvent): void {
    setGnauralSchedule(event.filePath, event.schedule)

    if (
      selectedPath.value === event.filePath ||
      activeFilePath.value === event.filePath ||
      remoteFilePath.value === event.filePath
    ) {
      remoteDurationSec.value = event.schedule.totalTimeSec
    }
  }

  function handleScheduleChanged(event: AudioScheduleChangedEvent): void {
    void loadGnauralSchedule(event.filePath, true)
  }

  function handleExit(event: AudioExitEvent): void {
    lastExitCode.value = event.exitCode
    if (event.role === 'playback') {
      remoteTransportState.value = 'idle'
      remotePositionSec.value = 0
      void maybeStartQueuedLocalPlayback()
    }
  }

  onScopeDispose(() => {
    cancelPendingGnauralScheduleLoad()
    cancelPendingRenderedSpectrogramLoad()
    cancelPendingWavLoad()
    cancelPendingLocalStart()
    releaseWavObjectUrl()

    if (audioElement !== null) {
      audioElement.pause()
      audioElement.removeEventListener('loadedmetadata', handleAudioElementLoadedMetadata)
      audioElement.removeEventListener('timeupdate', handleAudioElementTimeUpdate)
      audioElement.removeEventListener('play', handleAudioElementPlay)
      audioElement.removeEventListener('pause', handleAudioElementPause)
      audioElement.removeEventListener('ended', handleAudioElementEnded)
      audioElement.removeEventListener('error', handleAudioElementError)
      audioElement.removeAttribute('src')
      audioElement.load()
    }
  })

  return {
    settings,
    presetsTree,
    selectedPath,
    recentFiles,
    selectedNode,
    selectedFileKind,
    activePlaybackMode,
    displayMode,
    displayFilePath,
    displayFileKind,
    gnauralSchedule,
    gnauralScheduleLoading,
    gnauralScheduleError,
    transportState,
    remoteTransportState,
    localTransportState,
    renderState,
    activeFilePath,
    activeFileKind,
    positionSec,
    durationSec,
    settingsLoading,
    presetsLoading,
    wavLoading,
    spectrogramLoading,
    spectrogramBuffer,
    spectrogramError,
    lastError,
    lastExitCode,
    canStart,
    canPause,
    canResume,
    canStop,
    canSeek,
    loadSettings,
    saveSettings,
    refreshPresets,
    loadGnauralSchedule,
    selectPath,
    selectExternalPath,
    setClientError,
    queueLocalStartAfterRemoteStop,
    cancelPendingLocalStart,
    ensureLocalAudioReady,
    ensureGnauralSpectrogram,
    startLocalPlayback,
    pauseLocalPlayback,
    resumeLocalPlayback,
    stopLocalPlayback,
    seekLocalPlayback,
    handleStatus,
    handleProgress,
    handleError,
    handleRenderProgress,
    handleRenderDone,
    handleScheduleLoaded,
    handleScheduleChanged,
    handleExit,
  }
})