<template>
  <div class="spectrogram-view" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="spectrogram-view__canvas"
      role="img"
      :aria-label="t('audio.spectrogramCanvasLabel')"
      :class="{ 'spectrogram-view__canvas--seekable': seekable }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    />
    <!-- SF10.2: channel label as a top-left overlay on the plot, same place for L and R -->
    <span v-if="label" class="spectrogram-view__label-overlay">{{ label }}</span>
    <!-- SF-D25: point/area readout as a tooltip at the cursor (not a toolbar) -->
    <div
      v-if="tooltipText !== null && tooltipPos !== null"
      class="spectrogram-view__tooltip"
      :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      role="status"
      aria-live="polite"
      :aria-label="t('audio.spectrogramReadout')"
    >
      {{ tooltipText }}
    </div>
    <div
      v-if="isPreparing"
      class="spectrogram-view__loading"
      role="status"
      aria-live="polite"
      :aria-label="t('audio.spectrogramPreparing')"
    >
      <q-spinner-hourglass color="cyan-4" size="32px" />
      <span class="spectrogram-view__loading-label">{{ t('audio.spectrogramPreparing') }}</span>
    </div>
    <div
      v-else-if="specError !== null"
      class="spectrogram-view__error"
      role="alert"
    >
      {{ specError }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpectrogramAnalysisParams, SpectrogramAreaResult } from '@protocol'

import { useSpectrogram } from '../composables/use-spectrogram'
import { tileToImage, type SpectrogramRenderOptions } from '../composables/spectrogram-render'
import {
  areaQueryBounds,
  formatHz,
  formatTimeSec,
  frequencyAtFraction,
  frequencyAxisTicks,
  timeAxisTicks,
} from '../composables/spectrogram-axes'
import {
  fractionToTime,
  fullWindow,
  MIN_WINDOW_SEC,
  timeToFraction,
  viewportZoomTier,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
} from '../composables/spectrogram-viewport'

// Render SpectrumCore worker tiles on a canvas with axis chrome (U2.2/U2.3/U3.1)
// and time zoom/pan (U3.2). The visible window drives the worker get-tile via the
// composable; the frequency axis is fscale-correct (worker binFrequenciesHz).

interface Props {
  filePath: string | null
  /** Worker analysis params (window/hop/win_func/data/fscale/...); a change
      re-analyses the open source (DU5 reconfigure). */
  analysis?: SpectrogramAnalysisParams
  /** Client-side render transform applied live on the cached linear tiles (DU5). */
  render?: Partial<SpectrogramRenderOptions>
  /** Current transport playback position (s); draws a playhead overlay (U3.3). */
  playheadSec?: number | null
  /** When true, clicking the plot emits `seek` with the clicked time. */
  seekable?: boolean
  /** Fixed track height in px (Audacity-like). When omitted the view flex-fills. */
  height?: number
  /** Short channel label shown as a top-left plot overlay (e.g. "L" / "R"). */
  label?: string
  /** First track of a stack: shows the control toolbar + area-query readout (SF8.1). */
  primary?: boolean
  /** Draw the horizontal time ruler above the plot (first track of a stack) — SF10.3. */
  showTimeAxisTop?: boolean
  /** Draw the horizontal time ruler below the plot (last track of a stack) — SF10.3. */
  showTimeAxisBottom?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  primary: true,
  showTimeAxisTop: false,
  showTimeAxisBottom: true,
})
const emit = defineEmits<{
  (event: 'seek', sec: number): void
}>()

// SF8.1: stacked tracks (stereo L/R) share one time window + area selection so they
// zoom/pan/select together. AudioPage provides these reactive refs; standalone use
// falls back to per-view internal state.
interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

// SF9: track resize (mutual divider + uniform bottom handle) now lives in the AudioPage
// stack (SF-D19/D20); this view just takes `height` as a plain prop.
const canvasEl = ref<HTMLCanvasElement | null>(null)
const spec = useSpectrogram()

const MAX_VIEW_BINS = 512
const AXIS_MARGIN = { left: 46, right: 8 }
// SF10.3: vertical room for a time ruler (ticks + labels) on an edge that shows one,
// vs a small plain margin on an edge that doesn't.
const AXIS_TIME_MARGIN = 18
const AXIS_PLAIN_MARGIN = 6
const marginTop = (): number => (props.showTimeAxisTop ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
const marginBottom = (): number => (props.showTimeAxisBottom ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null
let offscreen: HTMLCanvasElement | null = null

const internalView = ref<TimeWindow>({ startSec: 0, endSec: 0 })
// Shared time window across stacked tracks (or per-view fallback).
const view = computed<TimeWindow>({
  get: () => shared?.view.value ?? internalView.value,
  set: (v) => {
    if (shared) shared.view.value = v
    else internalView.value = v
  },
})

const hasAnalysis = computed(() => spec.analysis.value !== null)
const isPreparing = computed(() => spec.loading.value)
const specError = computed(() => spec.error.value)
const rootStyle = computed(() =>
  props.height !== undefined && props.height > 0
    ? { height: `${props.height}px`, minHeight: `${props.height}px` }
    : {},
)
const duration = computed(() => spec.analysis.value?.durationSec ?? 0)

function plotColumns(canvas: HTMLCanvasElement): number {
  return Math.max(1, Math.floor(canvas.clientWidth) - AXIS_MARGIN.left - AXIS_MARGIN.right)
}

function getOffscreen(aWidth: number, aHeight: number): HTMLCanvasElement {
  if (offscreen === null) {
    offscreen = document.createElement('canvas')
  }
  if (offscreen.width !== aWidth) offscreen.width = aWidth
  if (offscreen.height !== aHeight) offscreen.height = aHeight
  return offscreen
}

function draw(): void {
  const canvas = canvasEl.value
  if (canvas === null) return
  const ctx = canvas.getContext('2d')
  if (ctx === null) return

  const cssWidth = Math.max(1, Math.floor(canvas.clientWidth))
  const cssHeight = Math.max(1, Math.floor(canvas.clientHeight))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  const analysis = spec.analysis.value
  const tiles = spec.tiles.value
  if (analysis === null || analysis.frameCount <= 0) return

  const plotX = AXIS_MARGIN.left
  const plotY = marginTop()
  const plotW = Math.max(1, cssWidth - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssHeight - marginTop() - marginBottom())

  const win = view.value
  const winStart = win.startSec
  const winWidth = Math.max(MIN_WINDOW_SEC, win.endSec - win.startSec)
  const secPerFrame = analysis.durationSec / analysis.frameCount

  // Draw the tiles (if any). Axes are drawn regardless so an analysis with no tiles
  // yet still shows the framed plot rather than a fully blank panel.
  if (tiles.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(plotX, plotY, plotW, plotH)
    ctx.clip()
    ctx.imageSmoothingEnabled = true
    for (const tile of tiles) {
      const image = tileToImage(tile, props.render)
      if (image.width === 0 || image.height === 0) continue
      const off = getOffscreen(image.width, image.height)
      const offCtx = off.getContext('2d')
      if (offCtx === null) continue
      offCtx.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0)
      const tileStartSec = tile.frameStart * secPerFrame
      const tileWidthSec = tile.frameCount * secPerFrame
      const x = plotX + ((tileStartSec - winStart) / winWidth) * plotW
      const w = (tileWidthSec / winWidth) * plotW
      ctx.drawImage(off, 0, 0, image.width, image.height, x, plotY, Math.ceil(w) + 1, plotH)
    }
    ctx.restore()
  }

  drawAxes(ctx, plotX, plotY, plotW, plotH, tiles[0]?.binFrequenciesHz ?? [], win.startSec, win.endSec)

  // playhead overlay (U3.3) when the transport position is inside the window
  const playhead = props.playheadSec
  if (playhead !== null && playhead !== undefined) {
    const fraction = timeToFraction(playhead, win)
    if (fraction >= 0 && fraction <= 1) {
      const px = Math.round(plotX + fraction * plotW) + 0.5
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, plotY)
      ctx.lineTo(px, plotY + plotH)
      ctx.stroke()
    }
  }

  // area selection rectangle (U5.2), mapped to the current view + display bins
  const sel = selection.value
  if (sel !== null) {
    const sx0 = plotX + clamp01(timeToFraction(sel.timeStartSec, win)) * plotW
    const sx1 = plotX + clamp01(timeToFraction(sel.timeEndSec, win)) * plotW
    const sy0 = plotY + sel.topLo * plotH
    const sy1 = plotY + sel.topHi * plotH
    ctx.fillStyle = 'rgba(34, 211, 238, 0.15)'
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0)
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'
    ctx.lineWidth = 1
    ctx.strokeRect(sx0 + 0.5, sy0 + 0.5, Math.max(0, sx1 - sx0 - 1), Math.max(0, sy1 - sy0 - 1))
  }
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
  binFrequenciesHz: readonly number[],
  timeStartSec: number,
  timeEndSec: number,
): void {
  ctx.font = '10px sans-serif'
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1

  ctx.fillStyle = '#94a3b8'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  // SF8.2: reveal more frequency levels as the track grows (like Audacity) -- ~1 label
  // per 42px of plot height, clamped so short tracks stay readable.
  const freqTickCount = Math.max(3, Math.min(20, Math.floor(plotH / 42)))
  for (const tick of frequencyAxisTicks(binFrequenciesHz, freqTickCount)) {
    const y = Math.min(plotY + plotH - 1, Math.max(plotY + 5, plotY + tick.position * plotH))
    ctx.beginPath()
    ctx.moveTo(plotX - 3, y)
    ctx.lineTo(plotX, y)
    ctx.stroke()
    ctx.fillText(formatHz(tick.value), plotX - 5, y)
  }

  // SF10.3: the time ruler is drawn only above the first track and below the last track
  // (props.showTimeAxisTop / showTimeAxisBottom); middle tracks carry none.
  ctx.textAlign = 'center'
  const ticks = timeAxisTicks(timeStartSec, timeEndSec, 6)
  if (props.showTimeAxisBottom) {
    ctx.textBaseline = 'top'
    for (const tick of ticks) {
      const x = Math.min(plotX + plotW - 1, Math.max(plotX, plotX + tick.position * plotW))
      ctx.beginPath()
      ctx.moveTo(x, plotY + plotH)
      ctx.lineTo(x, plotY + plotH + 3)
      ctx.stroke()
      ctx.fillText(formatTimeSec(tick.value), x, plotY + plotH + 4)
    }
  }
  if (props.showTimeAxisTop) {
    ctx.textBaseline = 'bottom'
    for (const tick of ticks) {
      const x = Math.min(plotX + plotW - 1, Math.max(plotX, plotX + tick.position * plotW))
      ctx.beginPath()
      ctx.moveTo(x, plotY)
      ctx.lineTo(x, plotY - 3)
      ctx.stroke()
      ctx.fillText(formatTimeSec(tick.value), x, plotY - 4)
    }
  }
}

function scheduleDraw(): void {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0
    draw()
  })
}

function applyView(): void {
  const analysis = spec.analysis.value
  const canvas = canvasEl.value
  if (analysis === null || canvas === null) return
  const columns = plotColumns(canvas)
  // SF7.2: viewBinCount is FIXED (decoupled from track height) so a height resize
  // leaves the view (time window + zoom + viewBinCount) unchanged -> the setView
  // no-op guard skips any refetch and the raster simply scales to the new height.
  // (Width/time zoom still refetch via `columns`.)
  const viewBinCount = MAX_VIEW_BINS
  spec.setView({
    timeStartSec: view.value.startSec,
    timeEndSec: view.value.endSec,
    zoom: viewportZoomTier(view.value, analysis.durationSec, analysis.frameCount, columns),
    viewBinCount,
  })
}


function onWheel(aEvent: WheelEvent): void {
  if (!hasAnalysis.value) return
  const canvas = canvasEl.value
  if (canvas === null) return
  const plotW = plotColumns(canvas)
  const anchor = Math.min(1, Math.max(0, (aEvent.offsetX - AXIS_MARGIN.left) / plotW))
  const factor = aEvent.deltaY < 0 ? 0.8 : 1.25
  view.value = zoomWindow(view.value, factor, anchor, duration.value)
}

const hover = ref<{ timeSec: number; freqHz: number; db: number } | null>(null)
// SF-D25: cursor tooltip position (offset within the view) + text (area result on the
// primary track, else the hover point).
const tooltipPos = ref<{ x: number; y: number } | null>(null)
const tooltipText = computed<string | null>(() => {
  if (props.primary && areaResult.value !== null) {
    const a = areaResult.value
    return `sel peak ${formatHz(a.peakFreqHz)} @ ${formatTimeSec(a.peakTimeSec)} · ${a.cellCount} cells`
  }
  if (hover.value !== null) {
    const h = hover.value
    return `${formatTimeSec(h.timeSec)} · ${formatHz(h.freqHz)} Hz · ${h.db.toFixed(1)} dB`
  }
  return null
})
const internalSelection = ref<SpectrogramSelection | null>(null)
// Shared area selection across stacked tracks (or per-view fallback).
const selection = computed<SpectrogramSelection | null>({
  get: () => (shared ? shared.selection.value : internalSelection.value),
  set: (s) => {
    if (shared) shared.selection.value = s
    else internalSelection.value = s
  },
})
const areaResult = ref<SpectrogramAreaResult | null>(null)
let lastHoverTs = 0
interface DragStart { x: number; y: number; timeSec: number; topFraction: number }
let dragStart: DragStart | null = null
let dragging = false
let suppressClick = false

const clamp01 = (aValue: number): number => (aValue < 0 ? 0 : aValue > 1 ? 1 : aValue)

function plotFractions(aEvent: PointerEvent): { xFraction: number; yTopFraction: number } | null {
  const canvas = canvasEl.value
  if (canvas === null) return null
  const plotW = plotColumns(canvas)
  const plotH = Math.max(1, Math.floor(canvas.clientHeight) - marginTop() - marginBottom())
  return {
    xFraction: (aEvent.offsetX - AXIS_MARGIN.left) / plotW,
    yTopFraction: (aEvent.offsetY - marginTop()) / plotH,
  }
}

function onPointerDown(aEvent: PointerEvent): void {
  if (!hasAnalysis.value) return
  const f = plotFractions(aEvent)
  if (f === null || f.xFraction < 0 || f.xFraction > 1 || f.yTopFraction < 0 || f.yTopFraction > 1) return
  dragStart = {
    x: aEvent.offsetX,
    y: aEvent.offsetY,
    timeSec: fractionToTime(clamp01(f.xFraction), view.value),
    topFraction: clamp01(f.yTopFraction),
  }
  dragging = false
  areaResult.value = null
  selection.value = null
}

function onPointerMove(aEvent: PointerEvent): void {
  if (!hasAnalysis.value) return
  const f = plotFractions(aEvent)
  if (f === null) return

  // Track the cursor for the tooltip (offset a little so it doesn't sit under the pointer).
  tooltipPos.value = { x: aEvent.offsetX + 12, y: aEvent.offsetY + 12 }

  if (dragStart !== null) {
    if (!dragging && Math.hypot(aEvent.offsetX - dragStart.x, aEvent.offsetY - dragStart.y) < 4) return
    dragging = true
    hover.value = null
    const timeNow = fractionToTime(clamp01(f.xFraction), view.value)
    const topNow = clamp01(f.yTopFraction)
    selection.value = {
      timeStartSec: Math.min(dragStart.timeSec, timeNow),
      timeEndSec: Math.max(dragStart.timeSec, timeNow),
      topLo: Math.min(dragStart.topFraction, topNow),
      topHi: Math.max(dragStart.topFraction, topNow),
    }
    scheduleDraw()
    return
  }

  if (f.xFraction < 0 || f.xFraction > 1 || f.yTopFraction < 0 || f.yTopFraction > 1) {
    hover.value = null
    tooltipPos.value = null
    return
  }
  const now = performance.now()
  if (now - lastHoverTs < 60) return // throttle point-query
  lastHoverTs = now
  const timeSec = fractionToTime(f.xFraction, view.value)
  const freqHz = frequencyAtFraction(f.yTopFraction, spec.tiles.value[0]?.binFrequenciesHz ?? [])
  void spec.pointQuery(timeSec, freqHz).then((point) => {
    if (point !== null) {
      hover.value = { timeSec: point.frameTimeSec, freqHz: point.binHz, db: point.displayDb }
    }
  })
}

function onPointerUp(): void {
  if (dragStart !== null && dragging && selection.value !== null) {
    // Commit: the primary track runs the area-query (SF8.1) for the shared selection.
    if (shared) shared.commitSeq.value += 1
    else runAreaQuery()
    suppressClick = true // a drag isn't a seek click
  }
  dragStart = null
  dragging = false
}

function runAreaQuery(): void {
  const sel = selection.value
  if (sel === null) {
    areaResult.value = null
    return
  }
  const binFreqs = spec.tiles.value[0]?.binFrequenciesHz ?? []
  const bounds = areaQueryBounds(
    { timeSec: sel.timeStartSec, topFraction: sel.topLo },
    { timeSec: sel.timeEndSec, topFraction: sel.topHi },
    binFreqs,
  )
  void spec
    .areaQuery(bounds.timeStartSec, bounds.timeEndSec, bounds.freqStartHz, bounds.freqEndHz)
    .then((area) => {
      areaResult.value = area
    })
}

function onPointerLeave(): void {
  hover.value = null
  tooltipPos.value = null
}

function onClick(aEvent: MouseEvent): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  if (props.seekable !== true || !hasAnalysis.value) return
  const canvas = canvasEl.value
  if (canvas === null) return
  const plotW = plotColumns(canvas)
  const fraction = (aEvent.offsetX - AXIS_MARGIN.left) / plotW
  if (fraction < 0 || fraction > 1) return
  const sec = fractionToTime(fraction, view.value)
  emit('seek', Math.max(0, Math.min(duration.value, sec)))
}

async function openForPath(aFilePath: string | null): Promise<void> {
  await spec.close()
  if (aFilePath === null || aFilePath === '') {
    scheduleDraw()
    return
  }
  try {
    const info = await spec.open({ filePath: aFilePath, ...(props.analysis ?? { window: 2048, hop: 512 }) })
    // Initialize the (possibly shared) time window once per file; a sibling track that
    // already set it wins so stacked tracks stay in sync (SF8.1).
    if (shared === null || shared.view.value === null) {
      view.value = fullWindow(info.durationSec)
    }
    applyView()
  } catch {
    // surfaced via spec.error
  }
}

let reconfiguring = false
async function reconfigureAnalysis(): Promise<void> {
  if (props.analysis === undefined || spec.analysis.value === null || reconfiguring) return
  reconfiguring = true
  try {
    await spec.reconfigure(props.analysis)
    applyView()
  } catch {
    // surfaced via spec.error
  } finally {
    reconfiguring = false
  }
}

watch(() => props.filePath, (value) => {
  void openForPath(value)
})

// view window changed (zoom/pan, possibly from a sibling track) -> refetch tiles for
// the new range and redraw (axes/playhead/selection move even if tiles are cached).
watch(view, () => {
  applyView()
  scheduleDraw()
}, { deep: true })

// shared selection changed (from any track) -> redraw the rect on this track (SF8.1).
watch(selection, () => {
  scheduleDraw()
}, { deep: true })

// primary runs the area-query readout when any track commits a selection (SF8.1),
// and clears it when the shared selection is cleared.
if (shared !== null) {
  watch(() => shared.commitSeq.value, () => {
    if (props.primary) runAreaQuery()
  })
  watch(() => shared.selection.value, (sel) => {
    if (props.primary && sel === null) areaResult.value = null
  })
}

watch([spec.tiles, spec.analysis], () => {
  scheduleDraw()
})

// render-only transform changes redraw cached tiles, no refetch (DU5).
watch(() => props.render, () => {
  scheduleDraw()
}, { deep: true })

// playhead position moves during playback -> redraw the overlay only (no refetch).
watch(() => props.playheadSec, () => {
  scheduleDraw()
})

// analysis params changed -> re-analyse the open source (reconfigure), then refetch.
// Debounced so dragging a control coalesces into one re-analysis (U4.2).
let reconfigureTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.analysis, () => {
  if (reconfigureTimer !== null) clearTimeout(reconfigureTimer)
  reconfigureTimer = setTimeout(() => {
    reconfigureTimer = null
    void reconfigureAnalysis()
  }, 150)
}, { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => {
      applyView()
      scheduleDraw()
    })
    resizeObserver.observe(canvasEl.value)
  }
  void openForPath(props.filePath)
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (reconfigureTimer !== null) {
    clearTimeout(reconfigureTimer)
    reconfigureTimer = null
  }
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  void spec.close()
})
</script>

<style scoped>
.spectrogram-view {
  background: #0f172a;
  display: flex;
  flex-direction: column;
  min-height: 280px;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.spectrogram-view__loading {
  align-items: center;
  background: rgba(15, 23, 42, 0.55);
  color: #e2e8f0;
  display: flex;
  gap: 12px;
  inset: 0;
  justify-content: center;
  position: absolute;
  z-index: 5;
}

.spectrogram-view__loading-label {
  font-size: 13px;
}

.spectrogram-view__error {
  align-items: center;
  background: rgba(15, 23, 42, 0.72);
  color: #fca5a5;
  display: flex;
  font-size: 13px;
  inset: 0;
  justify-content: center;
  padding: 24px;
  position: absolute;
  text-align: center;
  z-index: 6;
}

/* SF10.2: channel label overlaid on the plot's top-left (same place for every track). */
.spectrogram-view__label-overlay {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 3px;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  left: 50px;
  padding: 0 4px;
  pointer-events: none;
  position: absolute;
  top: 4px;
  z-index: 4;
}

/* SF-D25: point/area readout tooltip anchored at the cursor. */
.spectrogram-view__tooltip {
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  pointer-events: none;
  position: absolute;
  white-space: nowrap;
  z-index: 7;
}

.spectrogram-view__canvas {
  display: block;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.spectrogram-view__canvas--seekable {
  cursor: pointer;
}
</style>
