import { onScopeDispose, ref, shallowRef, type Ref } from 'vue'
import type {
  SpectrogramAnalysisInfo,
  SpectrogramAnalysisParams,
  SpectrogramAreaResult,
  SpectrogramPointResult,
  SpectrogramServerMessage,
  SpectrogramTile,
} from '@protocol'

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
}

export interface UseSpectrogram {
  readonly analysis: Ref<SpectrogramAnalysisInfo | null>
  readonly tiles: Ref<readonly SpectrogramTile[]>
  readonly loading: Ref<boolean>
  readonly error: Ref<string | null>
  open(aParams: SpectrogramAnalysisParams & { readonly filePath?: string }): Promise<SpectrogramAnalysisInfo>
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

  const analysis = shallowRef<SpectrogramAnalysisInfo | null>(null)
  const tiles = shallowRef<readonly SpectrogramTile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const cache = new SpectrogramTileCache<SpectrogramTile>(aOptions.cacheSize ?? DEFAULT_TILE_CACHE_SIZE)
  const tileFrames = aOptions.tileFrames ?? DEFAULT_TILE_FRAMES
  const debounceMs = aOptions.refetchDebounceMs ?? 80

  let analysisId: string | null = null
  let currentView: SpectrogramView | null = null
  let viewSeq = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const pendingTiles = new Map<string, PendingTile>()
  const controlWaiters = new Map<string, (aMessage: SpectrogramServerMessage) => void>()

  function updateLoading(): void {
    let active = 0
    for (const p of pendingTiles.values()) {
      if (p.seq === viewSeq) active += 1
    }
    loading.value = active > 0
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
      tileFrames,
    })
    const present: SpectrogramTile[] = []
    for (const r of reqs) {
      const tile = cache.get(r.key)
      if (tile !== undefined) present.push(tile)
    }
    tiles.value = present
  }

  function handleServerMessage(aMessage: SpectrogramServerMessage): void {
    const waiter = controlWaiters.get(aMessage.requestId)
    if (waiter !== undefined) {
      controlWaiters.delete(aMessage.requestId)
      waiter(aMessage)
      return
    }
    if (aMessage.type === 'spectrogram:tile') {
      const pending = pendingTiles.get(aMessage.requestId)
      if (pending === undefined) return
      pendingTiles.delete(aMessage.requestId)
      cache.set(pending.key, aMessage.tile)
      if (pending.seq === viewSeq) {
        assembleVisibleTiles()
      }
      updateLoading()
      return
    }
    if (aMessage.type === 'spectrogram:error') {
      if (pendingTiles.has(aMessage.requestId)) {
        pendingTiles.delete(aMessage.requestId)
        updateLoading()
      }
      error.value = aMessage.error
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
    aParams: SpectrogramAnalysisParams & { readonly filePath?: string },
  ): Promise<SpectrogramAnalysisInfo> {
    error.value = null
    const requestId = nextRequestId()
    const resp = await sendControl({ type: 'spectrogram:open', requestId, ...aParams }, requestId)
    if (resp.type === 'spectrogram:opened') {
      analysis.value = resp.analysis
      analysisId = resp.analysis.analysisId
      cache.clear()
      pendingTiles.clear()
      tiles.value = []
      if (currentView !== null) scheduleRefetch()
      return resp.analysis
    }
    const message = resp.type === 'spectrogram:error' ? resp.error : 'spectrogram: open failed'
    error.value = message
    throw new Error(message)
  }

  async function reconfigure(aParams: SpectrogramAnalysisParams): Promise<SpectrogramAnalysisInfo> {
    if (analysisId === null) throw new Error('spectrogram: no open analysis to reconfigure')
    error.value = null
    const requestId = nextRequestId()
    const resp = await sendControl(
      { type: 'spectrogram:reconfigure', requestId, analysisId, ...aParams },
      requestId,
    )
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
    const message = resp.type === 'spectrogram:error' ? resp.error : 'spectrogram: reconfigure failed'
    error.value = message
    throw new Error(message)
  }

  function refetch(): void {
    if (analysisId === null || currentView === null || analysis.value === null) return
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
      tileFrames,
    })
    const secPerFrame = analysis.value.durationSec / analysis.value.frameCount
    for (const r of reqs) {
      if (cache.has(r.key)) continue
      const requestId = nextRequestId()
      pendingTiles.set(requestId, { key: r.key, seq })
      ws.sendSpectrogram({
        type: 'spectrogram:get-tile',
        requestId,
        analysisId,
        timeStartSec: r.frameStart * secPerFrame,
        timeEndSec: (r.frameStart + r.frameCount) * secPerFrame,
        zoom: r.zoom,
        viewBinCount: r.viewBinCount,
      })
    }
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

  function setView(aView: SpectrogramView): void {
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

  async function close(): Promise<void> {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    pendingTiles.clear()
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
  }

  onScopeDispose(dispose)

  return { analysis, tiles, loading, error, open, reconfigure, setView, pointQuery, areaQuery, close, dispose }
}
