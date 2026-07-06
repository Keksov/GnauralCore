<template>
  <div class="waveform-view" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="waveform-view__canvas"
      role="img"
      :aria-label="t('audio.waveformCanvasLabel')"
      :class="{ 'waveform-view__canvas--seekable': seekable }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
    <span v-if="label" class="waveform-view__label-overlay">{{ label }}</span>
    <div
      v-if="hover !== null && hoverPos !== null"
      class="waveform-view__tooltip"
      :style="{ left: `${hoverPos.x}px`, top: `${hoverPos.y}px` }"
      role="status"
    >
      {{ hoverText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAudioModel } from '../composables/use-audio-model'
import { amplitudeToDb } from '../composables/audio-model'
import { peaksToColumns, WAVEFORM_DB_FLOOR, type WaveformScale } from '../composables/waveform-render'
import {
  formatTimeSec,
  timeAxisTicksWithMinor,
} from '../composables/spectrogram-axes'
import {
  fractionToTime,
  fullWindow,
  panWindow,
  timeToFraction,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
} from '../composables/spectrogram-viewport'

// SF22.2: an Audacity-style waveform track. Client-only — it reads the decoded AudioBuffer via
// the audio model and reuses the SHARED time window / selection (provide/inject) so it stays
// frame-aligned with the spectrogram tracks. No worker.

interface Props {
  buffer: AudioBuffer | null
  /** Channel to draw (0 = L / mono, 1 = R). */
  channel?: number
  /** Amplitude scale: linear (-1..1) or dBFS. */
  scale?: WaveformScale
  /** SF23.2: waveform colour. */
  color?: string
  label?: string
  height?: number
  playheadSec?: number | null
  seekable?: boolean
  showTimeAxisTop?: boolean
  showTimeAxisBottom?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  channel: 0,
  scale: 'linear',
  color: '#67e8f9',
  playheadSec: null,
  seekable: false,
  showTimeAxisTop: false,
  showTimeAxisBottom: false,
})
const emit = defineEmits<{ (event: 'seek', sec: number): void }>()

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const model = useAudioModel(toRef(props, 'buffer'))

const AXIS_MARGIN = { left: 46, right: 8 }
const AXIS_TIME_MARGIN = 18
const AXIS_PLAIN_MARGIN = 6
const marginTop = (): number => (props.showTimeAxisTop ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
const marginBottom = (): number => (props.showTimeAxisBottom ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)

const durationSec = computed(() => model.info.value?.durationSec ?? 0)
const hasAudio = computed(() => durationSec.value > 0)

const internalView = ref<TimeWindow>({ startSec: 0, endSec: 0 })
const view = computed<TimeWindow>({
  get: () => shared?.view.value ?? internalView.value,
  set: (v) => {
    if (shared) shared.view.value = v
    else internalView.value = v
  },
})

const rootStyle = computed(() =>
  props.height !== undefined ? { height: `${props.height}px`, flex: '0 0 auto' } : {},
)

let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null

function plotWidthPx(canvas: HTMLCanvasElement): number {
  return Math.max(1, Math.floor(canvas.clientWidth) - AXIS_MARGIN.left - AXIS_MARGIN.right)
}

// Peak columns are memoized: they only depend on the view/size/scale/channel/buffer, so a
// playhead-only redraw (e.g. during playback) reuses them instead of re-scanning the PCM.
let cacheSig = ''
let cacheColumns = peaksToColumns([], 'linear')

function ensureColumns(plotW: number): void {
  const info = model.info.value
  if (info === null) {
    cacheSig = 'none'
    cacheColumns = []
    return
  }
  const win = view.value
  const sig = `${win.startSec}|${win.endSec}|${plotW}|${props.scale}|${props.channel}|${info.length}`
  if (sig === cacheSig) return
  const peaks = model.peaks(win.startSec, win.endSec, plotW, props.channel)
  cacheColumns = peaksToColumns(peaks, props.scale)
  cacheSig = sig
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

  const plotX = AXIS_MARGIN.left
  const plotY = marginTop()
  const plotW = Math.max(1, cssW - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssH - marginTop() - marginBottom())
  const centerY = plotY + plotH / 2
  const halfH = plotH / 2

  if (!hasAudio.value) {
    drawAxes(ctx, plotX, plotY, plotW, plotH)
    return
  }

  ensureColumns(plotW)
  const win = view.value

  // Shared time-range selection (draw the overlap with the current window).
  const sel = shared?.selection.value ?? null
  if (sel !== null) {
    const a = timeToFraction(Math.min(sel.timeStartSec, sel.timeEndSec), win)
    const b = timeToFraction(Math.max(sel.timeStartSec, sel.timeEndSec), win)
    const x0 = plotX + Math.max(0, Math.min(1, a)) * plotW
    const x1 = plotX + Math.max(0, Math.min(1, b)) * plotW
    if (x1 > x0) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'
      ctx.fillRect(x0, plotY, x1 - x0, plotH)
    }
  }

  // zero line
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plotX, centerY)
  ctx.lineTo(plotX + plotW, centerY)
  ctx.stroke()

  // RMS band (lighter) then the min/max envelope (brighter), one column per pixel.
  const n = cacheColumns.length
  if (n > 0) {
    ctx.fillStyle = props.color
    ctx.globalAlpha = 0.35
    for (let i = 0; i < n; i++) {
      const col = cacheColumns[i]!
      const x = plotX + (i / n) * plotW
      const top = centerY - col.rmsU * halfH
      const bottom = centerY + col.rmsU * halfH
      ctx.fillRect(x, top, Math.max(1, plotW / n), Math.max(1, bottom - top))
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = props.color
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const col = cacheColumns[i]!
      const x = plotX + (i / n) * plotW + 0.5
      ctx.moveTo(x, centerY - col.maxU * halfH)
      ctx.lineTo(x, centerY - col.minU * halfH)
    }
    ctx.stroke()
  }

  // playhead
  const playhead = props.playheadSec
  if (playhead !== null && playhead >= win.startSec && playhead <= win.endSec) {
    const px = plotX + timeToFraction(playhead, win) * plotW
    ctx.strokeStyle = '#f59e0b'
    ctx.beginPath()
    ctx.moveTo(px, plotY)
    ctx.lineTo(px, plotY + plotH)
    ctx.stroke()
  }

  drawAxes(ctx, plotX, plotY, plotW, plotH)
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
): void {
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  // amplitude labels: top / centre / bottom depend on the scale.
  const topLabel = props.scale === 'db' ? '0 dB' : '+1'
  const midLabel = props.scale === 'db' ? `${WAVEFORM_DB_FLOOR} dB` : '0'
  const botLabel = props.scale === 'db' ? '0 dB' : '−1'
  ctx.fillText(topLabel, plotX - 5, plotY + 6)
  ctx.fillText(midLabel, plotX - 5, plotY + plotH / 2)
  ctx.fillText(botLabel, plotX - 5, plotY + plotH - 6)

  // time ruler (SF16.6 style) on the requested edges.
  const win = view.value
  ctx.textAlign = 'center'
  const targetMajor = Math.max(4, Math.min(14, Math.round(plotW / 90)))
  const { major, majorStep } = timeAxisTicksWithMinor(win.startSec, win.endSec, targetMajor)
  const tickX = (position: number): number =>
    Math.min(plotX + plotW - 1, Math.max(plotX, plotX + position * plotW))
  if (props.showTimeAxisBottom) {
    ctx.textBaseline = 'top'
    for (const tick of major) {
      const x = tickX(tick.position)
      ctx.beginPath()
      ctx.moveTo(x, plotY + plotH)
      ctx.lineTo(x, plotY + plotH + 4)
      ctx.stroke()
      ctx.fillText(formatTimeSec(tick.value, majorStep), x, plotY + plotH + 5)
    }
  }
  if (props.showTimeAxisTop) {
    ctx.textBaseline = 'bottom'
    for (const tick of major) {
      const x = tickX(tick.position)
      ctx.beginPath()
      ctx.moveTo(x, plotY)
      ctx.lineTo(x, plotY - 4)
      ctx.stroke()
      ctx.fillText(formatTimeSec(tick.value, majorStep), x, plotY - 5)
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

function xFraction(aEvent: { offsetX: number }): number | null {
  const canvas = canvasEl.value
  if (canvas === null) return null
  const plotW = plotWidthPx(canvas)
  const f = (aEvent.offsetX - AXIS_MARGIN.left) / plotW
  return f < 0 || f > 1 ? null : f
}

function onWheel(aEvent: WheelEvent): void {
  if (!hasAudio.value) return
  const f = xFraction(aEvent)
  const anchor = f ?? 0.5
  const zoomIn = aEvent.deltaY < 0
  if (aEvent.shiftKey) {
    const width = view.value.endSec - view.value.startSec
    view.value = panWindow(view.value, (zoomIn ? -1 : 1) * 0.15 * width, durationSec.value)
  } else {
    view.value = zoomWindow(view.value, zoomIn ? 0.8 : 1.25, anchor, durationSec.value)
  }
}

function onClick(aEvent: MouseEvent): void {
  if (props.seekable !== true || !hasAudio.value) return
  const f = xFraction(aEvent)
  if (f === null) return
  emit('seek', Math.max(0, Math.min(durationSec.value, fractionToTime(f, view.value))))
}

const hover = ref<{ timeSec: number; amp: number } | null>(null)
const hoverPos = ref<{ x: number; y: number } | null>(null)
const hoverText = computed(() => {
  const h = hover.value
  if (h === null) return ''
  const db = amplitudeToDb(h.amp)
  // SF22.4: query surface at the cursor — time, sample index, amplitude, dBFS.
  const sr = model.info.value?.sampleRate ?? 0
  const sampleIdx = Math.round(h.timeSec * sr)
  return `${formatTimeSec(h.timeSec)} · #${sampleIdx} · ${h.amp.toFixed(3)} · ${db.toFixed(1)} dB`
})

function onPointerMove(aEvent: PointerEvent): void {
  if (!hasAudio.value) {
    hover.value = null
    return
  }
  const f = xFraction(aEvent)
  if (f === null) {
    hover.value = null
    hoverPos.value = null
    return
  }
  const timeSec = fractionToTime(f, view.value)
  hover.value = { timeSec, amp: model.sampleAt(timeSec, props.channel) }
  hoverPos.value = { x: aEvent.offsetX + 12, y: aEvent.offsetY + 12 }
}

function onPointerLeave(): void {
  hover.value = null
  hoverPos.value = null
}

// Initialise the shared view to the whole clip when a buffer arrives and nothing is set yet.
watch(durationSec, (dur) => {
  if (dur > 0 && (shared === null || shared.view.value === null)) {
    view.value = fullWindow(dur)
  }
  scheduleDraw()
})
watch(view, () => scheduleDraw(), { deep: true })
watch(() => shared?.selection.value, () => scheduleDraw(), { deep: true })
watch(() => props.scale, () => scheduleDraw())
watch(() => props.color, () => scheduleDraw())
watch(() => props.channel, () => scheduleDraw())
watch(() => props.playheadSec, () => scheduleDraw())
watch(() => props.buffer, () => scheduleDraw())

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => scheduleDraw())
    resizeObserver.observe(canvasEl.value)
  }
  if (durationSec.value > 0 && (shared === null || shared.view.value === null)) {
    view.value = fullWindow(durationSec.value)
  }
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  resizeObserver?.disconnect()
})
</script>

<style scoped>
.waveform-view {
  background: #0f172a;
  display: flex;
  flex-direction: column;
  min-height: 60px;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.waveform-view__canvas {
  display: block;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.waveform-view__canvas--seekable {
  cursor: pointer;
}

.waveform-view__label-overlay {
  color: #cbd5e1;
  font-size: 11px;
  left: 6px;
  pointer-events: none;
  position: absolute;
  top: 4px;
}

.waveform-view__tooltip {
  background: rgba(15, 23, 42, 0.92);
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 11px;
  padding: 3px 6px;
  pointer-events: none;
  position: absolute;
  white-space: nowrap;
  z-index: 6;
}
</style>
