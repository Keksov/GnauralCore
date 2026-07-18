<template>
  <div class="gtrack-view" :class="{ 'gtrack-view--underlay': inlineUnderlay }" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="gtrack-view__canvas"
      role="img"
      :aria-label="t('audio.gtrackCanvasLabel')"
      :class="{
        'gtrack-view__canvas--seekable': seekable || pointMode,
        'gtrack-view__canvas--point': pointMode && hoverPoint !== null,
        'gtrack-view__canvas--value-edge': pointMode && hoverEdge !== null,
      }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    />
    <!-- Playhead overlay (2026-07-16): the moving cursor lives on its own canvas so playback (up to
         ~10 Hz) repaints only a thin line, never the body — draw() used to reallocate + repaint the
         whole lane on every tick. pointer-events:none so clicks still reach the body canvas. -->
    <canvas ref="overlayEl" class="gtrack-view__overlay" aria-hidden="true" />
    <!-- GT3.18 (GT-D20): per-voice accent stripe on the left edge to group a voice's lanes. -->
    <span v-if="accentColor" class="gtrack-view__accent" :style="{ background: accentColor }" />
    <span
      v-if="label"
      class="gtrack-view__label-overlay"
      :style="accentColor ? { color: accentColor } : undefined"
    >{{ label }}</span>
    <!-- GT3.7 (owner req. 10): mark a lane that contains a generated (preparse) voice. -->
    <span v-if="hasPreparse" class="gtrack-view__badge">{{ t('audio.gtrackGenerated') }}</span>
    <!-- SF28.4-style chrome: drag grip + hide stacked on the LEFT. VS4.3: only the FIRST graph of a
         multi-mode stack shows them (they act on the whole lane, not one mode graph). -->
    <div v-if="showSideActions" class="gtrack-view__side-actions">
      <q-icon
        name="drag_indicator"
        size="18px"
        class="gtrack-view__grip"
        :aria-label="t('audio.trackReorder')"
        @pointerdown.stop.prevent="emit('reorder-grip', $event)"
      >
        <app-tooltip>{{ t('audio.trackReorder') }}</app-tooltip>
      </q-icon>
      <!-- BK8a (owner 2026-07-13): per-voice playback mute mirrored on the lane, above the eye. -->
      <q-btn
        dense flat round size="xs"
        :icon="muted ? 'volume_off' : 'volume_up'"
        :color="muted ? 'grey-7' : undefined"
        :aria-label="muted ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute')"
        @click.stop="emit('toggle-mute')"
      >
        <app-tooltip>{{ muted ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute') }}</app-tooltip>
      </q-btn>
      <q-btn
        dense flat round size="xs"
        icon="visibility_off"
        :aria-label="t('audio.trackHide')"
        @click.stop="emit('hide')"
      >
        <app-tooltip>{{ t('audio.trackHide') }}</app-tooltip>
      </q-btn>
      <!-- owner 2026-07-13: include/exclude this voice from the OVERALL wave/spectrum (under the eye). -->
      <q-btn
        dense flat round size="xs"
        icon="graphic_eq"
        :color="inMix ? undefined : 'grey-7'"
        :aria-label="inMix ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude')"
        @click.stop="emit('toggle-in-mix')"
      >
        <app-tooltip>{{ inMix ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude') }}</app-tooltip>
      </q-btn>
      <!-- GT10.44 (owner 2026-07-12): remove this lane, under the hide/eye icon. -->
      <q-btn
        dense flat round size="xs"
        icon="delete"
        color="negative"
        :aria-label="t('audio.gtrackRemoveLane')"
        @click.stop="emit('remove-lane')"
      >
        <app-tooltip>{{ t('audio.gtrackRemoveLane') }}</app-tooltip>
      </q-btn>
    </div>
    <!-- VS1.1: the point-mode toggle + settings gear moved OUT of the canvas into the track's
         header bar (TracksPanel) — the header is visible even when the track is folded. -->
    <!-- GT3.13: hover-a-vertex tooltip (time + parameters). Hidden while actively dragging.
         TT2.3 (owner req. 1/3): the box, its teleport and its placement now belong to AppTooltip —
         this component only says WHERE the pointer is and WHAT to show. That is what moved the
         tooltip from under the cursor (it used to sit +14/+14 down-right of the hotspot, i.e. right
         beneath the arrow glyph) to above it, and it keeps GT3.17's never-clipped behaviour, since
         AppTooltip teleports to <body> and clamps to the viewport too. -->
    <app-tooltip :at="hoverAnchor" class="gtrack-view__tooltip">
      <template v-if="hoverTooltip !== null">
        <div class="gtrack-view__tooltip-name">{{ hoverTooltip.name }}</div>
        <!-- GT3.19: two-column grid — parameter names | values, both left-aligned. -->
        <div class="gtrack-view__tooltip-grid">
          <template v-for="row in hoverTooltip.rows" :key="row.label">
            <span class="gtrack-view__tooltip-label">{{ row.label }}</span>
            <span class="gtrack-view__tooltip-value">{{ row.value }}</span>
          </template>
        </div>
      </template>
    </app-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppTooltip from '@tooltip/AppTooltip.vue'

import { pointBalance, pointBeatFreq, pointVolume, type GTrackVoice } from '../composables/gtrack-model'
import {
  axisWithRange,
  balanceEdgeToBalance,
  gtrackAxis,
  pointValue,
  unitToValue,
  valueToUnit,
  type GTrackMode,
} from '../composables/gtrack-render'
import { formatTimeSec, timeAxisTicksWithMinor } from '../composables/spectrogram-axes'
import {
  FULL_UNIT,
  fractionToTime,
  fullWindow,
  panUnitWindow,
  panWindow,
  timeToFraction,
  zoomUnitWindow,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
  type UnitWindow,
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

/** GT11.4: a beat-band edge reference — a point plus which edge (base+beat/2 or base-beat/2). */
interface BeatEdgeRef {
  readonly voiceId: number
  readonly pointIndex: number
  readonly edge: 'upper' | 'lower'
}

/** VB2.1: a balance-corridor edge reference — a point plus WHICH CHANNEL edge (volR = right, volL =
 *  left), per-channel rather than max/min so a left-heavy point reads differently from a right-heavy
 *  one. Structurally like BeatEdgeRef; shares the hoverEdge state (whose beat edge is 'upper'|'lower'). */
interface BalanceEdgeRef {
  readonly voiceId: number
  readonly pointIndex: number
  readonly edge: 'volR' | 'volL'
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
  /** GT3.15: Ctrl/Shift-accumulated multi-selection, keyed "voiceId:pointIndex" (shared, spans lanes). */
  multiSelected?: ReadonlySet<string> | null
  /** GT3.18 (GT-D20): per-voice accent colour for single-voice lanes — a left stripe + tinted title
   *  visually group a voice's lanes. null = no accent (multi-voice lane). */
  accentColor?: string | null
  /** GT4.2 (GT-D17): punch a transparent hole in the plot area so a solo audio layer behind this
   *  lane shows through under the curves; also makes the lane root background transparent. */
  inlineUnderlay?: boolean
  /** BK8a (owner 2026-07-13): the lane's aggregate playback-mute state (all its voices muted) — drives
   *  the lane mute button mirrored above the eye. */
  muted?: boolean
  /** owner 2026-07-13: whether the lane's voice(s) are included in the OVERALL wave/spectrum. Drives
   *  the graph-inclusion button under the eye (independent of hide + mute). */
  inMix?: boolean
  /** owner 2026-07-14: shade the binaural beat band (base ± beat/2) around the base curve, like the
   *  Schedule tab. Only has an effect in 'base' mode. Controlled by a per-lane setting. */
  showBeatBand?: boolean
  /** VB-D1 (owner 2026-07-17): shade the stereo-balance corridor [volL, volR] around the volume mean
   *  line. Only has an effect in 'volume' mode. Controlled by a per-lane setting. */
  showBalanceBand?: boolean
  /** VS4.3: the left lane-chrome (grip/mute/hide/mix/delete) — shown only on the FIRST graph of a
   *  multi-mode stack (the buttons act on the whole lane). Defaults to true. */
  showSideActions?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  playheadSec: null,
  seekable: false,
  showTimeAxisTop: false,
  showTimeAxisBottom: false,
  pointMode: false,
  selection: null,
  multiSelected: null,
  accentColor: null,
  inlineUnderlay: false,
  muted: false,
  inMix: true,
  showBeatBand: false,
  showBalanceBand: false,
  showSideActions: true,
})
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  (event: 'hide'): void
  /** BK8a: toggle playback mute for this lane's voice(s) (mirror of the voices-panel mute). */
  (event: 'toggle-mute'): void
  /** owner 2026-07-13: toggle whether this lane's voice(s) feed the overall wave/spectrum. */
  (event: 'toggle-in-mix'): void
  /** GT10.44: remove this lane (trash icon under the hide/eye icon). */
  (event: 'remove-lane'): void
  (event: 'reorder-grip', ev: PointerEvent): void
  (event: 'select-point', point: GTrackPointRef | null): void
  (event: 'drag-start', point: GTrackPointRef): void
  (event: 'drag-move', payload: { point: GTrackPointRef; timeSec: number; value: number }): void
  /** GT11.4: drag a beat-band edge (base ± beat/2) on the Base graph — sets the point's beatFreqHalf. */
  (event: 'drag-beat-move', payload: { point: GTrackPointRef; beatFreqHalf: number }): void
  /** VB2.1: drag a balance-corridor edge on the Volume graph — sets the point's stereo balance. */
  (event: 'drag-balance-move', payload: { point: GTrackPointRef; balance: number }): void
  (event: 'drag-end'): void
  /** GT3.3: double-click on a vertex — open the point parameters dialog. */
  (event: 'edit-point', point: GTrackPointRef): void
  /** GT3.6: double-click on a curve — add an interpolated point there. */
  (event: 'add-point', payload: { voiceId: number; timeSec: number }): void
  /** GT3.15: Ctrl/Shift+click on a vertex — toggle it in the multi-selection. */
  (event: 'toggle-multi-select', point: GTrackPointRef): void
  /** GT10.10: a press-release with no movement — the drag transaction should be cancelled. */
  (event: 'drag-cancel'): void
}>()

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const overlayEl = ref<HTMLCanvasElement | null>(null)
// GT3.1: the vertex under the cursor (null = none). GT3.17: tracked regardless of point mode.
const hoverPoint = ref<GTrackPointRef | null>(null)
// GT11.4 / VB2.1: the value-axis edge under the cursor (beat band in Base mode, balance corridor in
// Volume mode), or null. Vertex hover wins. The two shapes are identical; hoverEdge holds either.
const hoverEdge = ref<BeatEdgeRef | BalanceEdgeRef | null>(null)
// GT3.13/3.17: cursor VIEWPORT position (clientX/Y) for the hover tooltip; null while not hovering /
// while dragging. Viewport coords because the tooltip is teleported to <body> + position:fixed.
const hoverPos = ref<{ x: number; y: number } | null>(null)
const HIT_RADIUS_PX = 8

// TT2.3: AppTooltip owns measuring, placing and clamping (GT3.17's job) — it only needs the anchor,
// and only while there is something to show.
const hoverAnchor = computed(() => (hoverTooltip.value !== null ? hoverPos.value : null))

const AXIS_MARGIN = { left: 46, right: 8 }
const AXIS_TIME_MARGIN = 18
// GT10.34 (owner 2026-07-12): reserve enough vertical room for the largest vertex marker (point
// mode, selected = baseR 3.5 + 2, plus its stroke) so a curve running along the top/bottom edge of
// the lane isn't drawn with its nodes clipped in half.
const AXIS_PLAIN_MARGIN = 10
const marginTop = (): number => (props.showTimeAxisTop ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
const marginBottom = (): number => (props.showTimeAxisBottom ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
// GT10.34 (owner 2026-07-12): inset the value axis by the vertex radius so a curve at the extreme
// value (min/max) draws its NODES just inside the plot band instead of on its very edge — otherwise
// the bottom half of those markers is clipped by the lane. Applied to BOTH the draw mapping and the
// hit-tests so clicks still land on the drawn node. (This also aligns the extreme nodes with the
// axis end labels, which drawAxes already insets by ~6px.)
const VERTEX_VPAD = 6
function valueUnitToY(plotY: number, plotH: number, unit: number): number {
  return plotY + VERTEX_VPAD + (1 - unit) * Math.max(1, plotH - 2 * VERTEX_VPAD)
}
function yToValueUnit(plotY: number, plotH: number, offsetY: number): number {
  return Math.max(0, Math.min(1, 1 - (offsetY - plotY - VERTEX_VPAD) / Math.max(1, plotH - 2 * VERTEX_VPAD)))
}

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
// GT10.34-followup: the freq axes gain headroom so a vertex can be dragged past the current data
// range (otherwise the max/min point sits on the edge and clamps to itself). Active in point-edit
// mode OR during a normal-mode Ctrl-drag of a vertex (GT10.39-followup).
const autoAxis = computed(() => gtrackAxis(props.voices, props.mode, props.pointMode || dragging.value, props.mode === 'base' && props.showBeatBand))

// GT11.13 (owner 2026-07-15): the value (Y) view — a NORMALIZED [0,1] window over the auto-fit range
// above, exactly the model SpectrogramView uses for its frequency band (freqView). {0,1} = the full
// auto range, so zooming out simply clamps back to it. Per-lane and in-memory, like freqView's own
// per-view fallback. The window maps to real values through the axis, so a log base-freq axis stays
// log (unitToValue), matching how the spectrogram's band maps onto its frequency scale.
const MIN_Y_SPAN = 0.02
const yView = ref<UnitWindow>(FULL_UNIT)
const axis = computed(() => {
  const auto = autoAxis.value
  const v = yView.value
  if (v.lo <= 0 && v.hi >= 1) return auto
  return axisWithRange(auto, unitToValue(v.lo, auto), unitToValue(v.hi, auto))
})

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
let overlayFrameId = 0
let resizeObserver: ResizeObserver | null = null

// One source of truth for the plot rect + time->x mapping, shared by the body draw() and the
// playhead overlay so the two stacked canvases can never drift out of alignment.
function plotGeometry(cssW: number, cssH: number) {
  const plotX = AXIS_MARGIN.left
  const plotY = marginTop()
  const plotW = Math.max(1, cssW - AXIS_MARGIN.left - AXIS_MARGIN.right)
  const plotH = Math.max(1, cssH - marginTop() - marginBottom())
  const win = view.value
  const timeToX = (sec: number): number => plotX + timeToFraction(sec, win) * plotW
  return { plotX, plotY, plotW, plotH, win, timeToX }
}

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

  const { plotX, plotY, plotW, plotH, win, timeToX } = plotGeometry(cssW, cssH)

  // GT4.2 (GT-D17): inline underlay — punch a transparent hole in the plot area so a solo
  // waveform/spectrogram layer positioned BEHIND this lane shows through under the curves. The
  // axis gutters stay opaque (the bg fill above), hiding the underlay's own axis labels. The lane
  // root's CSS background is made transparent in this mode so the hole reveals the layer behind.
  if (props.inlineUnderlay) {
    ctx.clearRect(plotX, plotY, plotW, plotH)
  }

  if (!hasData.value) {
    drawAxes(ctx, plotX, plotY, plotW, plotH)
    return
  }

  const ax = axis.value
  const valueToY = (value: number): number => valueUnitToY(plotY, plotH, valueToUnit(value, ax))

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
    // owner 2026-07-14: shade the binaural beat band (base ± beat/2) under the base curve — the two
    // carrier frequencies the ears actually hear — mirroring the Schedule tab. 'base' mode only.
    if (props.mode === 'base' && props.showBeatBand) {
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 1) {
        const x = timeToX(pts[i]!.timeSec)
        const y = valueToY(pts[i]!.baseFreq + pts[i]!.beatFreqHalf)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      for (let i = pts.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(timeToX(pts[i]!.timeSec), valueToY(pts[i]!.baseFreq - pts[i]!.beatFreqHalf))
      }
      ctx.closePath()
      ctx.fillStyle = color
      ctx.globalAlpha = 0.18
      ctx.fill()
      ctx.globalAlpha = 1
      // GT11.4: small draggable handles on each band edge (base ± beat/2); the hovered/dragged edge
      // grows and gets a white ring, mirroring the vertex affordance. Locked (preparse) voices get none.
      if (!voice.preparse) {
        for (let i = 0; i < pts.length; i += 1) {
          if (pts[i]!.beatFreqHalf <= 0) continue
          const hx = timeToX(pts[i]!.timeSec)
          for (const edge of ['upper', 'lower'] as const) {
            const val = edge === 'upper' ? pts[i]!.baseFreq + pts[i]!.beatFreqHalf : pts[i]!.baseFreq - pts[i]!.beatFreqHalf
            const active = (hoverEdge.value?.voiceId === voice.id && hoverEdge.value?.pointIndex === i && hoverEdge.value?.edge === edge)
              || (beatDragRef?.voiceId === voice.id && beatDragRef?.pointIndex === i)
            ctx.beginPath()
            ctx.arc(hx, valueToY(val), active ? 3.5 : 2, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.globalAlpha = active ? 1 : 0.65
            ctx.fill()
            ctx.globalAlpha = 1
            if (active) {
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 1.5
              ctx.stroke()
            }
          }
        }
      }
    }
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
    // VB fix (owner 2026-07-18): the balance corridor draws the L and R channel envelopes as DISTINCT
    // colours (cyan = L, orange = R), with a light fill between them. Its WIDTH (|volR−volL| =
    // 2·volume·|balance|) is identical for +balance and −balance, so max/min shading alone made a
    // left-heavy point look exactly like a right-heavy one — the two coloured lines swap instead. The
    // per-channel handles are draggable (VB-D3 A: symmetric, volume fixed). 'volume' mode only.
    if (props.mode === 'volume' && props.showBalanceBand) {
      const balCh = [
        { key: 'volR' as const, col: '#fb923c', label: 'R' },
        { key: 'volL' as const, col: '#38bdf8', label: 'L' },
      ]
      // fill between the two channel envelopes — the balance spread (magnitude)
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 1) {
        const x = timeToX(pts[i]!.timeSec)
        if (i === 0) ctx.moveTo(x, valueToY(pts[i]!.volR))
        else ctx.lineTo(x, valueToY(pts[i]!.volR))
      }
      for (let i = pts.length - 1; i >= 0; i -= 1) {
        ctx.lineTo(timeToX(pts[i]!.timeSec), valueToY(pts[i]!.volL))
      }
      ctx.closePath()
      ctx.fillStyle = color
      ctx.globalAlpha = 0.12
      ctx.fill()
      ctx.globalAlpha = 1
      // each channel as its own coloured envelope line + an L/R label at the right edge
      for (const ch of balCh) {
        ctx.beginPath()
        for (let i = 0; i < pts.length; i += 1) {
          const x = timeToX(pts[i]!.timeSec)
          const y = valueToY(pts[i]![ch.key])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = ch.col
        ctx.lineWidth = 1.25
        ctx.stroke()
        ctx.fillStyle = ch.col
        ctx.font = '9px sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText(ch.label, Math.min(timeToX(pts[pts.length - 1]!.timeSec) + 3, plotX + plotW - 8), valueToY(pts[pts.length - 1]![ch.key]))
      }
      // draggable per-channel handles; the hovered/dragged one grows + gets a white ring. Centred
      // points (volL == volR, no spread) and locked (preparse) voices get none.
      if (!voice.preparse) {
        for (let i = 0; i < pts.length; i += 1) {
          if (pts[i]!.volL === pts[i]!.volR) continue
          const hx = timeToX(pts[i]!.timeSec)
          for (const ch of balCh) {
            const active = (hoverEdge.value?.voiceId === voice.id && hoverEdge.value?.pointIndex === i && hoverEdge.value?.edge === ch.key)
              || (balanceDragRef?.voiceId === voice.id && balanceDragRef?.pointIndex === i)
            ctx.beginPath()
            ctx.arc(hx, valueToY(pts[i]![ch.key]), active ? 3.5 : 2, 0, Math.PI * 2)
            ctx.fillStyle = ch.col
            ctx.globalAlpha = active ? 1 : 0.8
            ctx.fill()
            ctx.globalAlpha = 1
            if (active) {
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 1.5
              ctx.stroke()
            }
          }
        }
      }
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
    // GT10.34 (owner 2026-07-12): keep the whole dot inside the CANVAS. A value at/below the axis
    // min (a sub-1 Hz base freq, a constant voice on the bottom line, an out-of-range volume) would
    // otherwise draw the marker on (or beyond) the canvas edge and clip it in half. Clamp the dot's
    // centre so its full radius (+ ring stroke) always fits.
    const dotPad = baseR + 2 + 2 // largest ring radius + stroke
    const clampDotY = (yy: number): number => Math.max(dotPad, Math.min(cssH - dotPad, yy))
    for (let i = 0; i < pts.length; i += 1) {
      const x = timeToX(pts[i]!.timeSec)
      const y = clampDotY(valueToY(pointValue(pts[i]!, props.mode)))
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

  // Playhead is drawn on the overlay canvas (drawPlayhead), not here.
  drawAxes(ctx, plotX, plotY, plotW, plotH)
}

// The playhead, on its own transparent canvas above the body. Redrawn on playback / view / resize
// only — the body is never touched by a moving cursor.
function drawPlayhead(): void {
  const canvas = overlayEl.value
  if (canvas === null) return
  const ctx = canvas.getContext('2d')
  if (ctx === null) return

  const cssW = Math.max(1, Math.floor(canvas.clientWidth))
  const cssH = Math.max(1, Math.floor(canvas.clientHeight))
  const dpr = window.devicePixelRatio || 1
  const wPx = Math.max(1, Math.floor(cssW * dpr))
  const hPx = Math.max(1, Math.floor(cssH * dpr))
  // Only reallocate the backing store on an actual size change; a plain playback tick just clears.
  if (canvas.width !== wPx) canvas.width = wPx
  if (canvas.height !== hPx) canvas.height = hPx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const playhead = props.playheadSec
  if (playhead === null || !hasData.value) return
  const { plotY, plotH, win, timeToX } = plotGeometry(cssW, cssH)
  if (playhead < win.startSec || playhead > win.endSec) return
  const px = timeToX(playhead)
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px, plotY)
  ctx.lineTo(px, plotY + plotH)
  ctx.stroke()
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

function scheduleDrawPlayhead(): void {
  if (overlayFrameId !== 0) cancelAnimationFrame(overlayFrameId)
  overlayFrameId = requestAnimationFrame(() => {
    overlayFrameId = 0
    drawPlayhead()
  })
}

// The view (zoom/pan) and a resize move the playhead's x and reflow the body — redraw both layers.
function scheduleDrawAll(): void {
  scheduleDraw()
  scheduleDrawPlayhead()
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
  const zoomIn = aEvent.deltaY < 0
  const zoomFactor = zoomIn ? 0.8 : 1.25
  // GT11.13 (owner 2026-07-15): the SAME modifier map as SpectrogramView.onWheel, so the gesture is
  // identical on both graphs — Alt+Shift = Y pan, Alt = Y zoom about the pointer, Shift = time pan,
  // plain OR Ctrl = time zoom. Zooming Y back out clamps to the full range (no extra control).
  if (aEvent.altKey && aEvent.shiftKey) {
    yView.value = panUnitWindow(yView.value, (zoomIn ? 1 : -1) * 0.15 * (yView.value.hi - yView.value.lo))
    scheduleDraw()
    return
  }
  if (aEvent.altKey) {
    const rect = plotRect()
    if (rect === null) return
    // yTop 0 = top -> anchorBottom = 1 - yTop (same derivation as SpectrogramView).
    const yTop = Math.min(1, Math.max(0, (aEvent.offsetY - rect.plotY) / rect.plotH))
    yView.value = zoomUnitWindow(yView.value, zoomFactor, 1 - yTop, MIN_Y_SPAN)
    scheduleDraw()
    return
  }
  const f = xFraction(aEvent)
  const anchor = f ?? 0.5
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
      const y = valueUnitToY(plotY, plotH, valueToUnit(pointValue(p, props.mode), ax))
      const dist = Math.hypot(x - offsetX, y - offsetY)
      if (dist <= bestDist) {
        bestDist = dist
        best = { voiceId: voice.id, pointIndex: i }
      }
    }
  }
  return best
}

// GT11.4: find the beat-band edge (base ± beat/2 at a point) nearest a canvas pixel, within
// HIT_RADIUS_PX. Only in Base mode with the band shown; skips locked (preparse) voices and points
// with no band (beatFreqHalf <= 0, edges coincide with the base vertex).
function beatEdgeAtPixel(offsetX: number, offsetY: number): BeatEdgeRef | null {
  if (props.mode !== 'base' || !props.showBeatBand) return null
  const rect = plotRect()
  if (rect === null || !hasData.value) return null
  const { plotX, plotY, plotW, plotH } = rect
  const win = view.value
  const ax = axis.value
  let best: BeatEdgeRef | null = null
  let bestDist = HIT_RADIUS_PX
  for (const voice of props.voices) {
    if (voice.preparse) continue
    for (let i = 0; i < voice.points.length; i += 1) {
      const p = voice.points[i]!
      if (p.beatFreqHalf <= 0) continue
      const x = plotX + timeToFraction(p.timeSec, win) * plotW
      const yUp = valueUnitToY(plotY, plotH, valueToUnit(p.baseFreq + p.beatFreqHalf, ax))
      const yLo = valueUnitToY(plotY, plotH, valueToUnit(p.baseFreq - p.beatFreqHalf, ax))
      const dUp = Math.hypot(x - offsetX, yUp - offsetY)
      if (dUp <= bestDist) { bestDist = dUp; best = { voiceId: voice.id, pointIndex: i, edge: 'upper' } }
      const dLo = Math.hypot(x - offsetX, yLo - offsetY)
      if (dLo <= bestDist) { bestDist = dLo; best = { voiceId: voice.id, pointIndex: i, edge: 'lower' } }
    }
  }
  return best
}

// VB2.1: find the balance-corridor edge (max/min of volL,volR at a point) nearest a canvas pixel,
// within HIT_RADIUS_PX. Only in Volume mode with the corridor shown; skips locked (preparse) voices
// and centred points (volL == volR, edges coincide with the volume line).
function balanceEdgeAtPixel(offsetX: number, offsetY: number): BalanceEdgeRef | null {
  if (props.mode !== 'volume' || !props.showBalanceBand) return null
  const rect = plotRect()
  if (rect === null || !hasData.value) return null
  const { plotX, plotY, plotW, plotH } = rect
  const win = view.value
  const ax = axis.value
  let best: BalanceEdgeRef | null = null
  let bestDist = HIT_RADIUS_PX
  for (const voice of props.voices) {
    if (voice.preparse) continue
    for (let i = 0; i < voice.points.length; i += 1) {
      const p = voice.points[i]!
      if (p.volL === p.volR) continue
      const x = plotX + timeToFraction(p.timeSec, win) * plotW
      const yR = valueUnitToY(plotY, plotH, valueToUnit(p.volR, ax))
      const yL = valueUnitToY(plotY, plotH, valueToUnit(p.volL, ax))
      const dR = Math.hypot(x - offsetX, yR - offsetY)
      if (dR <= bestDist) { bestDist = dR; best = { voiceId: voice.id, pointIndex: i, edge: 'volR' } }
      const dL = Math.hypot(x - offsetX, yL - offsetY)
      if (dL <= bestDist) { bestDist = dL; best = { voiceId: voice.id, pointIndex: i, edge: 'volL' } }
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
  const uy = yToValueUnit(plotY, plotH, offsetY)
  // GT2.8: inverse-map through the axis (handles the log frequency scale).
  return { timeSec: fractionToTime(fx, view.value), value: unitToValue(uy, axis.value) }
}

// GT3.2: drag state. A drag runs from pointerdown-on-a-vertex to pointerup as one undo unit.
let dragRef: GTrackPointRef | null = null
// GT10.10 (owner req. 55): distinguish a CLICK (no movement -> open the dialog) from a DRAG.
let dragStart: { x: number; y: number } | null = null
let dragMoved = false
const DRAG_THRESHOLD_PX = 3
// GT10.39-followup (owner 2026-07-12): a vertex drag makes the axis 'editable' too, so a Ctrl-drag
// in NORMAL mode gets the same headroom as point-edit mode (drag a vertex past the data range).
const dragging = ref(false)

// GT11.4: separate drag state for a beat-band edge — the move sets beatFreqHalf, not the mode value.
let beatDragRef: GTrackPointRef | null = null
let beatDragStart: { x: number; y: number } | null = null
let beatDragMoved = false

// VB2.1: separate drag state for a balance-corridor edge — the move sets the point's balance (volume
// fixed), not the mode value. balanceDragSign captures which channel was louder at drag start (VB-D3
// A: the sign is preserved; the corridor only changes width).
let balanceDragRef: GTrackPointRef | null = null
let balanceDragStart: { x: number; y: number } | null = null
let balanceDragMoved = false
let balanceDragSign = 1

function beginVertexDrag(aEvent: PointerEvent, hit: GTrackPointRef): void {
  emit('select-point', hit)
  dragging.value = true
  dragRef = hit
  dragStart = { x: aEvent.offsetX, y: aEvent.offsetY }
  dragMoved = false
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
  emit('drag-start', hit)
}

// GT11.4: start dragging a beat-band edge. Reuses the drag-start/drag-end transaction (one undo
// unit), but the move maps to beatFreqHalf (via drag-beat-move), not the mode value.
function beginBeatEdgeDrag(aEvent: PointerEvent, edge: BeatEdgeRef): void {
  const ref_: GTrackPointRef = { voiceId: edge.voiceId, pointIndex: edge.pointIndex }
  emit('select-point', ref_)
  dragging.value = true
  beatDragRef = ref_
  beatDragStart = { x: aEvent.offsetX, y: aEvent.offsetY }
  beatDragMoved = false
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
  emit('drag-start', ref_)
}

// VB2.1: start dragging a balance-corridor edge. Reuses the drag-start/drag-end transaction (one undo
// unit), but the move maps to the point's balance (via drag-balance-move), not the mode value. The
// louder-channel sign is captured now and preserved for the whole drag (VB-D3 A).
function beginBalanceEdgeDrag(aEvent: PointerEvent, edge: BalanceEdgeRef): void {
  const ref_: GTrackPointRef = { voiceId: edge.voiceId, pointIndex: edge.pointIndex }
  const voice = props.voices.find((v) => v.id === edge.voiceId)
  const p = voice?.points[edge.pointIndex]
  const sign = p === undefined ? 1 : Math.sign(pointBalance(p))
  balanceDragSign = sign === 0 ? 1 : sign
  emit('select-point', ref_)
  dragging.value = true
  balanceDragRef = ref_
  balanceDragStart = { x: aEvent.offsetX, y: aEvent.offsetY }
  balanceDragMoved = false
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
  emit('drag-start', ref_)
}

function onPointerDown(aEvent: PointerEvent): void {
  if (!hasData.value || aEvent.button !== 0) return
  // GT10.10 (owner reqs 57-58): NORMAL mode + Ctrl — click a vertex to drag it, click a curve to
  // add a node (one-off edits without entering point mode).
  if (!props.pointMode) {
    if (aEvent.ctrlKey || aEvent.metaKey) {
      const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
      if (hit !== null) {
        beginVertexDrag(aEvent, hit)
        return
      }
      // GT11.4: Ctrl-drag a beat-band edge to resize the beat (base ± beat/2), like Ctrl-drag a vertex.
      const beatEdge = beatEdgeAtPixel(aEvent.offsetX, aEvent.offsetY)
      if (beatEdge !== null) {
        beginBeatEdgeDrag(aEvent, beatEdge)
        return
      }
      // VB2.1: Ctrl-drag a balance-corridor edge to edit the balance (Volume mode), like the beat edge.
      const balanceEdge = balanceEdgeAtPixel(aEvent.offsetX, aEvent.offsetY)
      if (balanceEdge !== null) {
        beginBalanceEdgeDrag(aEvent, balanceEdge)
        return
      }
      const curve = voiceCurveAtPixel(aEvent.offsetX, aEvent.offsetY)
      if (curve !== null) emit('add-point', curve)
    }
    return
  }

  // GT11.14 (owner 2026-07-15): the Select/Add/Delete tools are gone — point mode always behaves as
  // Select (a plain drag moves a vertex). Add/Delete live on their keyboard/mouse gestures instead.
  const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)

  // GT3.15 (owner req. 30): Ctrl/Shift+click on a vertex accumulates the multi-selection instead
  // of selecting/dragging.
  if ((aEvent.ctrlKey || aEvent.metaKey || aEvent.shiftKey) && hit !== null) {
    emit('toggle-multi-select', hit)
    return
  }

  if (hit === null) {
    // GT11.14: Ctrl+click on a CURVE adds a node — now in point mode too, not just normal mode
    // (GT10.10), so dropping the Add tool costs no workflow. A modifier-click never deselects.
    if (aEvent.ctrlKey || aEvent.metaKey) {
      const curve = voiceCurveAtPixel(aEvent.offsetX, aEvent.offsetY)
      if (curve !== null) emit('add-point', curve)
      return
    }
    // GT11.4: a plain drag of a beat-band edge resizes the beat, before deselecting.
    const beatEdge = beatEdgeAtPixel(aEvent.offsetX, aEvent.offsetY)
    if (beatEdge !== null) {
      beginBeatEdgeDrag(aEvent, beatEdge)
      return
    }
    // VB2.1: a plain drag of a balance-corridor edge edits the balance, before deselecting.
    const balanceEdge = balanceEdgeAtPixel(aEvent.offsetX, aEvent.offsetY)
    if (balanceEdge !== null) {
      beginBalanceEdgeDrag(aEvent, balanceEdge)
      return
    }
    emit('select-point', null) // deselect on empty space
    return
  }
  beginVertexDrag(aEvent, hit)
}

function onPointerMove(aEvent: PointerEvent): void {
  // GT11.4: an active beat-band-edge drag maps the cursor's frequency to beatFreqHalf = |cursor − base|
  // (the band is symmetric in Hz, so either edge sets the same half-width; both edges move).
  if (beatDragRef !== null) {
    const ref_ = beatDragRef
    if (!beatDragMoved && beatDragStart !== null) {
      if (Math.hypot(aEvent.offsetX - beatDragStart.x, aEvent.offsetY - beatDragStart.y) < DRAG_THRESHOLD_PX) return
      beatDragMoved = true
    }
    const tv = cursorToTimeValue(aEvent.offsetX, aEvent.offsetY)
    const voice = props.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (tv !== null && p !== undefined) {
      emit('drag-beat-move', { point: ref_, beatFreqHalf: Math.max(0, Math.abs(tv.value - p.baseFreq)) })
    }
    hoverPos.value = null
    return
  }
  // VB2.1: an active balance-corridor-edge drag maps the cursor amplitude to the point's balance,
  // keeping the volume line fixed and the louder-channel sign captured at drag start (VB-D3 A).
  if (balanceDragRef !== null) {
    const ref_ = balanceDragRef
    if (!balanceDragMoved && balanceDragStart !== null) {
      if (Math.hypot(aEvent.offsetX - balanceDragStart.x, aEvent.offsetY - balanceDragStart.y) < DRAG_THRESHOLD_PX) return
      balanceDragMoved = true
    }
    const tv = cursorToTimeValue(aEvent.offsetX, aEvent.offsetY)
    const voice = props.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (tv !== null && p !== undefined) {
      emit('drag-balance-move', { point: ref_, balance: balanceEdgeToBalance(pointVolume(p), tv.value, balanceDragSign) })
    }
    hoverPos.value = null
    return
  }
  if (dragRef !== null) {
    // GT10.10: ignore sub-threshold jitter so a plain click stays a click (opens the dialog).
    if (!dragMoved && dragStart !== null) {
      if (Math.hypot(aEvent.offsetX - dragStart.x, aEvent.offsetY - dragStart.y) < DRAG_THRESHOLD_PX) return
      dragMoved = true
    }
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
  // GT11.4: track the hovered beat-band edge (vertex hover wins) for the resize cursor + highlight.
  const nextEdge = next === null ? (beatEdgeAtPixel(aEvent.offsetX, aEvent.offsetY) ?? balanceEdgeAtPixel(aEvent.offsetX, aEvent.offsetY)) : null
  const prevEdge = hoverEdge.value
  if (nextEdge?.voiceId !== prevEdge?.voiceId || nextEdge?.pointIndex !== prevEdge?.pointIndex || nextEdge?.edge !== prevEdge?.edge) {
    hoverEdge.value = nextEdge
    scheduleDraw()
  }
  // GT11.15 (owner 2026-07-15): the anchor must be set for a beat-band edge too, not just a vertex —
  // the edges are nodes of the same point and were the one hoverable thing with no tooltip. Hence
  // AFTER nextEdge is known: it used to be decided from `next` alone, a few lines up.
  hoverPos.value = next !== null || nextEdge !== null ? { x: aEvent.clientX, y: aEvent.clientY } : null
}

function onPointerUp(aEvent: PointerEvent): void {
  // GT11.4: finish a beat-band-edge drag (commit the transaction = one undo unit). A press-release
  // with no movement opens the point dialog (Beat freq field), mirroring a vertex click.
  if (beatDragRef !== null) {
    const ref_ = beatDragRef
    const moved = beatDragMoved
    beatDragRef = null
    beatDragStart = null
    dragging.value = false
    try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
    if (moved) emit('drag-end')
    else { emit('drag-cancel'); emit('edit-point', ref_) }
    return
  }
  // VB2.1: finish a balance-corridor-edge drag (commit = one undo unit). A press-release with no
  // movement opens the point dialog (Balance field), mirroring the beat-edge and vertex behaviour.
  if (balanceDragRef !== null) {
    const ref_ = balanceDragRef
    const moved = balanceDragMoved
    balanceDragRef = null
    balanceDragStart = null
    dragging.value = false
    try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
    if (moved) emit('drag-end')
    else { emit('drag-cancel'); emit('edit-point', ref_) }
    return
  }
  if (dragRef === null) return
  const ref_ = dragRef
  const clicked = !dragMoved
  dragRef = null
  dragStart = null
  dragging.value = false
  try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
  if (clicked) {
    // GT10.10 (owner req. 55): a press-release without movement is a CLICK — cancel the (empty)
    // drag transaction and open the point dialog.
    emit('drag-cancel')
    emit('edit-point', ref_)
    return
  }
  emit('drag-end')
}

function onPointerLeave(): void {
  if (hoverPoint.value !== null) { hoverPoint.value = null; scheduleDraw() }
  if (hoverEdge.value !== null) { hoverEdge.value = null; scheduleDraw() } // GT11.4
  hoverPos.value = null
}

// GT3.13 (owner req. 25): tooltip data for the hovered vertex — voice name, time, base/beat freq,
// L/R volumes, and derived Volume/Balance (GT-D6). GT3.19 (owner req. 39): a name header + rows of
// {label, value} rendered as a two-column grid (labels | values, both left-aligned).
interface TooltipRow { readonly label: string; readonly value: string }
const hoverTooltip = computed<{ name: string; rows: TooltipRow[] } | null>(() => {
  // GT11.15 (owner 2026-07-15): a hovered beat-band edge describes the SAME point as a vertex does —
  // it is drawn at base ± beat/2 of it — so it gets the same readout. Vertex still wins when both are
  // under the cursor, matching the hit-test order in onPointerMove.
  const hp = hoverPoint.value ?? hoverEdge.value
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
  // GT3.1/3.2: in point mode, selection + drag (and the click-to-open dialog) are handled on
  // pointerdown/up, so clicks here are inert.
  if (props.pointMode) return
  // GT10.10: Ctrl-clicks are edit gestures (drag vertex / add node), never a seek.
  if (aEvent.ctrlKey || aEvent.metaKey) return
  if (!hasData.value) return
  // GT10.25 (owner req. 74): in NORMAL mode a single click on a vertex opens its dialog.
  const hit = pointAtPixel(aEvent.offsetX, aEvent.offsetY)
  if (hit !== null) {
    emit('edit-point', hit)
    return
  }
  // GT10.32 (revised 2026-07-12): a click on EMPTY space DOES move the playhead (owner wants the
  // position cursor to follow the click). Keyboard arrows also seek (seekBy).
  if (props.seekable !== true) return
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
    const y = valueUnitToY(plotY, plotH, valueToUnit(v, ax))
    const dist = Math.abs(y - offsetY)
    if (dist <= bestDist) {
      bestDist = dist
      best = voice.id
    }
  }
  return best === null ? null : { voiceId: best, timeSec }
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
watch(view, () => scheduleDrawAll(), { deep: true })
watch(() => shared?.selection.value, () => scheduleDraw(), { deep: true })
watch(() => props.mode, () => scheduleDraw())
watch(() => props.voices, () => scheduleDraw(), { deep: true })
watch(() => props.playheadSec, () => scheduleDrawPlayhead())
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
watch(() => props.inlineUnderlay, () => scheduleDraw())

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => scheduleDrawAll())
    resizeObserver.observe(canvasEl.value)
  }
  if (props.durationSec > 0 && (shared === null || shared.view.value === null)) {
    view.value = fullWindow(props.durationSec)
  }
  scheduleDrawAll()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (overlayFrameId !== 0) cancelAnimationFrame(overlayFrameId)
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

/* GT4.2: with an inline underlay behind, the lane root is transparent so the plot-area hole
   (punched in the canvas) reveals the solo audio layer; the canvas keeps the axis gutters opaque. */
.gtrack-view--underlay {
  background: transparent;
}

.gtrack-view__canvas {
  display: block;
  /* GT10.34 (owner 2026-07-12): flex-basis 0 (not auto) so the canvas fills the lane by GROWTH and
     ignores its own intrinsic (attribute) height. With flex-basis:auto the canvas was laid out at
     its bitmap height and overflowed the lane; overflow:hidden then clipped the bottom margin, so
     value=min vertices (curve along the lane's bottom edge) showed only half. Stays in flow, so
     width:100% + the curve render are unaffected. */
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
}

/* Playhead overlay: same rect as the body canvas (the canvas is the only in-flow child, so inset:0
   of the position:relative root matches it), transparent, and click-through to the body canvas. */
.gtrack-view__overlay {
  height: 100%;
  left: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: 100%;
}

.gtrack-view__canvas--seekable {
  cursor: pointer;
}

/* GT3.1 / GT3.20 (owner req. 40): over an editable vertex in select mode use the pointing-hand
   cursor — its hotspot is the fingertip (at the node) while the hand body sits down-right, off the
   node, so the point stays visible while hovering and dragging (unlike grab, whose centered hotspot
   covered it). */
.gtrack-view__canvas--point {
  cursor: pointer;
}

/* GT11.4 / VB2.1: over a draggable value-axis edge (beat band in Base mode, balance corridor in
   Volume mode) — vertical resize. */
.gtrack-view__canvas--value-edge {
  cursor: ns-resize;
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

.gtrack-view__side-actions .q-btn {
  color: #cbd5e1;
  opacity: 0.6;
}

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
/* TT2.3: the box itself (background, border, radius, colour, padding, fixed positioning, z-index and
   pointer-events) now comes from AppTooltip, so every tooltip in the app looks the same — the local
   copies of those values are gone. Only the width cap is still ours; see the global block below for
   why it cannot live here. */

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

/* TT2.7: AppTooltip's dark plate has luminance to spare, so the label/value split is carried by
   colour again and the old font-weight crutch is gone (on the grey plate there was only ~6:1 in
   total, all of it needed for legibility). Labels ~5.7:1, values ~11.9:1 — both readable, plainly
   distinct.
   Dim via AppTooltip's variable, NOT `opacity` (owner 2026-07-15: the labels "blurred, as if
   semibold"): an opacity < 1 composites the text into its own layer and loses Windows' subpixel
   antialiasing, so the glyphs soften and read heavier beside un-dimmed text. And not a local hex
   either — that is what rotted when the plate changed under it. The variable is the one thing that
   is neither. tabular-nums stays: it stops the value column jittering as digits change. */
.gtrack-view__tooltip-label {
  color: var(--app-tooltip-fg-dim);
  text-align: left;
}

.gtrack-view__tooltip-value {
  font-variant-numeric: tabular-nums;
  text-align: left;
}
</style>

<!-- TT2.3: AppTooltip renders the tooltip box and teleports it to <body>, so it is not a descendant
     of this component and carries no scope attribute — a `scoped` rule can never match it. The inner
     rows above are slot content, compiled in THIS component's scope, so they stay scoped as before.
     Only the width cap has to be global: without it a long voice name would stretch the tooltip out
     to Quasar's 95vw default. -->
<style>
.gtrack-view__tooltip {
  max-width: 260px;
}
</style>
