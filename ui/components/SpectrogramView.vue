<template>
  <div class="spectrogram-view" :style="rootStyle">
    <div class="spectrogram-view__toolbar">
      <span v-if="label" class="spectrogram-view__label">{{ label }}</span>
      <q-btn dense flat round size="sm" icon="zoom_in" :disable="!hasAnalysis" :aria-label="t('audio.spectrogramZoomIn')" @click="zoomIn" />
      <q-btn dense flat round size="sm" icon="zoom_out" :disable="!hasAnalysis" :aria-label="t('audio.spectrogramZoomOut')" @click="zoomOut" />
      <q-btn dense flat round size="sm" icon="fit_screen" :disable="!hasAnalysis || isFull" :aria-label="t('audio.spectrogramFit')" @click="resetView" />
      <q-range
        v-if="hasAnalysis"
        v-model="rangeModel"
        :min="0"
        :max="duration"
        :step="rangeStep"
        :left-label-value="formatTimeSec(rangeModel.min)"
        :right-label-value="formatTimeSec(rangeModel.max)"
        label
        dense
        class="spectrogram-view__range col"
      />
      <div
        v-if="areaResult !== null"
        class="spectrogram-view__readout"
        role="status"
        aria-live="polite"
        :aria-label="t('audio.spectrogramReadout')"
      >
        sel peak {{ formatHz(areaResult.peakFreqHz) }} @ {{ formatTimeSec(areaResult.peakTimeSec) }} · {{ areaResult.cellCount }} cells
      </div>
      <div
        v-else-if="hover !== null"
        class="spectrogram-view__readout"
        role="status"
        aria-live="polite"
        :aria-label="t('audio.spectrogramReadout')"
      >
        {{ formatTimeSec(hover.timeSec) }} · {{ formatHz(hover.freqHz) }} Hz · {{ hover.db.toFixed(1) }} dB
      </div>
    </div>
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
    <div
      v-if="height !== undefined"
      class="spectrogram-view__resize-handle"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="t('audio.spectrogramResizeHandle')"
      title=""
      @pointerdown="onResizePointerDown"
      @pointermove="onResizePointerMove"
      @pointerup="onResizePointerUp"
      @pointercancel="onResizePointerUp"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  clampWindow,
  fractionToTime,
  fullWindow,
  isFullWindow,
  MIN_WINDOW_SEC,
  timeToFraction,
  viewportZoomTier,
  zoomWindow,
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
  /** Short channel label shown in the toolbar (e.g. "L" / "R" for a stereo split). */
  label?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  (event: 'update:height', px: number): void
}>()
const { t } = useI18n()

const MIN_TRACK_HEIGHT = 120
const MAX_TRACK_HEIGHT = 1200
let resizeStartY = 0
let resizeStartHeight = 0
let resizing = false

function onResizePointerDown(aEvent: PointerEvent): void {
  if (props.height === undefined) return
  resizing = true
  resizeStartY = aEvent.clientY
  resizeStartHeight = props.height
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}

function onResizePointerMove(aEvent: PointerEvent): void {
  if (!resizing) return
  const next = Math.max(
    MIN_TRACK_HEIGHT,
    Math.min(MAX_TRACK_HEIGHT, resizeStartHeight + (aEvent.clientY - resizeStartY)),
  )
  emit('update:height', Math.round(next))
}

function onResizePointerUp(aEvent: PointerEvent): void {
  if (!resizing) return
  resizing = false
  try {
    ;(aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId)
  } catch {
    // pointer capture may already be released
  }
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
const spec = useSpectrogram()

const MAX_VIEW_BINS = 512
const AXIS_MARGIN = { left: 46, right: 8, top: 6, bottom: 18 }
let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null
let offscreen: HTMLCanvasElement | null = null

const view = ref<TimeWindow>({ startSec: 0, endSec: 0 })

const hasAnalysis = computed(() => spec.analysis.value !== null)
const isPreparing = computed(() => spec.loading.value)
const specError = computed(() => spec.error.value)
const rootStyle = computed(() =>
  props.height !== undefined && props.height > 0
    ? { height: `${props.height}px`, minHeight: `${props.height}px` }
    : {},
)
const duration = computed(() => spec.analysis.value?.durationSec ?? 0)
const isFull = computed(() => isFullWindow(view.value, duration.value))
const rangeStep = computed(() => (duration.value > 0 ? Math.max(0.001, duration.value / 1000) : 0.01))
const rangeModel = computed({
  get: () => ({ min: view.value.startSec, max: view.value.endSec }),
  set: (value: { min: number; max: number }) => {
    view.value = clampWindow({ startSec: value.min, endSec: value.max }, duration.value)
  },
})

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
  const plotY = AXIS_MARGIN.top
  const plotW = Math.max(1, cssWidth - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssHeight - AXIS_MARGIN.top - AXIS_MARGIN.bottom)

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

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const tick of timeAxisTicks(timeStartSec, timeEndSec, 6)) {
    const x = Math.min(plotX + plotW - 1, Math.max(plotX, plotX + tick.position * plotW))
    ctx.beginPath()
    ctx.moveTo(x, plotY + plotH)
    ctx.lineTo(x, plotY + plotH + 3)
    ctx.stroke()
    ctx.fillText(formatTimeSec(tick.value), x, plotY + plotH + 4)
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

function zoomIn(): void {
  view.value = zoomWindow(view.value, 0.5, 0.5, duration.value)
}

function zoomOut(): void {
  view.value = zoomWindow(view.value, 2, 0.5, duration.value)
}

function resetView(): void {
  view.value = fullWindow(duration.value)
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
const selection = ref<{ timeStartSec: number; timeEndSec: number; topLo: number; topHi: number } | null>(null)
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
  const plotH = Math.max(1, Math.floor(canvas.clientHeight) - AXIS_MARGIN.top - AXIS_MARGIN.bottom)
  return {
    xFraction: (aEvent.offsetX - AXIS_MARGIN.left) / plotW,
    yTopFraction: (aEvent.offsetY - AXIS_MARGIN.top) / plotH,
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
    const binFreqs = spec.tiles.value[0]?.binFrequenciesHz ?? []
    const bounds = areaQueryBounds(
      { timeSec: selection.value.timeStartSec, topFraction: selection.value.topLo },
      { timeSec: selection.value.timeEndSec, topFraction: selection.value.topHi },
      binFreqs,
    )
    void spec
      .areaQuery(bounds.timeStartSec, bounds.timeEndSec, bounds.freqStartHz, bounds.freqEndHz)
      .then((area) => {
        areaResult.value = area
      })
    suppressClick = true // a drag isn't a seek click
  }
  dragStart = null
  dragging = false
}

function onPointerLeave(): void {
  hover.value = null
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
    view.value = fullWindow(info.durationSec)
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

// view window changed (zoom/pan) -> refetch tiles for the new range (composable
// debounces + caches + cancels stale).
watch(view, () => {
  applyView()
}, { deep: true })

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
  border-radius: 12px;
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

.spectrogram-view__toolbar {
  align-items: center;
  color: #94a3b8;
  display: flex;
  gap: 4px;
  padding: 4px 8px 0;
}

.spectrogram-view__label {
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  padding: 0 4px;
}

.spectrogram-view__range {
  margin-left: 12px;
}

.spectrogram-view__readout {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  margin-left: 12px;
  opacity: 0.85;
  white-space: nowrap;
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

.spectrogram-view__resize-handle {
  background: rgba(148, 163, 184, 0.14);
  cursor: ns-resize;
  flex: 0 0 auto;
  height: 8px;
  touch-action: none;
  width: 100%;
}

.spectrogram-view__resize-handle:hover {
  background: rgba(148, 163, 184, 0.4);
}
</style>
