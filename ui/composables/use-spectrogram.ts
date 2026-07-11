import { onScopeDispose, ref, shallowRef, type Ref } from 'vue'
import type {
  SpectrogramAnalysisInfo,
  SpectrogramAnalysisParams,
  SpectrogramAreaResult,
  SpectrogramPointResult,
  SpectrogramServerMessage,
  SpectrogramTile,
} from '@protocol'

import type { AudioPeak } from './audio-model'
import { useWsService } from './use-ws'
import {
  DEFAULT_TILE_CACHE_SIZE,
  DEFAULT_TILE_FRAMES,
  planVisibleTiles,
  SpectrogramTileCache,
} from './spectrogram-tiles'

// useSpectrogram (Spectrogram UI plan, U2.1): open an analysis over WS, fetch the
// tiles for the visible (time-range, zoom) with a client-side LRU cache, debounced
// refetch on view change, and cancellation (stale responses are ignored). The
// pure tiling/cache/eviction logic lives in ./spectrogram-tiles (unit-tested).

let gRequestSeq = 0
function nextRequestId(): string {
  gRequestSeq += 1
  return `spec-${Date.now().toString(36)}-${gRequestSeq}`
}

// SF24 (interleaved tile loading): the spectrogram worker is a single serial process, so if one
// track (e.g. stereo L) sends ALL its get-tile requests before the other (R), R visibly lags.
// This shared round-robin scheduler interleaves sends across every useSpectrogram instance with a
// bounded in-flight count, so stacked tracks fill in TOGETHER. Frontend-only (no backend change).
const TILE_INFLIGHT_CAP = 3
interface QueuedTile {
  readonly requestId: string
  readonly dispatch: () => void
}
const gTileQueues = new Map<number, QueuedTile[]>()
let gTileRing: number[] = []
const gTileInflight = new Set<string>()
let gInstanceSeq = 0

function tilePump(): void {
  let guard = 8192
  while (gTileInflight.size < TILE_INFLIGHT_CAP && gTileRing.length > 0 && guard-- > 0) {
    const id = gTileRing.shift() as number
    const q = gTileQueues.get(id)
    if (q === undefined || q.length === 0) {
      gTileQueues.delete(id)
      continue
    }
    const item = q.shift() as QueuedTile
    gTileInflight.add(item.requestId)
    item.dispatch()
    if (q.length > 0) gTileRing.push(id) // requeue at the back — round-robin across instances
    else gTileQueues.delete(id)
  }
}

/** Replace an instance's pending tile sends and pump the interleaved scheduler. */
function tileScheduleInstance(aInstanceId: number, aItems: QueuedTile[]): void {
  if (aItems.length === 0) {
    gTileQueues.delete(aInstanceId)
    gTileRing = gTileRing.filter((i) => i !== aInstanceId)
    return
  }
  gTileQueues.set(aInstanceId, aItems)
  if (!gTileRing.includes(aInstanceId)) gTileRing.push(aInstanceId)
  tilePump()
}

/** A tile response arrived (or errored) — free the slot and dispatch the next queued tile. */
function tileComplete(aRequestId: string): void {
  if (gTileInflight.delete(aRequestId)) tilePump()
}

function tileClearInstance(aInstanceId: number): void {
  gTileQueues.delete(aInstanceId)
  gTileRing = gTileRing.filter((i) => i !== aInstanceId)
}

export interface UseSpectrogramOptions {
  readonly tileFrames?: number
  readonly cacheSize?: number
  readonly refetchDebounceMs?: number
}

export interface SpectrogramView {
  readonly timeStartSec: number
  readonly timeEndSec: number
  readonly zoom: number
  readonly viewBinCount: number
  /** SF17.4: per-tile FFT window override for high-zoom sharpening (0/undefined = none). */
  readonly windowOverride?: number
}

export interface UseSpectrogram {
  readonly analysis: Ref<SpectrogramAnalysisInfo | null>
  readonly tiles: Ref<readonly SpectrogramTile[]>
  readonly loading: Ref<boolean>
  /** SF19.3: initial prepare (nothing rendered yet) — drives the full overlay. */
  readonly preparing: Ref<boolean>
  /** SF19.3: background refetch while a frame is already shown — drives a tiny spinner. */
  readonly fetchingTiles: Ref<boolean>
  readonly error: Ref<string | null>
  /** SF24.1: backend waveform peaks (min/max/rms) over a time range at `buckets` resolution. */
  getPeaks(aTimeStartSec: number, aTimeEndSec: number, aBuckets: number): Promise<AudioPeak[]>
  open(aParams: SpectrogramAnalysisParams & { readonly filePath?: string; readonly soloVoiceIds?: readonly number[] }): Promise<SpectrogramAnalysisInfo>
  reconfigure(aParams: SpectrogramAnalysisParams): Promise<SpectrogramAnalysisInfo>
  setView(aView: SpectrogramView): void
  pointQuery(aTimeSec: number, aFrequencyHz: number): Promise<SpectrogramPointResult | null>
  areaQuery(
    aTimeStartSec: number,
    aTimeEndSec: number,
    aFreqStartHz: number,
    aFreqEndHz: number,
  ): Promise<SpectrogramAreaResult | null>
  close(): Promise<void>
  dispose(): void
}

interface PendingTile {
  readonly key: string
  readonly seq: number
}

export function useSpectrogram(aOptions: UseSpectrogramOptions = {}): UseSpectrogram {
  const ws = useWsService()
  const instanceId = ++gInstanceSeq // SF24: identity in the shared interleaving scheduler

  const analysis = shallowRef<SpectrogramAnalysisInfo | null>(null)
  const tiles = shallowRef<readonly SpectrogramTile[]>([])
  const loading = ref(false)
  // SF19.3: split the loading signal so the UI can distinguish the initial prepare (full
  // overlay) from a view-change refetch (background swap + tiny corner spinner).
  //   preparing     = opening/reconfiguring with NOTHING rendered yet (first load);
  //   fetchingTiles = tiles pending while a frame is already on screen (zoom/pan).
  const preparing = ref(false)
  const fetchingTiles = ref(false)
  const error = ref<string | null>(null)

  const cache = new SpectrogramTileCache<SpectrogramTile>(aOptions.cacheSize ?? DEFAULT_TILE_CACHE_SIZE)
  const tileFrames = aOptions.tileFrames ?? DEFAULT_TILE_FRAMES
  const debounceMs = aOptions.refetchDebounceMs ?? 80

  let analysisId: string | null = null
  let currentView: SpectrogramView | null = null
  let viewSeq = 0
  // True while the worker is opening/reconfiguring the analysis (the slow prepare
  // step) until the following refetch starts fetching tiles. Keeps the loading
  // indicator up for the whole prepare span, not just while tiles are pending.
  let opening = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const pendingTiles = new Map<string, PendingTile>()
  const controlWaiters = new Map<string, (aMessage: SpectrogramServerMessage) => void>()

  function updateLoading(): void {
    let active = 0
    for (const p of pendingTiles.values()) {
      if (p.seq === viewSeq) active += 1
    }
    const busy = opening || active > 0
    const hasFrame = tiles.value.length > 0
    // Nothing on screen yet + busy => initial prepare (full overlay); otherwise a
    // background refetch of a view already showing a frame (fallback) => tiny spinner.
    preparing.value = busy && !hasFrame
    fetchingTiles.value = busy && hasFrame
    loading.value = busy
  }

  function assembleVisibleTiles(): void {
    if (analysisId === null || currentView === null || analysis.value === null) {
      tiles.value = []
      return
    }
    const reqs = planVisibleTiles({
      analysisId,
      frameCount: analysis.value.frameCount,
      durationSec: analysis.value.durationSec,
      timeStartSec: currentView.timeStartSec,
      timeEndSec: currentView.timeEndSec,
      zoom: currentView.zoom,
      viewBinCount: currentView.viewBinCount,
      windowOverride: currentView.windowOverride ?? 0,
      tileFrames,
    })
    const analysisIdLocal = analysisId
    const present = new Set<SpectrogramTile>()
    for (const r of reqs) {
      // Exact match first; otherwise reuse any cached tile for the same
      // (zoom, tileIndex) at a different viewBinCount so already-fetched tiles keep
      // rendering across a binCount change instead of only the newest one showing.
      let tile = cache.get(r.key) ?? cache.getByTileIndex(analysisIdLocal, r.zoom, r.tileIndex)
      if (tile === undefined) {
        // B1/SF11.9 responsiveness: no exact-zoom tile yet -> fall back to a cached tile
        // from ANOTHER zoom that fully covers this range (e.g. the whole-clip overview),
        // rendered stretched, so zoom/pan shows instant coarse content instead of blank.
        // Prefer the FINEST covering tile (smallest span).
        tile = cache.findBest((t) =>
          t.analysisId === analysisIdLocal &&
          t.frameStart <= r.frameStart &&
          t.frameStart + t.frameCount >= r.frameStart + r.frameCount
            ? -t.frameCount
            : null,
        )
      }
      if (tile !== undefined) present.add(tile)
    }
    // Coarse (larger span) under exact (smaller span): draw order = span DESC so the
    // sharp exact tiles paint over any coarse fallback.
    tiles.value = [...present].sort((a, b) => b.frameCount - a.frameCount)
  }

  function handleServerMessage(aMessage: SpectrogramServerMessage): void {
    const waiter = controlWaiters.get(aMessage.requestId)
    if (waiter !== undefined) {
      controlWaiters.delete(aMessage.requestId)
      waiter(aMessage)
      return
    }
    if (aMessage.type === 'spectrogram:tile') {
      tileComplete(aMessage.requestId) // SF24: free the scheduler slot, dispatch the next queued
      const pending = pendingTiles.get(aMessage.requestId)
      if (pending === undefined) return
      pendingTiles.delete(aMessage.requestId)
      cache.set(pending.key, aMessage.tile)
      // Always re-assemble: a tile fetched under an earlier view/seq (e.g. before a
      // canvas resize bumped viewBinCount) still belongs in the current plan via the
      // binCount fallback, so it must persist rather than only the newest tile showing.
      assembleVisibleTiles()
      updateLoading()
      return
    }
    if (aMessage.type === 'spectrogram:error') {
      tileComplete(aMessage.requestId) // SF24: free the slot if this was an in-flight tile
      // Only surface an error this instance owns. Control-request errors are delivered to the
      // owning instance's waiter above (and handled by the caller); a broadcast error for
      // another instance's request (the WS is shared across composables) must NOT clobber this
      // instance's error state — that used to show the waveform's error over the spectrogram.
      if (pendingTiles.has(aMessage.requestId)) {
        pendingTiles.delete(aMessage.requestId)
        error.value = aMessage.error
        updateLoading()
      }
    }
  }

  const unsubscribe = ws.onSpectrogram(handleServerMessage)

  function sendControl(
    aMessage: Parameters<typeof ws.sendSpectrogram>[0],
    aRequestId: string,
  ): Promise<SpectrogramServerMessage> {
    return new Promise<SpectrogramServerMessage>((resolvePromise, rejectPromise) => {
      controlWaiters.set(aRequestId, resolvePromise)
      if (!ws.sendSpectrogram(aMessage)) {
        controlWaiters.delete(aRequestId)
        rejectPromise(new Error('spectrogram: not connected'))
      }
    })
  }

  async function open(
    aParams: SpectrogramAnalysisParams & { readonly filePath?: string; readonly soloVoiceIds?: readonly number[] },
  ): Promise<SpectrogramAnalysisInfo> {
    error.value = null
    opening = true
    updateLoading()
    const requestId = nextRequestId()
    let resp: SpectrogramServerMessage
    try {
      resp = await sendControl({ type: 'spectrogram:open', requestId, ...aParams }, requestId)
    } catch (aError) {
      opening = false
      updateLoading()
      throw aError
    }
    if (resp.type === 'spectrogram:opened') {
      analysis.value = resp.analysis
      analysisId = resp.analysis.analysisId
      cache.clear()
      pendingTiles.clear()
      tiles.value = []
      if (currentView !== null) scheduleRefetch()
      return resp.analysis
    }
    opening = false
    updateLoading()
    const message = resp.type === 'spectrogram:error' ? resp.error : 'spectrogram: open failed'
    error.value = message
    throw new Error(message)
  }

  async function reconfigure(aParams: SpectrogramAnalysisParams): Promise<SpectrogramAnalysisInfo> {
    if (analysisId === null) throw new Error('spectrogram: no open analysis to reconfigure')
    error.value = null
    opening = true
    updateLoading()
    const requestId = nextRequestId()
    let resp: SpectrogramServerMessage
    try {
      resp = await sendControl(
        { type: 'spectrogram:reconfigure', requestId, analysisId, ...aParams },
        requestId,
      )
    } catch (aError) {
      opening = false
      updateLoading()
      throw aError
    }
    if (resp.type === 'spectrogram:reconfigured') {
      analysis.value = resp.analysis
      analysisId = resp.analysis.analysisId
      // re-analysis invalidates every cached tile
      cache.clear()
      pendingTiles.clear()
      tiles.value = []
      if (currentView !== null) scheduleRefetch()
      return resp.analysis
    }
    opening = false
    updateLoading()
    const message = resp.type === 'spectrogram:error' ? resp.error : 'spectrogram: reconfigure failed'
    error.value = message
    throw new Error(message)
  }

  function refetch(): void {
    // The prepare (open/reconfigure) step is over once we start fetching tiles;
    // from here loading reflects pending tiles.
    opening = false
    if (analysisId === null || currentView === null || analysis.value === null) {
      updateLoading()
      return
    }
    const seq = viewSeq
    const view = currentView
    const reqs = planVisibleTiles({
      analysisId,
      frameCount: analysis.value.frameCount,
      durationSec: analysis.value.durationSec,
      timeStartSec: view.timeStartSec,
      timeEndSec: view.timeEndSec,
      zoom: view.zoom,
      viewBinCount: view.viewBinCount,
      windowOverride: view.windowOverride ?? 0,
      tileFrames,
    })
    const secPerFrame = analysis.value.durationSec / analysis.value.frameCount
    const windowOverride = view.windowOverride ?? 0
    const analysisIdLocal = analysisId
    // SF24: hand the sends to the shared round-robin scheduler (interleaves L/R). pendingTiles
    // (loading state) is set at DISPATCH time so a queue replaced by a newer view leaks nothing.
    const items: QueuedTile[] = []
    for (const r of reqs) {
      if (cache.has(r.key)) continue
      const requestId = nextRequestId()
      items.push({
        requestId,
        dispatch: () => {
          pendingTiles.set(requestId, { key: r.key, seq })
          ws.sendSpectrogram({
            type: 'spectrogram:get-tile',
            requestId,
            analysisId: analysisIdLocal,
            timeStartSec: r.frameStart * secPerFrame,
            timeEndSec: (r.frameStart + r.frameCount) * secPerFrame,
            zoom: r.zoom,
            viewBinCount: r.viewBinCount,
            ...(windowOverride > 0 ? { windowOverride } : {}),
          })
          updateLoading()
        },
      })
    }
    tileScheduleInstance(instanceId, items)
    assembleVisibleTiles()
    updateLoading()
  }

  function scheduleRefetch(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      refetch()
    }, debounceMs)
  }

  function sameView(aA: SpectrogramView, aB: SpectrogramView): boolean {
    return (
      Math.abs(aA.timeStartSec - aB.timeStartSec) < 1e-6 &&
      Math.abs(aA.timeEndSec - aB.timeEndSec) < 1e-6 &&
      aA.zoom === aB.zoom &&
      aA.viewBinCount === aB.viewBinCount &&
      (aA.windowOverride ?? 0) === (aB.windowOverride ?? 0)
    )
  }

  function setView(aView: SpectrogramView): void {
    // No-op on an unchanged view: redundant applyView() calls (e.g. the direct call
    // plus the view watcher, or idempotent ResizeObserver ticks) would otherwise bump
    // viewSeq and re-refetch, churning tiles during the initial load.
    if (currentView !== null && sameView(currentView, aView)) {
      return
    }
    currentView = aView
    viewSeq += 1
    // show whatever is already cached for the new view immediately, then fetch gaps
    assembleVisibleTiles()
    updateLoading()
    scheduleRefetch()
  }

  async function pointQuery(
    aTimeSec: number,
    aFrequencyHz: number,
  ): Promise<SpectrogramPointResult | null> {
    if (analysisId === null) return null
    const requestId = nextRequestId()
    const resp = await sendControl(
      { type: 'spectrogram:point-query', requestId, analysisId, timeSec: aTimeSec, frequencyHz: aFrequencyHz },
      requestId,
    ).catch(() => null)
    return resp !== null && resp.type === 'spectrogram:point' ? resp.point : null
  }

  async function areaQuery(
    aTimeStartSec: number,
    aTimeEndSec: number,
    aFreqStartHz: number,
    aFreqEndHz: number,
  ): Promise<SpectrogramAreaResult | null> {
    if (analysisId === null) return null
    const requestId = nextRequestId()
    const resp = await sendControl(
      {
        type: 'spectrogram:area-query',
        requestId,
        analysisId,
        timeStartSec: aTimeStartSec,
        timeEndSec: aTimeEndSec,
        freqStartHz: aFreqStartHz,
        freqEndHz: aFreqEndHz,
      },
      requestId,
    ).catch(() => null)
    return resp !== null && resp.type === 'spectrogram:area' ? resp.area : null
  }

  // SF24.1: backend waveform peaks (min/max/rms per bucket) over a time range.
  async function getPeaks(
    aTimeStartSec: number,
    aTimeEndSec: number,
    aBuckets: number,
  ): Promise<AudioPeak[]> {
    if (analysisId === null || aBuckets <= 0) return []
    const requestId = nextRequestId()
    const resp = await sendControl(
      { type: 'spectrogram:get-peaks', requestId, analysisId, timeStartSec: aTimeStartSec, timeEndSec: aTimeEndSec, buckets: aBuckets },
      requestId,
    ).catch(() => null)
    if (resp === null || resp.type !== 'spectrogram:peaks' || resp.peaksB64 === '') return []
    const binary = atob(resp.peaksB64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const floats = new Float32Array(bytes.buffer, 0, Math.floor(binary.length / 4))
    const out: AudioPeak[] = []
    for (let b = 0; b < resp.buckets; b++) {
      out.push({ min: floats[b * 3] ?? 0, max: floats[b * 3 + 1] ?? 0, rms: floats[b * 3 + 2] ?? 0 })
    }
    return out
  }

  async function close(): Promise<void> {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    opening = false
    pendingTiles.clear()
    tileClearInstance(instanceId) // SF24: drop any queued (unsent) tiles for this instance
    // Drop the stale view so the next open's setView is never skipped by the no-op guard.
    currentView = null
    updateLoading()
    if (analysisId === null) return
    const requestId = nextRequestId()
    const id = analysisId
    analysisId = null
    analysis.value = null
    tiles.value = []
    cache.clear()
    try {
      await sendControl({ type: 'spectrogram:close', requestId, analysisId: id }, requestId)
    } catch {
      // closing a dead connection is fine
    }
  }

  function dispose(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    unsubscribe()
    controlWaiters.clear()
    pendingTiles.clear()
    tileClearInstance(instanceId)
  }

  onScopeDispose(dispose)

  return { analysis, tiles, loading, preparing, fetchingTiles, error, open, reconfigure, setView, pointQuery, areaQuery, getPeaks, close, dispose }
}
