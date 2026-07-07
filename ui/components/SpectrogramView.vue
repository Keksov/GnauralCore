<template>
  <div class="spectrogram-view" :style="rootStyle">
    <canvas
      ref="canvasEl"
      class="spectrogram-view__canvas"
      role="img"
      tabindex="0"
      :aria-label="t('audio.spectrogramCanvasLabel')"
      :class="{ 'spectrogram-view__canvas--seekable': seekable }"
      @wheel.prevent="onWheel"
      @click="onClick"
      @dblclick="onDoubleClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    />
    <!-- SF16.3 + SF17.1: right-click zoom popover — presets ×1..×16 + a live % field. -->
    <q-menu context-menu touch-position v-model="zoomMenuOpen">
      <!-- SF17.1: close on Esc. keydown + .stop.prevent so Escape closes ONLY this popover
           and does not reach the global window keydown handler / any enclosing q-dialog. -->
      <div class="spectrogram-view__zoom-menu" @keydown.esc.stop.prevent="zoomMenuOpen = false">
        <div class="spectrogram-view__zoom-header">
          <div class="spectrogram-view__zoom-title">{{ t('audio.spectrogramZoomTitle') }}</div>
          <q-btn
            dense flat round size="sm"
            icon="close"
            v-close-popup
            :aria-label="t('audio.spectrogramZoomClose')"
          />
        </div>
        <div class="spectrogram-view__zoom-presets">
          <q-btn
            v-for="p in ZOOM_PRESETS"
            :key="p"
            dense flat no-caps
            :label="'×' + p"
            v-close-popup
            @click="applyZoomFactor(p)"
          />
        </div>
        <q-input
          v-model.number="zoomPercentInput"
          type="number"
          dense outlined
          autofocus
          suffix="%"
          :min="100"
          class="spectrogram-view__zoom-input"
          @keyup.enter="applyZoomPercent"
        />
        <!-- SF17.1: Применить as an explicit full-width primary button. -->
        <q-btn
          class="spectrogram-view__zoom-apply"
          unelevated
          color="primary"
          no-caps
          :label="t('audio.spectrogramZoomApply')"
          @click="applyZoomPercent"
        />
      </div>
    </q-menu>
    <!-- SF10.2: channel label as a top-left overlay on the plot, same place for L and R -->
    <span v-if="label" class="spectrogram-view__label-overlay">{{ label }}</span>
    <!-- SF27: waveform-overlay gear opens this track's overlay colour/scale settings. -->
    <q-btn
      v-if="waveformOverlay"
      dense flat round size="xs"
      icon="settings"
      class="spectrogram-view__wf-gear"
      :aria-label="t('audio.waveformStyle')"
      @click.stop="emit('open-settings')"
    >
      <q-tooltip>{{ t('audio.waveformStyle') }}</q-tooltip>
    </q-btn>
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
    <!-- SF19.3: view-change refetch shows a tiny corner spinner only (no dim / no message);
         the current frame stays visible and the new one swaps in when ready. -->
    <div
      v-else-if="isFetchingTiles"
      class="spectrogram-view__fetching"
      role="status"
      aria-live="polite"
      :aria-label="t('audio.spectrogramPreparing')"
    >
      <q-spinner color="cyan-4" size="18px" />
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
import { useAudioModel } from '../composables/use-audio-model'
import { amplitudeToDb } from '../composables/audio-model'
import { peaksToColumns, type WaveformScale } from '../composables/waveform-render'
import { tileToImage, type SpectrogramRenderOptions } from '../composables/spectrogram-render'
import {
  areaQueryBounds,
  formatHz,
  formatTimeSec,
  frequencyAtFraction,
  frequencyAxisTicks,
  timeAxisTicksWithMinor,
} from '../composables/spectrogram-axes'
import {
  fractionToTime,
  fullWindow,
  MIN_WINDOW_SEC,
  panWindow,
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
  /** SF17.4: per-tile FFT window override for high-zoom sharpening (0 = analysis window).
      Fetches sharper tiles for the visible window only — no whole-track reconfigure. */
  windowOverride?: number
  /** SF22.3: overlay the waveform (of `waveformBuffer` channel `waveformChannel`) on the plot. */
  waveformOverlay?: boolean
  waveformBuffer?: AudioBuffer | null
  waveformScale?: WaveformScale
  waveformChannel?: number
  /** SF23.2: overlay colour + opacity. */
  waveformColor?: string
  waveformOpacity?: number
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
  (event: 'open-settings'): void
}>()

// SF8.1: stacked tracks (stereo L/R) share one time window + area selection so they
// zoom/pan/select together. AudioPage provides these reactive refs; standalone use
// falls back to per-view internal state.
// SF15.1: a visible frequency window as bin-axis fractions [lo, hi] in [0,1] (0 = lowest
// freq / bottom, 1 = highest / top). Default full range {0,1}. Enables Audacity-style
// vertical (frequency) zoom/pan. Shared so stacked stereo tracks zoom freq together.
interface FreqWindow {
  readonly lo: number
  readonly hi: number
}
const FULL_FREQ: FreqWindow = { lo: 0, hi: 1 }
const MIN_FREQ_SPAN = 0.02

interface SpectrogramSharedState {
  readonly view: import('vue').Ref<TimeWindow | null>
  readonly selection: import('vue').Ref<SpectrogramSelection | null>
  readonly commitSeq: import('vue').Ref<number>
  readonly freqView?: import('vue').Ref<FreqWindow | null>
}
const shared = inject<SpectrogramSharedState | null>('spectrogramShared', null)
const { t } = useI18n()

// SF9: track resize (mutual divider + uniform bottom handle) now lives in the AudioPage
// stack (SF-D19/D20); this view just takes `height` as a plain prop.
const canvasEl = ref<HTMLCanvasElement | null>(null)
// SF19.2: longer idle debounce so a fast scroll/zoom burst coalesces to the settled view
// (intermediate frames the user scrolls past are never fetched); the SF11.9 cross-zoom
// fallback keeps the plot responsive meanwhile.
const spec = useSpectrogram({ refetchDebounceMs: 200 })

// SF22.3: optional waveform overlay (audio model + memoized peak columns for the visible view).
const wfModel = useAudioModel(computed(() => props.waveformBuffer ?? null))
let wfCacheSig = ''
let wfCacheColumns = peaksToColumns([], 'linear')
function drawWaveformOverlay(
  ctx: CanvasRenderingContext2D,
  plotX: number,
  plotY: number,
  plotW: number,
  plotH: number,
  win: TimeWindow,
): void {
  if (props.waveformOverlay !== true) return
  const info = wfModel.info.value
  if (info === null) return
  const scale: WaveformScale = props.waveformScale ?? 'linear'
  const ch = props.waveformChannel ?? 0
  const sig = `${win.startSec}|${win.endSec}|${plotW}|${scale}|${ch}|${info.length}`
  if (sig !== wfCacheSig) {
    wfCacheColumns = peaksToColumns(wfModel.peaks(win.startSec, win.endSec, plotW, ch), scale)
    wfCacheSig = sig
  }
  const cols = wfCacheColumns
  const n = cols.length
  if (n === 0) return
  const centerY = plotY + plotH / 2
  const halfH = (plotH / 2) * 0.92
  ctx.save()
  ctx.beginPath()
  ctx.rect(plotX, plotY, plotW, plotH)
  ctx.clip()
  ctx.globalAlpha = props.waveformOpacity ?? 0.55
  ctx.strokeStyle = props.waveformColor ?? '#67e8f9'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const c = cols[i]!
    const x = plotX + (i / n) * plotW + 0.5
    ctx.moveTo(x, centerY - c.maxU * halfH)
    ctx.lineTo(x, centerY - c.minU * halfH)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.restore()
}

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

// SF15.1: shared frequency window (or per-view fallback).
const internalFreqView = ref<FreqWindow>(FULL_FREQ)
const freqView = computed<FreqWindow>({
  get: () => shared?.freqView?.value ?? internalFreqView.value,
  set: (v) => {
    if (shared?.freqView) shared.freqView.value = v
    else internalFreqView.value = v
  },
})

// Zoom the freq window about an anchor (0 = bottom, 1 = top); factor<1 zooms in.
function zoomFreq(aFactor: number, aAnchorBottom: number): void {
  const cur = freqView.value
  const span = Math.max(MIN_FREQ_SPAN, cur.hi - cur.lo)
  const anchor = cur.lo + Math.min(1, Math.max(0, aAnchorBottom)) * span
  let newSpan = Math.min(1, Math.max(MIN_FREQ_SPAN, span * aFactor))
  let lo = anchor - Math.min(1, Math.max(0, aAnchorBottom)) * newSpan
  if (lo < 0) lo = 0
  if (lo + newSpan > 1) lo = 1 - newSpan
  if (lo < 0) { lo = 0; newSpan = 1 }
  freqView.value = { lo, hi: lo + newSpan }
}
// Pan the freq window by a fraction delta (clamped to [0,1]).
function panFreq(aDelta: number): void {
  const cur = freqView.value
  const span = cur.hi - cur.lo
  let lo = cur.lo + aDelta
  if (lo < 0) lo = 0
  if (lo + span > 1) lo = 1 - span
  freqView.value = { lo, hi: lo + span }
}

const hasAnalysis = computed(() => spec.analysis.value !== null)
// SF19.3: full overlay only for the initial prepare; a view-change refetch shows just a
// tiny corner spinner while the new frame loads in the background.
const isPreparing = computed(() => spec.preparing.value)
const isFetchingTiles = computed(() => spec.fetchingTiles.value)
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
  const fv = freqView.value

  // Draw the tiles (if any). Axes are drawn regardless so an analysis with no tiles
  // yet still shows the framed plot rather than a fully blank panel.
  if (tiles.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(plotX, plotY, plotW, plotH)
    ctx.clip()
    // SF17.2: sharp = nearest-neighbour (crisp pixels at high zoom); smooth = bilinear.
    ctx.imageSmoothingEnabled = props.render?.imageScaling !== 'sharp'
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
      // SF15.1: crop the tile vertically to the visible frequency window (image row 0 =
      // highest freq, so [lo,hi] bottom-fractions map to rows [(1-hi)H, (1-lo)H]).
      const sy = (1 - fv.hi) * image.height
      const sh = Math.max(1, (fv.hi - fv.lo) * image.height)
      ctx.drawImage(off, 0, sy, image.width, sh, x, plotY, Math.ceil(w) + 1, plotH)
    }
    ctx.restore()
  }

  // SF22.3: waveform overlay on top of the tiles (below the axes/playhead).
  drawWaveformOverlay(ctx, plotX, plotY, plotW, plotH, win)

  drawAxes(ctx, plotX, plotY, plotW, plotH, sliceFreq(tiles[0]?.binFrequenciesHz ?? [], fv), win.startSec, win.endSec)

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
  // SF16.6: Audacity-style ruler — denser labelled majors (~1 per 90px) + short minor ticks.
  ctx.textAlign = 'center'
  const targetMajor = Math.max(4, Math.min(14, Math.round(plotW / 90)))
  const { major, minor, majorStep } = timeAxisTicksWithMinor(timeStartSec, timeEndSec, targetMajor)
  const tickX = (position: number): number =>
    Math.min(plotX + plotW - 1, Math.max(plotX, plotX + position * plotW))
  const drawTimeRuler = (edgeY: number, dir: number, baseline: CanvasTextBaseline): void => {
    // SF25: brighter + taller ticks so the ruler reads clearly over the dark plot.
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    // minor ticks (short, unlabelled)
    for (const tick of minor) {
      const x = tickX(tick.position)
      ctx.beginPath()
      ctx.moveTo(x, edgeY)
      ctx.lineTo(x, edgeY + dir * 3)
      ctx.stroke()
    }
    // major ticks (long) + labels
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
  if (props.showTimeAxisBottom) drawTimeRuler(plotY + plotH, 1, 'top')
  if (props.showTimeAxisTop) drawTimeRuler(plotY, -1, 'bottom')
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
    // SF17.4: per-tile FFT window override (high-zoom sharpening; 0 = none).
    windowOverride: props.windowOverride ?? 0,
  })
}


// SF15.1: Audacity-style wheel navigation (see the gesture table in the component doc):
//   wheel / Ctrl+wheel      -> TIME zoom about the pointer
//   Shift+wheel             -> TIME pan (scroll left/right)
//   Alt+wheel               -> FREQUENCY zoom about the pointer
//   Alt+Shift+wheel         -> FREQUENCY pan (scroll up/down)
function onWheel(aEvent: WheelEvent): void {
  if (!hasAnalysis.value) return
  const canvas = canvasEl.value
  if (canvas === null) return
  const plotW = plotColumns(canvas)
  const plotH = Math.max(1, Math.floor(canvas.clientHeight) - marginTop() - marginBottom())
  const xAnchor = Math.min(1, Math.max(0, (aEvent.offsetX - AXIS_MARGIN.left) / plotW))
  const yTop = Math.min(1, Math.max(0, (aEvent.offsetY - marginTop()) / plotH))
  const zoomIn = aEvent.deltaY < 0
  const zoomFactor = zoomIn ? 0.8 : 1.25

  if (aEvent.altKey && aEvent.shiftKey) {
    // frequency pan: scroll up -> move to higher frequencies.
    panFreq((zoomIn ? 1 : -1) * 0.15 * (freqView.value.hi - freqView.value.lo))
  } else if (aEvent.altKey) {
    // frequency zoom about the pointer (yTop 0 = top -> anchorBottom = 1 - yTop).
    zoomFreq(zoomFactor, 1 - yTop)
  } else if (aEvent.shiftKey) {
    // time pan: scroll down -> later.
    const winWidth = view.value.endSec - view.value.startSec
    view.value = panWindow(view.value, (zoomIn ? -1 : 1) * 0.15 * winWidth, duration.value)
  } else {
    // time zoom about the pointer (plain wheel or Ctrl+wheel).
    view.value = zoomWindow(view.value, zoomFactor, xAnchor, duration.value)
  }
}

// SF15.1: double-click resets both time and frequency zoom to the full view.
function onDoubleClick(): void {
  suppressClick = true
  view.value = fullWindow(duration.value)
  freqView.value = FULL_FREQ
}

// SF16.4 + SF19.1 + SF21: Audacity-style keyboard navigation. Exposed as `handleNavKey`
// and driven by the AudioPage window keydown handler when focus isn't in another control
// (so the keys work anywhere in the window, not only when the canvas is focused).
//   Left/Right       -> move the PLAYBACK POSITION (seek) by ±1 s;
//   Shift+Left/Right -> seek by ±5 s;
//   Alt+Left/Right   -> pan the view by ~15% of the visible span (the old arrow behaviour);
//   Home/End         -> scroll the view to the clip start/end (keep the current span).
const SEEK_STEP_SEC = 1
const SEEK_STEP_SEC_LARGE = 5

// Keep the playhead visible: if a seek moves it outside the current window, pan the view
// so it sits just inside the nearer edge (Audacity-style follow).
function followPlayhead(aSec: number): void {
  const win = view.value
  const margin = (win.endSec - win.startSec) * 0.1
  if (aSec < win.startSec) view.value = panWindow(win, aSec - margin - win.startSec, duration.value)
  else if (aSec > win.endSec) view.value = panWindow(win, aSec + margin - win.endSec, duration.value)
}

function seekBy(aDeltaSec: number): void {
  const dur = duration.value
  const from = props.playheadSec ?? view.value.startSec
  const next = Math.max(0, Math.min(dur, from + aDeltaSec))
  emit('seek', next)
  followPlayhead(next)
}

function onKeyDown(aEvent: KeyboardEvent): void {
  if (!hasAnalysis.value) return
  const span = view.value.endSec - view.value.startSec
  const dur = duration.value
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
      return // let other keys through unhandled
  }
  aEvent.preventDefault()
}

// SF21: let AudioPage's global keydown handler drive navigation (see onKeyDown).
defineExpose({ handleNavKey: onKeyDown })

// SF16.3: zoom preset popover (right-click). Zoom ×N shows a span of duration/N about the
// view centre; ×1 (100%) = the whole clip. The % field shows and sets the current zoom.
const ZOOM_PRESETS = [1, 2, 3, 4, 8, 16] as const
const zoomMenuOpen = ref(false)
const zoomPercentInput = ref(100)

const currentZoomPercent = computed(() => {
  const span = view.value.endSec - view.value.startSec
  if (duration.value <= 0 || span <= 0) return 100
  return Math.round((duration.value / span) * 100)
})

function applyZoomFactor(aFactor: number): void {
  const dur = duration.value
  if (dur <= 0 || aFactor <= 0) return
  const span = Math.min(dur, Math.max(MIN_WINDOW_SEC, dur / aFactor))
  const center = (view.value.startSec + view.value.endSec) / 2
  const start = Math.min(Math.max(0, center - span / 2), Math.max(0, dur - span))
  view.value = { startSec: start, endSec: start + span }
}

function applyZoomPercent(): void {
  const pct = Math.max(100, Number(zoomPercentInput.value) || 100)
  applyZoomFactor(pct / 100)
  zoomMenuOpen.value = false
}

// Seed the % field with the live zoom whenever the menu opens.
watch(zoomMenuOpen, (aOpen) => {
  if (aOpen) zoomPercentInput.value = currentZoomPercent.value
})

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
    let text = `${formatTimeSec(h.timeSec)} · ${formatHz(h.freqHz)} Hz · ${h.db.toFixed(1)} dB`
    // SF22.4: unified readout — also query the audio model (amplitude) at the cursor.
    if (wfModel.info.value !== null) {
      const amp = wfModel.sampleAt(h.timeSec, props.waveformChannel ?? 0)
      text += ` · amp ${amp.toFixed(3)} (${amplitudeToDb(amp).toFixed(1)} dBFS)`
    }
    return text
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

// SF15.1: the sub-range of binFrequenciesHz visible under the current freq window
// (index 0 = lowest freq). Used to label the frequency axis for the zoomed range.
function sliceFreq(aBinFreqs: readonly number[], aFreqView: FreqWindow): readonly number[] {
  const n = aBinFreqs.length
  if (n === 0 || (aFreqView.lo <= 0 && aFreqView.hi >= 1)) return aBinFreqs
  const lo = Math.max(0, Math.floor(aFreqView.lo * (n - 1)))
  const hi = Math.min(n - 1, Math.ceil(aFreqView.hi * (n - 1)))
  return hi > lo ? aBinFreqs.slice(lo, hi + 1) : aBinFreqs
}
// SF15.1: map a plot y-fraction (0 = top) through the freq window to a full-axis
// top-fraction (0 = highest freq), for point/area queries.
function freqTopFraction(aYTop: number): number {
  const fv = freqView.value
  return (1 - fv.hi) + clamp01(aYTop) * (fv.hi - fv.lo)
}

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
  if (aEvent.button !== 0) return // SF16.3: ignore right/middle button (right-click = zoom menu)
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
  const freqHz = frequencyAtFraction(freqTopFraction(f.yTopFraction), spec.tiles.value[0]?.binFrequenciesHz ?? [])
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
  // SF15.1: the selection's top fractions are plot-relative — map them through the freq
  // window to full-axis top-fractions before the query.
  const bounds = areaQueryBounds(
    { timeSec: sel.timeStartSec, topFraction: freqTopFraction(sel.topLo) },
    { timeSec: sel.timeEndSec, topFraction: freqTopFraction(sel.topHi) },
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

// SF15.1: frequency zoom/pan changes only the vertical crop + axis -> redraw, no refetch.
watch(freqView, () => {
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

// SF17.4: high-zoom window override changed -> re-apply the view so the composable
// refetches sharp tiles for the visible window (no reconfigure, no whole-track pass).
watch(() => props.windowOverride, () => {
  applyView()
})

// SF22.3: waveform overlay toggles/inputs -> redraw.
watch(
  () => [props.waveformOverlay, props.waveformScale, props.waveformChannel, props.waveformBuffer, props.waveformColor, props.waveformOpacity],
  () => scheduleDraw(),
)

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

/* SF19.3: unobtrusive background-fetch hint — no backdrop, top-right corner. */
.spectrogram-view__fetching {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 5;
  opacity: 0.7;
  pointer-events: none;
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

/* SF27: waveform-overlay settings gear, top-right corner. */
.spectrogram-view__wf-gear {
  color: #cbd5e1;
  opacity: 0.6;
  position: absolute;
  right: 4px;
  top: 2px;
  z-index: 5;
}

.spectrogram-view__wf-gear:hover {
  opacity: 1;
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

/* SF16.3: right-click zoom popover. */
.spectrogram-view__zoom-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  padding: 10px 12px;
}

.spectrogram-view__zoom-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.spectrogram-view__zoom-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
}

.spectrogram-view__zoom-apply {
  margin-top: 2px;
}

.spectrogram-view__zoom-presets {
  display: grid;
  gap: 4px;
  grid-template-columns: repeat(3, 1fr);
}

.spectrogram-view__zoom-input {
  margin-top: 2px;
}

/* SF16.4: the canvas is keyboard-focusable (tabindex) for Home/End/arrow nav. */
.spectrogram-view__canvas:focus {
  outline: none;
}

.spectrogram-view__canvas:focus-visible {
  outline: 1px solid rgba(148, 163, 184, 0.6);
  outline-offset: -1px;
}
</style>
