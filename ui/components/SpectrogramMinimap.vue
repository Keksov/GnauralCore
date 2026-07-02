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

import { formatTimeSec, timeAxisTicks } from '../composables/spectrogram-axes'
import { clampWindow, MIN_WINDOW_SEC, type TimeWindow } from '../composables/spectrogram-viewport'

// SF10.4 (SF-D24): fixed bottom minimap-overview of the whole clip with a
// draggable/resizable visible-window handle (player-style), replacing the q-range.
// Drag the window body to pan, its edges to zoom; click outside to recenter.

interface Props {
  durationSec: number
  view: TimeWindow | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ (event: 'update:view', view: TimeWindow): void }>()

const { t } = useI18n()
const canvasEl = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let renderFrameId = 0

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

  // Overview track baseline.
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(PAD, 4, cssW - PAD * 2, cssH - 18)

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
    resizeObserver = new ResizeObserver(() => scheduleDraw())
    resizeObserver.observe(canvasEl.value)
  }
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
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
