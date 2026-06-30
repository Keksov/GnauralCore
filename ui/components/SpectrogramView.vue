<template>
  <div class="spectrogram-view">
    <div class="spectrogram-view__toolbar">
      <q-btn dense flat round size="sm" icon="zoom_in" :disable="!hasAnalysis" aria-label="Zoom in" @click="zoomIn" />
      <q-btn dense flat round size="sm" icon="zoom_out" :disable="!hasAnalysis" aria-label="Zoom out" @click="zoomOut" />
      <q-btn dense flat round size="sm" icon="fit_screen" :disable="!hasAnalysis || isFull" aria-label="Fit to clip" @click="resetView" />
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
    </div>
    <canvas
      ref="canvasEl"
      class="spectrogram-view__canvas"
      role="img"
      :aria-label="t('audio.spectrogramCanvasLabel')"
      :class="{ 'spectrogram-view__canvas--seekable': seekable }"
      @wheel.prevent="onWheel"
      @click="onClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpectrogramAnalysisParams } from '@protocol'

import { useSpectrogram } from '../composables/use-spectrogram'
import { tileToImage, type SpectrogramRenderOptions } from '../composables/spectrogram-render'
import {
  formatHz,
  formatTimeSec,
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
}

const props = defineProps<Props>()
const emit = defineEmits<{ (event: 'seek', sec: number): void }>()
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const spec = useSpectrogram()

const MAX_VIEW_BINS = 512
const AXIS_MARGIN = { left: 46, right: 8, top: 6, bottom: 18 }
let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null
let offscreen: HTMLCanvasElement | null = null

const view = ref<TimeWindow>({ startSec: 0, endSec: 0 })

const hasAnalysis = computed(() => spec.analysis.value !== null)
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
  if (analysis === null || analysis.frameCount <= 0 || tiles.length === 0) return

  const plotX = AXIS_MARGIN.left
  const plotY = AXIS_MARGIN.top
  const plotW = Math.max(1, cssWidth - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssHeight - AXIS_MARGIN.top - AXIS_MARGIN.bottom)

  const win = view.value
  const winStart = win.startSec
  const winWidth = Math.max(MIN_WINDOW_SEC, win.endSec - win.startSec)
  const secPerFrame = analysis.durationSec / analysis.frameCount

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
  for (const tick of frequencyAxisTicks(binFrequenciesHz, 6)) {
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
  const viewBinCount = Math.max(
    16,
    Math.min(MAX_VIEW_BINS, Math.floor(canvas.clientHeight) - AXIS_MARGIN.top - AXIS_MARGIN.bottom),
  )
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

function onClick(aEvent: MouseEvent): void {
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
  width: 100%;
}

.spectrogram-view__toolbar {
  align-items: center;
  color: #94a3b8;
  display: flex;
  gap: 4px;
  padding: 4px 8px 0;
}

.spectrogram-view__range {
  margin-left: 12px;
}

.spectrogram-view__canvas {
  display: block;
  flex: 1 1 auto;
  min-height: 240px;
  width: 100%;
}

.spectrogram-view__canvas--seekable {
  cursor: pointer;
}
</style>
