<template>
  <div class="gtrack-view" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="gtrack-view__canvas"
      role="img"
      :aria-label="t('audio.gtrackCanvasLabel')"
      :class="{
        'gtrack-view__canvas--seekable': seekable || pointMode,
        'gtrack-view__canvas--point': pointMode && pointTool === 'select' && hoverPoint !== null,
        'gtrack-view__canvas--add': pointMode && pointTool === 'add',
        'gtrack-view__canvas--delete': pointMode && pointTool === 'delete',
      }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @dblclick="onDblClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    />
    <!-- GT3.18 (GT-D20): per-voice accent stripe on the left edge to group a voice's lanes. -->
    <span v-if="accentColor" class="gtrack-view__accent" :style="{ background: accentColor }" />
    <span
      v-if="label"
      class="gtrack-view__label-overlay"
      :style="accentColor ? { color: accentColor } : undefined"
    >{{ label }}</span>
    <!-- GT3.7 (owner req. 10): mark a lane that contains a generated (preparse) voice. -->
    <span v-if="hasPreparse" class="gtrack-view__badge">{{ t('audio.gtrackGenerated') }}</span>
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
    <!-- GT3.13: hover-a-vertex tooltip (time + parameters). Hidden while actively dragging.
         GT3.17 (owner req. 33): teleported to <body> + position:fixed so it renders above every
         lane/panel and is never clipped by a lane's overflow:hidden; clamped to the viewport. -->
    <Teleport to="body">
      <div
        v-if="hoverTooltip !== null && hoverPos !== null"
        ref="tooltipEl"
        class="gtrack-view__tooltip"
        :style="tooltipStyle"
        role="status"
      >
        <div class="gtrack-view__tooltip-name">{{ hoverTooltip.name }}</div>
        <!-- GT3.19: two-column grid — parameter names | values, both left-aligned. -->
        <div class="gtrack-view__tooltip-grid">
          <template v-for="row in hoverTooltip.rows" :key="row.label">
            <span class="gtrack-view__tooltip-label">{{ row.label }}</span>
            <span class="gtrack-view__tooltip-value">{{ row.value }}</span>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { pointBalance, pointBeatFreq, pointVolume, type GTrackVoice } from '../composables/gtrack-model'
import {
  gtrackAxis,
  pointValue,
  unitToValue,
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
  /** GT3.14: the active point-mode cursor tool (Select/Add/Delete), shared across all lanes. */
  pointTool?: 'select' | 'add' | 'delete'
  /** GT3.15: Ctrl/Shift-accumulated multi-selection, keyed "voiceId:pointIndex" (shared, spans lanes). */
  multiSelected?: ReadonlySet<string> | null
  /** GT3.18 (GT-D20): per-voice accent colour for single-voice lanes — a left stripe + tinted title
   *  visually group a voice's lanes. null = no accent (multi-voice lane). */
  accentColor?: string | null
}
const props = withDefaults(defineProps<Props>(), {
  playheadSec: null,
  seekable: false,
  showTimeAxisTop: false,
  showTimeAxisBottom: false,
  pointMode: false,
  selection: null,
  pointTool: 'select',
  multiSelected: null,
  accentColor: null,
})
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  (event: 'open-settings'): void
  (event: 'hide'): void
  (event: 'reorder-grip', ev: PointerEvent): void
  (event: 'toggle-point-mode'): void
  (event: 'select-point', point: GTrackPointRef | null): void
  (event: 'drag-start', point: GTrackPointRef): void
  (event: 'drag-move', payload: { point: GTrackPointRef; timeSec: number; value: number }): void
  (event: 'drag-end'): void
  /** GT3.3: double-click on a vertex — open the point parameters dialog. */
  (event: 'edit-point', point: GTrackPointRef): void
  /** GT3.14: a click with the Delete tool active hit this vertex. */
  (event: 'delete-point-at', point: GTrackPointRef): void
  /** GT3.6: double-click on a curve — add an interpolated point there. */
  (event: 'add-point', payload: { voiceId: number; timeSec: number }): void
  /** GT3.15: Ctrl/Shift+click on a vertex — toggle it in the multi-selection. */
  (event: 'toggle-multi-select', point: GTrackPointRef): void
}>()

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
// GT3.1: the vertex under the cursor (null = none). GT3.17: tracked regardless of point mode.
const hoverPoint = ref<GTrackPointRef | null>(null)
// GT3.13/3.17: cursor VIEWPORT position (clientX/Y) for the hover tooltip; null while not hovering /
// while dragging. Viewport coords because the tooltip is teleported to <body> + position:fixed.
const hoverPos = ref<{ x: number; y: number } | null>(null)
const tooltipEl = ref<HTMLElement | null>(null)
const tooltipStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })
const HIT_RADIUS_PX = 8

// GT3.17 (owner req. 33): keep the teleported tooltip fully on-screen — offset from the cursor,
// flipping to the other side when it would overflow the right/bottom edge.
function positionTooltip(): void {
  const anchor = hoverPos.value
  if (anchor === null) return
  const guessLeft = anchor.x + 14
  const guessTop = anchor.y + 14
  tooltipStyle.value = { left: `${guessLeft}px`, top: `${guessTop}px` }
  void nextTick(() => {
    const el = tooltipEl.value
    if (el === null || hoverPos.value === null) return
    const pad = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = hoverPos.value.x + 14
    let top = hoverPos.value.y + 14
    if (left + w + pad > window.innerWidth) left = hoverPos.value.x - w - 14
    if (top + h + pad > window.innerHeight) top = hoverPos.value.y - h - 14
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad))
    tooltipStyle.value = { left: `${left}px`, top: `${top}px` }
  })
}

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
// GT3.7: true when any voice in this lane is a locked generator (preparse) voice.
const hasPreparse = computed(() => props.voices.some((v) => v.preparse))
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
    // GT2.8: Volume lanes draw classic-editor style FILLED envelopes under each voice's curve.
    if (props.mode === 'volume') {
      ctx.beginPath()
      const y0 = valueToY(0)
      ctx.moveTo(timeToX(pts[0]!.timeSec), y0)
      for (let i = 0; i < pts.length; i += 1) {
        ctx.lineTo(timeToX(pts[i]!.timeSec), valueToY(pointValue(pts[i]!, props.mode)))
      }
      ctx.lineTo(timeToX(pts[pts.length - 1]!.timeSec), y0)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.globalAlpha = 0.22
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    // GT3.7 (GT-D9): a generated (preparse) voice draws dashed — it's locked until "fixed".
    if (voice.preparse) ctx.setLineDash([4, 3])
    ctx.beginPath()
    for (let i = 0; i < pts.length; i += 1) {
      const x = timeToX(pts[i]!.timeSec)
      const y = valueToY(pointValue(pts[i]!, props.mode))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    // Vertex dots. In point mode they grow and gain hover/selected highlights (GT3.1).
    const baseR = props.pointMode ? 3.5 : 2
    for (let i = 0; i < pts.length; i += 1) {
      const x = timeToX(pts[i]!.timeSec)
      const y = valueToY(pointValue(pts[i]!, props.mode))
      // GT3.17: hover ring shows regardless of point mode (anchors the always-on tooltip).
      const isHover = hoverPoint.value?.voiceId === voice.id && hoverPoint.value?.pointIndex === i
      const isSelected = props.selection?.voiceId === voice.id && props.selection?.pointIndex === i
      // GT3.15: multi-selected vertices get their own amber ring, distinct from the single/hover ring.
      const isMulti = props.multiSelected?.has(`${voice.id}:${i}`) ?? false
      ctx.beginPath()
      ctx.arc(x, y, isSelected || isMulti ? baseR + 2 : isHover ? baseR + 1.5 : baseR, 0, Math.PI * 2)
      // GT3.7: generated/locked points are hollow (background fill + coloured ring); regular points
      // are solid. Hover/selection/multi rings still draw on top for both.
      if (voice.preparse) {
        ctx.fillStyle = '#0f172a'
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.fill()
      }
      if (isMulti) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (isSelected || isHover) {
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

// Shared plot geometry (same as draw()), for hit-testing + cursor→value mapping.
function plotRect(): { plotX: number; plotY: number; plotW: number; plotH: number } | null {
  const canvas = canvasEl.value
  if (canvas === null) return null
  const cssW = Math.max(1, Math.floor(canvas.clientWidth))
  const cssH = Math.max(1, Math.floor(canvas.clientHeight))
  return {
    plotX: AXIS_MARGIN.left,
    plotY: marginTop(),
    plotW: Math.max(1, cssW - AXIS_MARGIN.left - AXIS_MARGIN.right),
    plotH: Math.max(1, cssH - marginTop() - marginBottom()),
  }
}

// GT3.1: find the vertex nearest to a canvas pixel (within HIT_RADIUS_PX), across all voices.
function pointAtPixel(offsetX: number, offsetY: number): GTrackPointRef | null {
  const rect = plotRect()
  if (rect === null || !hasData.value) return null
  const { plotX, plotY, plotW, plotH } = rect
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

// GT3.2: map a cursor pixel to (time, mode-value), clamped to the plot + axis range.
function cursorToTimeValue(offsetX: number, offsetY: number): { timeSec: number; value: number } | null {
  const rect = plotRect()
  if (rect === null) return null
  const { plotX, plotY, plotW, plotH } = rect
  const fx = Math.max(0, Math.min(1, (offsetX - plotX) / plotW))
  const uy = Math.max(0, Math.min(1, 1 - (offsetY - plotY) / plotH))
  // GT2.8: inverse-map through the axis (handles the log frequency scale).
  return { timeSec: fractionToTime(fx, view.value), value: unitToValue(uy, axis.value) }
}

// GT3.2: drag state. A drag runs from pointerdown-on-a-vertex to pointerup as one undo unit.
let dragRef: GTrackPointRef | null = null

function onPointerDown(aEvent: PointerEvent): void {
  if (!props.pointMode || !hasData.value || aEvent.button !== 0) return

  // GT3.14 (owner req. 24): the Add/Delete tools act on a single click and skip select+drag.
  if (props.pointTool === 'add') {
    const curve = voiceCurveAtPixel(aEvent.offsetX, aEvent.offsetY)
    if (curve !== null) emit('add-point', curve)
    return
  }
  if (props.pointTool === 'delete') {
    const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
    if (hit !== null) emit('delete-point-at', hit)
    return
  }

  const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)

  // GT3.15 (owner req. 30): Ctrl/Shift+click on a vertex accumulates the multi-selection instead
  // of selecting/dragging (a modifier-click on empty space is a no-op — nothing to add).
  if ((aEvent.ctrlKey || aEvent.metaKey || aEvent.shiftKey) && hit !== null) {
    emit('toggle-multi-select', hit)
    return
  }

  emit('select-point', hit) // select the vertex (or deselect on empty space)
  if (hit === null) return
  dragRef = hit
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
  emit('drag-start', hit)
}

function onPointerMove(aEvent: PointerEvent): void {
  if (dragRef !== null) {
    const tv = cursorToTimeValue(aEvent.offsetX, aEvent.offsetY)
    if (tv !== null) emit('drag-move', { point: dragRef, timeSec: tv.timeSec, value: tv.value })
    hoverPos.value = null // GT3.13: no hover tooltip while actively dragging
    return
  }
  // GT3.17 (owner req. 34): hover hit-test + tooltip run REGARDLESS of point mode (hit-test on the
  // canvas doesn't block seeking; clicks are handled separately).
  const next = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
  const prev = hoverPoint.value
  if (next?.voiceId !== prev?.voiceId || next?.pointIndex !== prev?.pointIndex) {
    hoverPoint.value = next
    scheduleDraw()
  }
  if (next !== null) {
    hoverPos.value = { x: aEvent.clientX, y: aEvent.clientY }
    positionTooltip()
  } else {
    hoverPos.value = null
  }
}

function onPointerUp(aEvent: PointerEvent): void {
  if (dragRef === null) return
  dragRef = null
  try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
  emit('drag-end')
}

function onPointerLeave(): void {
  if (hoverPoint.value !== null) { hoverPoint.value = null; scheduleDraw() }
  hoverPos.value = null
}

// GT3.13 (owner req. 25): tooltip data for the hovered vertex — voice name, time, base/beat freq,
// L/R volumes, and derived Volume/Balance (GT-D6). GT3.19 (owner req. 39): a name header + rows of
// {label, value} rendered as a two-column grid (labels | values, both left-aligned).
interface TooltipRow { readonly label: string; readonly value: string }
const hoverTooltip = computed<{ name: string; rows: TooltipRow[] } | null>(() => {
  const hp = hoverPoint.value
  if (hp === null) return null
  const voice = props.voices.find((v) => v.id === hp.voiceId)
  const p = voice?.points[hp.pointIndex]
  if (voice === undefined || p === undefined) return null
  const name = voice.description.trim() !== '' ? voice.description : `#${voice.id}`
  const rows: TooltipRow[] = [
    { label: t('audio.gtrackPointTime'), value: formatTimeSec(p.timeSec) },
    { label: t('audio.gtrackPointBase'), value: `${p.baseFreq.toFixed(1)} Hz` },
    { label: t('audio.gtrackPointBeat'), value: `${pointBeatFreq(p).toFixed(1)} Hz` },
    { label: 'L/R', value: `${p.volL.toFixed(3)} / ${p.volR.toFixed(3)}` },
    { label: t('audio.gtrackMode_volume'), value: pointVolume(p).toFixed(2) },
  ]
  if (!voice.mono) rows.push({ label: t('audio.gtrackMode_balance'), value: pointBalance(p).toFixed(2) })
  return { name, rows }
})

function onClick(aEvent: MouseEvent): void {
  // GT3.1/3.2: in point mode, selection + drag are handled on pointerdown/up, so clicks are inert.
  if (props.pointMode) return
  if (props.seekable !== true || !hasData.value) return
  const f = xFraction(aEvent)
  if (f === null) return
  emit('seek', Math.max(0, Math.min(props.durationSec, fractionToTime(f, view.value))))
}

// GT3.6: the voice whose curve is nearest to a canvas pixel (linear interpolation of the mode
// value between surrounding points), within a vertical threshold. Approximate for balance/volume
// (lerp of derived values) — fine for hit-testing.
const CURVE_HIT_PX = 14
function voiceCurveAtPixel(offsetX: number, offsetY: number): { voiceId: number; timeSec: number } | null {
  const rect = plotRect()
  if (rect === null || !hasData.value) return null
  const { plotX, plotY, plotW, plotH } = rect
  const fx = (offsetX - plotX) / plotW
  if (fx < 0 || fx > 1) return null
  const timeSec = fractionToTime(fx, view.value)
  const ax = axis.value
  let best: number | null = null
  let bestDist = CURVE_HIT_PX
  for (const voice of props.voices) {
    const pts = voice.points
    if (pts.length < 2) continue
    if (timeSec <= pts[0]!.timeSec || timeSec >= pts[pts.length - 1]!.timeSec) continue
    let seg = -1
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (timeSec >= pts[i]!.timeSec && timeSec <= pts[i + 1]!.timeSec) { seg = i; break }
    }
    if (seg < 0) continue
    const a = pts[seg]!
    const b = pts[seg + 1]!
    const span = b.timeSec - a.timeSec
    const f = span > 0 ? (timeSec - a.timeSec) / span : 0
    const v = pointValue(a, props.mode) + f * (pointValue(b, props.mode) - pointValue(a, props.mode))
    const y = plotY + (1 - valueToUnit(v, ax)) * plotH
    const dist = Math.abs(y - offsetY)
    if (dist <= bestDist) {
      bestDist = dist
      best = voice.id
    }
  }
  return best === null ? null : { voiceId: best, timeSec }
}

function onDblClick(aEvent: MouseEvent): void {
  // GT3.14: while the Add/Delete tool is active, onPointerDown already handled both clicks of the
  // double-click (each is one add/delete) — skip this handler to avoid a redundant third action.
  if (!props.pointMode || !hasData.value || props.pointTool !== 'select') return
  // On a vertex -> edit its parameters; on a curve -> add an interpolated point there.
  const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
  if (hit !== null) {
    emit('edit-point', hit)
    return
  }
  const curve = voiceCurveAtPixel(aEvent.offsetX, aEvent.offsetY)
  if (curve !== null) emit('add-point', curve)
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
watch(() => props.selection, (sel) => {
  // GT3.10 crossover: while dragging, the composable re-homes the point (new index) and updates
  // the selection — keep the local drag reference following the same point.
  if (dragRef !== null && sel !== null && sel.voiceId === dragRef.voiceId) {
    dragRef = { voiceId: sel.voiceId, pointIndex: sel.pointIndex }
  }
  scheduleDraw()
})
watch(() => props.pointMode, () => {
  // GT3.17: hover/tooltip are mode-independent now — just redraw (vertex dot size depends on mode).
  scheduleDraw()
})
watch(() => props.multiSelected, () => scheduleDraw())

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

/* GT3.1 / GT3.20 (owner req. 40): over an editable vertex in select mode, HIDE the OS cursor so it
   never covers the node — the enlarged, white-ringed hover/selection marker is the pointer itself.
   Stays hidden through a drag (hoverPoint persists), so the node is fully visible as it moves. */
.gtrack-view__canvas--point {
  cursor: none;
}

/* GT3.14: Add/Delete point-mode tools. */
.gtrack-view__canvas--add {
  cursor: copy;
}

.gtrack-view__canvas--delete {
  cursor: no-drop;
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

/* GT3.18 (GT-D20): per-voice accent stripe down the left edge (groups a voice's lanes). */
.gtrack-view__accent {
  bottom: 0;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: 3px;
  z-index: 6;
}

/* GT3.7: "generated" badge for a lane containing a preparse (locked) voice. */
.gtrack-view__badge {
  background: rgba(251, 191, 36, 0.18);
  border: 1px solid rgba(251, 191, 36, 0.5);
  border-radius: 3px;
  color: #fbbf24;
  font-size: 10px;
  font-weight: 700;
  left: 50px;
  letter-spacing: 0.02em;
  padding: 0 4px;
  pointer-events: none;
  position: absolute;
  top: 22px;
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

/* GT3.13: hover-a-vertex tooltip (multi-line — voice, time, frequencies, volumes).
   GT3.17: teleported to <body>, position:fixed in viewport coords, above every lane/panel. */
.gtrack-view__tooltip {
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  color: #e2e8f0;
  font-size: 11px;
  max-width: 260px;
  padding: 4px 7px;
  pointer-events: none;
  position: fixed;
  z-index: 7000;
}

/* GT3.19: two-column tooltip (labels | values, both left-aligned). */
.gtrack-view__tooltip-name {
  font-weight: 700;
  margin-bottom: 3px;
}

.gtrack-view__tooltip-grid {
  column-gap: 10px;
  display: grid;
  grid-template-columns: auto auto;
  justify-content: start;
  row-gap: 1px;
}

.gtrack-view__tooltip-label {
  color: #94a3b8;
  text-align: left;
}

.gtrack-view__tooltip-value {
  text-align: left;
}
</style>
