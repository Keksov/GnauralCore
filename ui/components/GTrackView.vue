<template>
  <div class="gtrack-view" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="gtrack-view__canvas"
      role="img"
      :aria-label="t('audio.gtrackCanvasLabel')"
      :class="{ 'gtrack-view__canvas--seekable': seekable || pointMode, 'gtrack-view__canvas--point': pointMode && hoverPoint !== null }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
    <span v-if="label" class="gtrack-view__label-overlay">{{ label }}</span>
    <!-- SF28.4-style chrome: drag grip + hide stacked on the LEFT. -->
    <div class="gtrack-view__side-actions">
      <q-icon
        name="drag_indicator"
        size="18px"
        class="gtrack-view__grip"
        :aria-label="t('audio.trackReorder')"
        @pointerdown.stop.prevent="emit('reorder-grip', $event)"
      >
        <q-tooltip>{{ t('audio.trackReorder') }}</q-tooltip>
      </q-icon>
      <q-btn
        dense flat round size="xs"
        icon="visibility_off"
        :aria-label="t('audio.trackHide')"
        @click.stop="emit('hide')"
      >
        <q-tooltip>{{ t('audio.trackHide') }}</q-tooltip>
      </q-btn>
    </div>
    <!-- GT3.1: point-edit mode toggle + the lane settings gear. -->
    <div class="gtrack-view__actions">
      <q-btn
        dense flat round size="xs"
        icon="edit_location_alt"
        :color="pointMode ? 'primary' : undefined"
        :aria-label="t('audio.gtrackPointMode')"
        :aria-pressed="pointMode"
        @click.stop="emit('toggle-point-mode')"
      >
        <q-tooltip>{{ t('audio.gtrackPointMode') }}</q-tooltip>
      </q-btn>
      <q-btn
        dense flat round size="xs"
        icon="settings"
        :aria-label="t('audio.gtrackSettings')"
        @click.stop="emit('open-settings')"
      >
        <q-tooltip>{{ t('audio.gtrackSettings') }}</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { GTrackVoice } from '../composables/gtrack-model'
import {
  gtrackAxis,
  pointValue,
  valueToUnit,
  type GTrackMode,
} from '../composables/gtrack-render'
import { formatTimeSec, timeAxisTicksWithMinor } from '../composables/spectrogram-axes'
import {
  fractionToTime,
  fullWindow,
  panWindow,
  timeToFraction,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
} from '../composables/spectrogram-viewport'

// GT2.1 — a gtrack lane in the Audio stack (GT-D2). It draws one or more voices' schedule curves
// under a display mode (Base / Beat / Volume / Stereo balance, GT-D6) over the SHARED time window
// (provide/inject) so it zooms/pans frame-aligned with the waveform + spectrogram lanes.
// GT3.1 — a point-edit mode: vertices become interactive (hover + click to select). Dragging /
// add / remove / preparse-fix arrive in the later Phase-3 steps.

/** A vertex reference within this lane. */
export interface GTrackPointRef {
  readonly voiceId: number
  readonly pointIndex: number
}

interface Props {
  voices: readonly GTrackVoice[]
  mode: GTrackMode
  /** Schedule total time — used for the standalone full window + nav bounds. */
  durationSec: number
  label?: string
  height?: number
  playheadSec?: number | null
  seekable?: boolean
  showTimeAxisTop?: boolean
  showTimeAxisBottom?: boolean
  /** GT3.1: when true, vertices are interactive (hover/select) and clicks don't seek. */
  pointMode?: boolean
  /** GT3.1: the currently-selected vertex in THIS lane (null = none). */
  selection?: GTrackPointRef | null
}
const props = withDefaults(defineProps<Props>(), {
  playheadSec: null,
  seekable: false,
  showTimeAxisTop: false,
  showTimeAxisBottom: false,
  pointMode: false,
  selection: null,
})
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  (event: 'open-settings'): void
  (event: 'hide'): void
  (event: 'reorder-grip', ev: PointerEvent): void
  (event: 'toggle-point-mode'): void
  (event: 'select-point', point: GTrackPointRef | null): void
}>()

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
// GT3.1: the vertex under the cursor while in point mode (null = none).
const hoverPoint = ref<GTrackPointRef | null>(null)
const HIT_RADIUS_PX = 8

const AXIS_MARGIN = { left: 46, right: 8 }
const AXIS_TIME_MARGIN = 18
const AXIS_PLAIN_MARGIN = 6
const marginTop = (): number => (props.showTimeAxisTop ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
const marginBottom = (): number => (props.showTimeAxisBottom ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)

// Fallback palette when a voice has no explicit colour.
const FALLBACK_COLORS = ['#67e8f9', '#fbbf24', '#a3be8c', '#f472b6', '#c084fc', '#f87171']
const HEX = /^#[0-9a-fA-F]{6}$/
function colorForVoice(voice: GTrackVoice, index: number): string {
  return voice.color !== null && HEX.test(voice.color)
    ? voice.color
    : FALLBACK_COLORS[index % FALLBACK_COLORS.length]!
}

const hasData = computed(() => props.durationSec > 0 && props.voices.length > 0)
const axis = computed(() => gtrackAxis(props.voices, props.mode))

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

  if (!hasData.value) {
    drawAxes(ctx, plotX, plotY, plotW, plotH)
    return
  }

  const win = view.value
  const ax = axis.value
  const timeToX = (sec: number): number => plotX + timeToFraction(sec, win) * plotW
  const valueToY = (value: number): number => plotY + (1 - valueToUnit(value, ax)) * plotH

  // Shared time-range selection.
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

  // Mid gridline.
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plotX, plotY + plotH / 2)
  ctx.lineTo(plotX + plotW, plotY + plotH / 2)
  ctx.stroke()

  // Voice curves (clipped to the plot area).
  ctx.save()
  ctx.beginPath()
  ctx.rect(plotX, plotY, plotW, plotH)
  ctx.clip()
  props.voices.forEach((voice, vi) => {
    const pts = voice.points
    if (pts.length === 0) return
    const color = colorForVoice(voice, vi)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < pts.length; i += 1) {
      const x = timeToX(pts[i]!.timeSec)
      const y = valueToY(pointValue(pts[i]!, props.mode))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // Vertex dots. In point mode they grow and gain hover/selected highlights (GT3.1).
    const baseR = props.pointMode ? 3.5 : 2
    for (let i = 0; i < pts.length; i += 1) {
      const x = timeToX(pts[i]!.timeSec)
      const y = valueToY(pointValue(pts[i]!, props.mode))
      const isHover = props.pointMode && hoverPoint.value?.voiceId === voice.id && hoverPoint.value?.pointIndex === i
      const isSelected = props.selection?.voiceId === voice.id && props.selection?.pointIndex === i
      ctx.beginPath()
      ctx.arc(x, y, isSelected ? baseR + 2 : isHover ? baseR + 1.5 : baseR, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      if (isSelected || isHover) {
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'
        ctx.lineWidth = isSelected ? 2 : 1
        ctx.stroke()
      }
    }
  })
  ctx.restore()

  // Playhead.
  const playhead = props.playheadSec
  if (playhead !== null && playhead >= win.startSec && playhead <= win.endSec) {
    const px = timeToX(playhead)
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1
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
  const ax = axis.value
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(ax.topLabel, plotX - 5, plotY + 6)
  ctx.fillText(ax.midLabel, plotX - 5, plotY + plotH / 2)
  ctx.fillText(ax.botLabel, plotX - 5, plotY + plotH - 6)

  // Time ruler on the requested edges (same style as the waveform/spectrogram lanes).
  const win = view.value
  ctx.textAlign = 'center'
  const targetMajor = Math.max(4, Math.min(14, Math.round(plotW / 90)))
  const { major, minor, majorStep } = timeAxisTicksWithMinor(win.startSec, win.endSec, targetMajor)
  const tickX = (position: number): number =>
    Math.min(plotX + plotW - 1, Math.max(plotX, plotX + position * plotW))
  const drawRuler = (edgeY: number, dir: number, baseline: CanvasTextBaseline): void => {
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    for (const tick of minor) {
      const x = tickX(tick.position)
      ctx.beginPath()
      ctx.moveTo(x, edgeY)
      ctx.lineTo(x, edgeY + dir * 3)
      ctx.stroke()
    }
    ctx.lineWidth = 1.5
    ctx.textBaseline = baseline
    for (const tick of major) {
      const x = tickX(tick.position)
      ctx.beginPath()
      ctx.moveTo(x, edgeY)
      ctx.lineTo(x, edgeY + dir * 6)
      ctx.stroke()
      ctx.fillText(formatTimeSec(tick.value, majorStep), x, edgeY + dir * 7)
    }
  }
  if (props.showTimeAxisBottom) drawRuler(plotY + plotH, 1, 'top')
  if (props.showTimeAxisTop) drawRuler(plotY, -1, 'bottom')
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
  if (!hasData.value) return
  const f = xFraction(aEvent)
  const anchor = f ?? 0.5
  const zoomIn = aEvent.deltaY < 0
  if (aEvent.shiftKey) {
    const width = view.value.endSec - view.value.startSec
    view.value = panWindow(view.value, (zoomIn ? -1 : 1) * 0.15 * width, props.durationSec)
  } else {
    view.value = zoomWindow(view.value, zoomIn ? 0.8 : 1.25, anchor, props.durationSec)
  }
}

// GT3.1: find the vertex nearest to a canvas pixel (within HIT_RADIUS_PX), across all voices.
// Uses the same geometry as draw() so hit-testing matches what's rendered.
function pointAtPixel(offsetX: number, offsetY: number): GTrackPointRef | null {
  const canvas = canvasEl.value
  if (canvas === null || !hasData.value) return null
  const cssW = Math.max(1, Math.floor(canvas.clientWidth))
  const cssH = Math.max(1, Math.floor(canvas.clientHeight))
  const plotX = AXIS_MARGIN.left
  const plotY = marginTop()
  const plotW = Math.max(1, cssW - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssH - marginTop() - marginBottom())
  const win = view.value
  const ax = axis.value
  let best: GTrackPointRef | null = null
  let bestDist = HIT_RADIUS_PX
  for (const voice of props.voices) {
    for (let i = 0; i < voice.points.length; i += 1) {
      const p = voice.points[i]!
      const x = plotX + timeToFraction(p.timeSec, win) * plotW
      const y = plotY + (1 - valueToUnit(pointValue(p, props.mode), ax)) * plotH
      const dist = Math.hypot(x - offsetX, y - offsetY)
      if (dist <= bestDist) {
        bestDist = dist
        best = { voiceId: voice.id, pointIndex: i }
      }
    }
  }
  return best
}

function onPointerMove(aEvent: PointerEvent): void {
  if (!props.pointMode) {
    if (hoverPoint.value !== null) { hoverPoint.value = null; scheduleDraw() }
    return
  }
  const next = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
  const prev = hoverPoint.value
  if (next?.voiceId !== prev?.voiceId || next?.pointIndex !== prev?.pointIndex) {
    hoverPoint.value = next
    scheduleDraw()
  }
}

function onPointerLeave(): void {
  if (hoverPoint.value !== null) { hoverPoint.value = null; scheduleDraw() }
}

function onClick(aEvent: MouseEvent): void {
  // GT3.1: in point mode a click selects/deselects a vertex instead of seeking.
  if (props.pointMode) {
    if (!hasData.value) return
    emit('select-point', pointAtPixel(aEvent.offsetX, aEvent.offsetY))
    return
  }
  if (props.seekable !== true || !hasData.value) return
  const f = xFraction(aEvent)
  if (f === null) return
  emit('seek', Math.max(0, Math.min(props.durationSec, fractionToTime(f, view.value))))
}

// Audacity-style keyboard nav (parity with the waveform lane), exposed for AudioPage delegation.
const SEEK_STEP_SEC = 1
const SEEK_STEP_SEC_LARGE = 5
function followPlayhead(aSec: number): void {
  const win = view.value
  const margin = (win.endSec - win.startSec) * 0.1
  if (aSec < win.startSec) view.value = panWindow(win, aSec - margin - win.startSec, props.durationSec)
  else if (aSec > win.endSec) view.value = panWindow(win, aSec + margin - win.endSec, props.durationSec)
}
function seekBy(aDeltaSec: number): void {
  const from = props.playheadSec ?? view.value.startSec
  const next = Math.max(0, Math.min(props.durationSec, from + aDeltaSec))
  emit('seek', next)
  followPlayhead(next)
}
function handleNavKey(aEvent: KeyboardEvent): void {
  if (!hasData.value) return
  const span = view.value.endSec - view.value.startSec
  const dur = props.durationSec
  switch (aEvent.key) {
    case 'Home':
      view.value = panWindow(view.value, -dur - span, dur)
      break
    case 'End':
      view.value = panWindow(view.value, dur + span, dur)
      break
    case 'ArrowLeft':
      if (aEvent.altKey) view.value = panWindow(view.value, -0.15 * span, dur)
      else seekBy(-(aEvent.shiftKey ? SEEK_STEP_SEC_LARGE : SEEK_STEP_SEC))
      break
    case 'ArrowRight':
      if (aEvent.altKey) view.value = panWindow(view.value, 0.15 * span, dur)
      else seekBy(aEvent.shiftKey ? SEEK_STEP_SEC_LARGE : SEEK_STEP_SEC)
      break
    default:
      return
  }
  aEvent.preventDefault()
}
defineExpose({ handleNavKey })

watch(() => props.durationSec, (dur) => {
  if (dur > 0 && (shared === null || shared.view.value === null)) view.value = fullWindow(dur)
  scheduleDraw()
})
watch(view, () => scheduleDraw(), { deep: true })
watch(() => shared?.selection.value, () => scheduleDraw(), { deep: true })
watch(() => props.mode, () => scheduleDraw())
watch(() => props.voices, () => scheduleDraw(), { deep: true })
watch(() => props.playheadSec, () => scheduleDraw())
watch(() => props.selection, () => scheduleDraw())
watch(() => props.pointMode, (on) => {
  if (!on) hoverPoint.value = null
  scheduleDraw()
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => scheduleDraw())
    resizeObserver.observe(canvasEl.value)
  }
  if (props.durationSec > 0 && (shared === null || shared.view.value === null)) {
    view.value = fullWindow(props.durationSec)
  }
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  resizeObserver?.disconnect()
})
</script>

<style scoped>
.gtrack-view {
  background: #0f172a;
  display: flex;
  flex-direction: column;
  min-height: 60px;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.gtrack-view__canvas {
  display: block;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.gtrack-view__canvas--seekable {
  cursor: pointer;
}

/* GT3.1: over a vertex in point mode. */
.gtrack-view__canvas--point {
  cursor: cell;
}

.gtrack-view__label-overlay {
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

.gtrack-view__actions {
  display: flex;
  gap: 2px;
  position: absolute;
  right: 4px;
  top: 2px;
  z-index: 5;
}

.gtrack-view__side-actions {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
  left: 2px;
  position: absolute;
  top: 2px;
  z-index: 5;
}

.gtrack-view__actions .q-btn,
.gtrack-view__side-actions .q-btn {
  color: #cbd5e1;
  opacity: 0.6;
}

.gtrack-view__actions .q-btn:hover,
.gtrack-view__side-actions .q-btn:hover {
  opacity: 1;
}

.gtrack-view__grip {
  color: #cbd5e1;
  cursor: grab;
  opacity: 0.6;
}

.gtrack-view__grip:hover {
  opacity: 1;
}

.gtrack-view__grip:active {
  cursor: grabbing;
}
</style>
