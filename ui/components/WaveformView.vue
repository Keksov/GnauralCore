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
    <!-- SF28.4: drag grip + hide stacked in a column on the LEFT of the track. -->
    <div class="waveform-view__side-actions">
      <q-icon
        name="drag_indicator"
        size="18px"
        class="waveform-view__grip"
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
    <!-- SF27: per-track colour/scale gear, top-right. -->
    <div class="waveform-view__actions">
      <q-btn
        dense flat round size="xs"
        icon="settings"
        :aria-label="t('audio.waveformStyle')"
        @click.stop="emit('open-settings')"
      >
        <q-tooltip>{{ t('audio.waveformStyle') }}</q-tooltip>
      </q-btn>
    </div>
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
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SpectrogramAnalysisParams } from '@protocol'

import { useSpectrogram } from '../composables/use-spectrogram'
import { amplitudeToDb, type AudioPeak } from '../composables/audio-model'
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

// SF22.2 + SF24.1: an Audacity-style waveform track. The peaks come from the BACKEND (the
// worker's get-peaks over the same decoded PCM as the spectrogram — variant A), so the client
// holds no authoritative audio. It reuses the SHARED time window / selection (provide/inject)
// so it stays frame-aligned with the spectrogram tracks.

interface Props {
  filePath: string | null
  /** SF24.1 fix: open with the SAME analysis params as the spectrogram track for this channel
      so the backend REUSES one analysis (peaks + tiles from it) instead of opening a separate
      one that would push past the analysis cache cap and evict others. */
  analysis?: SpectrogramAnalysisParams
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
  /** GT4.1/GT4.3 (GT-D17): for a .gnaural source, analyze a SOLO render of just these voice ids
      (all others muted). Omitted/empty = the full mix. Changing it re-opens the analysis. */
  soloVoiceIds?: readonly number[]
  /** GT7.4-R2 (owner 2026-07-13): bump to force a fresh re-open for the SAME file (after a Save). */
  reloadKey?: number
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
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  (event: 'open-settings'): void
  (event: 'hide'): void
  (event: 'reorder-grip', ev: PointerEvent): void
}>()

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
// SF24.1: the waveform opens its own (lazy) backend analysis just to pull peaks; the decode is
// shared with the spectrogram's analysis (SF11.7), so this only adds a peak query, not a decode.
const spec = useSpectrogram({ refetchDebounceMs: 200 })

const AXIS_MARGIN = { left: 46, right: 8 }
const AXIS_TIME_MARGIN = 18
const AXIS_PLAIN_MARGIN = 6
const marginTop = (): number => (props.showTimeAxisTop ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)
const marginBottom = (): number => (props.showTimeAxisBottom ? AXIS_TIME_MARGIN : AXIS_PLAIN_MARGIN)

const durationSec = computed(() => spec.analysis.value?.durationSec ?? 0)
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

// SF24.1: peak columns are fetched from the backend and cached by (view + size + scale). A
// playhead-only redraw reuses the cache; a view/size/scale change triggers a debounced refetch.
let cacheSig = ''
let cacheRaw: AudioPeak[] = []
let cacheColumns = peaksToColumns([], 'linear')
let fetchTimer: ReturnType<typeof setTimeout> | null = null

function plotWidthNow(): number {
  const canvas = canvasEl.value
  return canvas === null ? 1 : plotWidthPx(canvas)
}

async function fetchColumns(): Promise<void> {
  if (!hasAudio.value) {
    cacheRaw = []
    cacheColumns = []
    return
  }
  const win = view.value
  const plotW = plotWidthNow()
  const sig = `${win.startSec}|${win.endSec}|${plotW}|${props.channel}`
  if (sig === cacheSig && cacheRaw.length > 0) {
    cacheColumns = peaksToColumns(cacheRaw, props.scale) // scale-only change: reuse raw peaks
    return
  }
  const peaks = await spec.getPeaks(win.startSec, win.endSec, plotW)
  // Ignore a stale response (the view moved on while we awaited).
  if (`${view.value.startSec}|${view.value.endSec}|${plotWidthNow()}|${props.channel}` !== sig) return
  cacheRaw = peaks
  cacheColumns = peaksToColumns(peaks, props.scale)
  cacheSig = sig
  scheduleDraw()
}

function scheduleFetch(): void {
  if (fetchTimer !== null) clearTimeout(fetchTimer)
  fetchTimer = setTimeout(() => {
    fetchTimer = null
    void fetchColumns()
  }, 120)
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

  // time ruler (SF16.6 style) on the requested edges. SF25: brighter + taller ticks + minor ticks.
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

// SF23 follow-up: Audacity-style keyboard nav, exposed for AudioPage to delegate when the
// waveform is the active track editor (e.g. Waveform-only mode, spectrogram hidden).
//   Left/Right -> seek ±1 s (Shift ±5 s); Alt+Left/Right -> pan; Home/End -> view edges.
const SEEK_STEP_SEC = 1
const SEEK_STEP_SEC_LARGE = 5
function followPlayhead(aSec: number): void {
  const win = view.value
  const margin = (win.endSec - win.startSec) * 0.1
  if (aSec < win.startSec) view.value = panWindow(win, aSec - margin - win.startSec, durationSec.value)
  else if (aSec > win.endSec) view.value = panWindow(win, aSec + margin - win.endSec, durationSec.value)
}
function seekBy(aDeltaSec: number): void {
  const from = props.playheadSec ?? view.value.startSec
  const next = Math.max(0, Math.min(durationSec.value, from + aDeltaSec))
  emit('seek', next)
  followPlayhead(next)
}
function handleNavKey(aEvent: KeyboardEvent): void {
  if (!hasAudio.value) return
  const span = view.value.endSec - view.value.startSec
  const dur = durationSec.value
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

const hover = ref<{ timeSec: number; amp: number } | null>(null)
const hoverPos = ref<{ x: number; y: number } | null>(null)
const hoverText = computed(() => {
  const h = hover.value
  if (h === null) return ''
  const db = amplitudeToDb(h.amp)
  // SF24.1: readout at the cursor — time + amplitude (peak of the hovered column) + dBFS.
  return `${formatTimeSec(h.timeSec)} · ${h.amp.toFixed(3)} · ${db.toFixed(1)} dB`
})

// Amplitude at the cursor = the max magnitude of the hovered backend peak column.
function ampAtFraction(aFraction: number): number {
  const n = cacheRaw.length
  if (n === 0) return 0
  const idx = Math.min(n - 1, Math.max(0, Math.floor(aFraction * n)))
  const p = cacheRaw[idx]
  if (p === undefined) return 0
  return Math.abs(p.max) >= Math.abs(p.min) ? p.max : p.min
}

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
  hover.value = { timeSec, amp: ampAtFraction(f) }
  hoverPos.value = { x: aEvent.offsetX + 12, y: aEvent.offsetY + 12 }
}

function onPointerLeave(): void {
  hover.value = null
  hoverPos.value = null
}

// SF24.1: (re)open the backend analysis for this file+channel to pull peaks.
async function openForFile(aFilePath: string | null): Promise<void> {
  await spec.close()
  cacheSig = ''
  cacheRaw = []
  cacheColumns = []
  if (aFilePath === null || aFilePath === '') {
    scheduleDraw()
    return
  }
  try {
    // Reuse the spectrogram track's analysis (same params -> same cache key -> shared).
    const params = props.analysis ?? { window: 2048, hop: 512, data: 'magnitude' as const, channel: props.channel }
    await spec.open({ filePath: aFilePath, soloVoiceIds: props.soloVoiceIds, ...params })
  } catch {
    // ignore — draw shows the empty frame
  }
  if (durationSec.value > 0 && (shared === null || shared.view.value === null)) {
    view.value = fullWindow(durationSec.value)
  }
  void fetchColumns().then(() => scheduleDraw())
}

// Initialise the shared view + fetch when the analysis becomes ready.
watch(durationSec, (dur) => {
  if (dur > 0 && (shared === null || shared.view.value === null)) view.value = fullWindow(dur)
  scheduleFetch()
})
watch(view, () => { scheduleFetch(); scheduleDraw() }, { deep: true })
watch(() => shared?.selection.value, () => scheduleDraw(), { deep: true })
watch(() => props.scale, () => { void fetchColumns(); scheduleDraw() })
watch(() => props.color, () => scheduleDraw())
watch(() => props.channel, () => { void openForFile(props.filePath) })
watch(() => props.playheadSec, () => scheduleDraw())
watch(() => props.filePath, (v) => { void openForFile(v) })
// GT4.1/GT4.3: changing the solo voice set switches the source render -> re-open on the same path.
watch(() => (props.soloVoiceIds ?? []).join(','), () => { void openForFile(props.filePath) })
// GT7.4-R2 (owner 2026-07-13): a Save rewrote the file (same path) -> re-open for the fresh render.
watch(() => props.reloadKey, () => { void openForFile(props.filePath) })
// SF24.1 fix: track the spectrogram track's params so we keep reusing its (reconfigured) analysis.
watch(() => props.analysis, () => { void openForFile(props.filePath) }, { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => { scheduleFetch(); scheduleDraw() })
    resizeObserver.observe(canvasEl.value)
  }
  void openForFile(props.filePath)
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (fetchTimer !== null) clearTimeout(fetchTimer)
  resizeObserver?.disconnect()
  void spec.close()
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

/* SF25: match the spectrogram's channel label — just right of the vertical axis, at the top. */
.waveform-view__label-overlay {
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

/* SF27: per-track gear, top-right corner. */
.waveform-view__actions {
  display: flex;
  gap: 2px;
  position: absolute;
  right: 4px;
  top: 2px;
  z-index: 5;
}

/* SF28.4: drag grip + hide stacked in a column on the left edge. */
.waveform-view__side-actions {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 2px;
  left: 2px;
  position: absolute;
  top: 2px;
  z-index: 5;
}

.waveform-view__actions .q-btn,
.waveform-view__side-actions .q-btn {
  color: #cbd5e1;
  opacity: 0.6;
}

.waveform-view__actions .q-btn:hover,
.waveform-view__side-actions .q-btn:hover {
  opacity: 1;
}

.waveform-view__grip {
  color: #cbd5e1;
  cursor: grab;
  opacity: 0.6;
}

.waveform-view__grip:hover {
  opacity: 1;
}

.waveform-view__grip:active {
  cursor: grabbing;
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
