<template>
  <div class="spectrogram-minimap">
    <canvas
      ref="canvasEl"
      class="spectrogram-minimap__canvas"
      :class="{ 'spectrogram-minimap__canvas--active': hasView }"
      :style="{ cursor: cursor }"
      role="slider"
      :aria-label="t('audio.spectrogramTimespan')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpectrogramAnalysisParams } from '@protocol'

import { useSpectrogram } from '../composables/use-spectrogram'
import { tileToImage, type SpectrogramRenderOptions } from '../composables/spectrogram-render'
import { formatTimeSec, timeAxisTicks } from '../composables/spectrogram-axes'
import {
  clampWindow,
  MIN_WINDOW_SEC,
  viewportZoomTier,
  type TimeWindow,
} from '../composables/spectrogram-viewport'

// SF10.4 (SF-D24): fixed bottom minimap-overview of the whole clip with a
// draggable/resizable visible-window handle (player-style), replacing the q-range.
// Drag the window body to pan, its edges to zoom; click outside to recenter.
// SF11.7/B7: also renders a low-res spectrogram thumbnail of the whole clip behind the
// navigator (its own useSpectrogram, whole-clip view; reuses the primary track's warm
// analysis + tile cache, so it's near-free).

interface Props {
  durationSec: number
  view: TimeWindow | null
  /** Primary-channel analysis params (matches the first track, so the warm analysis is reused). */
  analysis?: SpectrogramAnalysisParams
  /** File to render a thumbnail for (null = no thumbnail). */
  filePath?: string | null
  /** Client-side render transform for the thumbnail tiles. */
  render?: Partial<SpectrogramRenderOptions>
}
const props = defineProps<Props>()
const emit = defineEmits<{ (event: 'update:view', view: TimeWindow): void }>()

const { t } = useI18n()
const spec = useSpectrogram()
const canvasEl = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let renderFrameId = 0
let offscreen: HTMLCanvasElement | null = null

function getOffscreen(aWidth: number, aHeight: number): HTMLCanvasElement {
  if (offscreen === null) offscreen = document.createElement('canvas')
  if (offscreen.width !== aWidth) offscreen.width = aWidth
  if (offscreen.height !== aHeight) offscreen.height = aHeight
  return offscreen
}

const PAD = 6
const EDGE_PX = 6
const hasView = computed(() => props.view !== null && props.durationSec > 0)

function plotWidth(canvas: HTMLCanvasElement): number {
  return Math.max(1, Math.floor(canvas.clientWidth) - PAD * 2)
}
function xForTime(canvas: HTMLCanvasElement, sec: number): number {
  const d = Math.max(MIN_WINDOW_SEC, props.durationSec)
  return PAD + (sec / d) * plotWidth(canvas)
}
function timeForX(canvas: HTMLCanvasElement, x: number): number {
  const d = Math.max(MIN_WINDOW_SEC, props.durationSec)
  const frac = Math.min(1, Math.max(0, (x - PAD) / plotWidth(canvas)))
  return frac * d
}

function draw(): void {
  const canvas = canvasEl.value
  if (canvas === null) return
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  const cssW = Math.max(1, Math.floor(canvas.clientWidth))
  const cssH = Math.max(1, Math.floor(canvas.clientHeight))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(cssW * dpr))
  canvas.height = Math.max(1, Math.floor(cssH * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, cssW, cssH)

  // B7: whole-clip spectrogram thumbnail behind the navigator (falls back to a plain
  // baseline until the tiles arrive).
  const thumbTop = 4
  const thumbH = Math.max(1, cssH - 18)
  const tiles = spec.tiles.value
  const analysis = spec.analysis.value
  if (tiles.length > 0 && analysis !== null && analysis.frameCount > 0) {
    const d = Math.max(MIN_WINDOW_SEC, props.durationSec)
    const secPerFrame = analysis.durationSec / analysis.frameCount
    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD, thumbTop, cssW - PAD * 2, thumbH)
    ctx.clip()
    ctx.imageSmoothingEnabled = true
    for (const tile of tiles) {
      const image = tileToImage(tile, props.render)
      if (image.width === 0 || image.height === 0) continue
      const off = getOffscreen(image.width, image.height)
      const offCtx = off.getContext('2d')
      if (offCtx === null) continue
      offCtx.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0)
      const x = xForTime(canvas, tile.frameStart * secPerFrame)
      const w = ((tile.frameCount * secPerFrame) / d) * plotWidth(canvas)
      ctx.drawImage(off, 0, 0, image.width, image.height, x, thumbTop, Math.ceil(w) + 1, thumbH)
    }
    ctx.restore()
  } else {
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(PAD, thumbTop, cssW - PAD * 2, thumbH)
  }

  if (props.view === null || props.durationSec <= 0) return

  const x0 = xForTime(canvas, props.view.startSec)
  const x1 = xForTime(canvas, props.view.endSec)
  const top = 4
  const h = cssH - 18

  // Dim the parts outside the visible window.
  ctx.fillStyle = 'rgba(15, 23, 42, 0.6)'
  ctx.fillRect(PAD, top, x0 - PAD, h)
  ctx.fillRect(x1, top, cssW - PAD - x1, h)

  // Highlight the visible window + edge handles.
  ctx.fillStyle = 'rgba(34, 211, 238, 0.16)'
  ctx.fillRect(x0, top, Math.max(1, x1 - x0), h)
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'
  ctx.lineWidth = 1
  ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(0, x1 - x0 - 1), h - 1)
  ctx.fillStyle = 'rgba(34, 211, 238, 0.9)'
  ctx.fillRect(x0 - 1, top, 2, h)
  ctx.fillRect(x1 - 1, top, 2, h)

  // Time ticks along the bottom.
  ctx.fillStyle = '#94a3b8'
  ctx.strokeStyle = '#334155'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const tick of timeAxisTicks(0, props.durationSec, 6)) {
    const x = xForTime(canvas, tick.value)
    ctx.beginPath()
    ctx.moveTo(x, cssH - 13)
    ctx.lineTo(x, cssH - 10)
    ctx.stroke()
    ctx.fillText(formatTimeSec(tick.value), x, cssH - 9)
  }
}

function scheduleDraw(): void {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0
    draw()
  })
}

// B7: fetch a single whole-clip overview so the thumbnail covers the full timeline at
// ~minimap-width columns. Fixed view -> fetched once (per file/params/width), unlike the
// interactive tracks. Reuses the primary track's warm analysis via the server cache.
function applyMinimapView(): void {
  const analysis = spec.analysis.value
  const canvas = canvasEl.value
  if (analysis === null || canvas === null) return
  const columns = plotWidth(canvas)
  const plotH = Math.max(1, Math.floor(canvas.clientHeight) - 18)
  spec.setView({
    timeStartSec: 0,
    timeEndSec: analysis.durationSec,
    zoom: viewportZoomTier(
      { startSec: 0, endSec: analysis.durationSec },
      analysis.durationSec,
      analysis.frameCount,
      columns,
    ),
    viewBinCount: Math.max(24, Math.min(128, plotH)),
  })
}

async function openForPath(aFilePath: string | null | undefined): Promise<void> {
  await spec.close()
  if (aFilePath === null || aFilePath === undefined || aFilePath === '') {
    scheduleDraw()
    return
  }
  try {
    await spec.open({ filePath: aFilePath, ...(props.analysis ?? { window: 2048, hop: 512 }) })
    applyMinimapView()
  } catch {
    // surfaced via spec.error; the thumbnail just falls back to the baseline
  }
}

watch(() => props.filePath, (value) => {
  void openForPath(value)
})

// The minimap REUSES the primary track's analysis (same analysisId via the server's
// warm-LRU key), so it must NOT reconfigure it — reconfigure is close+reopen-with-a-new-id
// and the track owns that lifecycle; a second reconfigure of the now-deleted id throws
// "no open analysis to reconfigure". Instead, on a params change (e.g. a preset switch)
// re-OPEN with the new params: findByKey reuses the track's reconfigured analysis. A
// slightly longer debounce than the track (150ms) lets the track reconfigure first so the
// re-open reuses it rather than creating a duplicate.
let reopenTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.analysis, () => {
  if (reopenTimer !== null) clearTimeout(reopenTimer)
  reopenTimer = setTimeout(() => {
    reopenTimer = null
    void openForPath(props.filePath)
  }, 300)
}, { deep: true })

watch([spec.tiles, spec.analysis], () => scheduleDraw())
watch(() => props.render, () => scheduleDraw(), { deep: true })

type DragMode = 'pan' | 'resize-left' | 'resize-right'
let dragMode: DragMode | null = null
let dragStartX = 0
let dragStartView: TimeWindow | null = null
const hoverMode = ref<DragMode | null>(null)

const cursor = computed(() => {
  if (!hasView.value) return 'default'
  const m = dragMode ?? hoverMode.value
  if (m === 'resize-left' || m === 'resize-right') return 'ew-resize'
  return 'grab'
})

function modeAt(canvas: HTMLCanvasElement, x: number): DragMode | 'outside' {
  if (props.view === null) return 'outside'
  const x0 = xForTime(canvas, props.view.startSec)
  const x1 = xForTime(canvas, props.view.endSec)
  if (Math.abs(x - x0) <= EDGE_PX) return 'resize-left'
  if (Math.abs(x - x1) <= EDGE_PX) return 'resize-right'
  if (x > x0 && x < x1) return 'pan'
  return 'outside'
}

function onPointerDown(aEvent: PointerEvent): void {
  const canvas = canvasEl.value
  if (canvas === null || props.view === null || props.durationSec <= 0) return
  const x = aEvent.offsetX
  let mode = modeAt(canvas, x)
  if (mode === 'outside') {
    // Recenter the window on the clicked time, then pan.
    const width = props.view.endSec - props.view.startSec
    const center = timeForX(canvas, x)
    emit('update:view', clampWindow({ startSec: center - width / 2, endSec: center + width / 2 }, props.durationSec))
    mode = 'pan'
  }
  dragMode = mode
  dragStartX = x
  dragStartView = props.view
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}

function onPointerMove(aEvent: PointerEvent): void {
  const canvas = canvasEl.value
  if (canvas === null) return

  if (dragMode === null || dragStartView === null) {
    const m = modeAt(canvas, aEvent.offsetX)
    hoverMode.value = m === 'outside' ? null : m
    return
  }

  const d = props.durationSec
  if (dragMode === 'resize-left') {
    const start = Math.max(0, Math.min(timeForX(canvas, aEvent.offsetX), dragStartView.endSec - MIN_WINDOW_SEC))
    emit('update:view', { startSec: start, endSec: dragStartView.endSec })
  } else if (dragMode === 'resize-right') {
    const end = Math.min(d, Math.max(timeForX(canvas, aEvent.offsetX), dragStartView.startSec + MIN_WINDOW_SEC))
    emit('update:view', { startSec: dragStartView.startSec, endSec: end })
  } else {
    const delta = timeForX(canvas, aEvent.offsetX) - timeForX(canvas, dragStartX)
    const width = dragStartView.endSec - dragStartView.startSec
    emit('update:view', clampWindow({ startSec: dragStartView.startSec + delta, endSec: dragStartView.startSec + delta + width }, d))
  }
}

function onPointerUp(aEvent: PointerEvent): void {
  if (dragMode === null) return
  dragMode = null
  dragStartView = null
  try {
    ;(aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId)
  } catch {
    // pointer capture may already be released
  }
}

watch(() => [props.view, props.durationSec], () => scheduleDraw(), { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => {
      // width change -> re-pick the whole-clip zoom so the thumbnail stays ~1 col/px.
      applyMinimapView()
      scheduleDraw()
    })
    resizeObserver.observe(canvasEl.value)
  }
  void openForPath(props.filePath)
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (reopenTimer !== null) {
    clearTimeout(reopenTimer)
    reopenTimer = null
  }
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  void spec.close()
})
</script>

<style scoped>
.spectrogram-minimap {
  width: 100%;
}

.spectrogram-minimap__canvas {
  background: #0f172a;
  display: block;
  height: 48px;
  touch-action: none;
  width: 100%;
}
</style>
