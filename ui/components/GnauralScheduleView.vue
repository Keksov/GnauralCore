<template>
  <div
    class="gnaural-schedule-view"
    :class="{
      'gnaural-schedule-view--overlay-layout': layoutMode === 'overlay',
      'gnaural-schedule-view--tracks-layout': layoutMode === 'tracks',
    }"
  >
    <div class="gnaural-schedule-view__toolbar">
      <div class="gnaural-schedule-view__toolbar-leading">
        <div v-if="$slots.transportControls" class="gnaural-schedule-view__toolbar-slot">
          <slot name="transportControls" />
        </div>
      </div>

      <div class="gnaural-schedule-view__toolbar-actions">
        <q-btn
          flat
          color="primary"
          icon="visibility"
          :label="t('audio.scheduleAllVoicesOn')"
          :disable="trackStateBusy"
          @click="showAllVoices"
        />
        <q-btn
          flat
          color="primary"
          icon="visibility_off"
          :label="t('audio.scheduleAllVoicesOff')"
          :disable="trackStateBusy"
          @click="hideAllVoices"
        />
        <q-btn flat color="primary" icon="fit_screen" :label="t('audio.scheduleResetView')" @click="resetView" />
        <q-btn
          flat
          color="primary"
          icon="queue_music"
          :label="t('audio.scheduleTracksTitle')"
          class="gnaural-schedule-view__toolbar-tracks-toggle"
          :class="{ 'gnaural-schedule-view__toolbar-tracks-toggle--active': trackPanelOpen }"
          :aria-label="trackPanelOpen ? t('audio.scheduleTracksHide') : t('audio.scheduleTracksShow')"
          :aria-expanded="trackPanelOpen"
          aria-controls="gnaural-schedule-tracks-panel"
          @click="toggleTrackPanel"
        />
      </div>
    </div>

    <div class="gnaural-schedule-view__content">
      <transition name="gnaural-schedule-settings-backdrop">
        <div
          v-if="settingsPanelOpen"
          class="gnaural-schedule-view__settings-backdrop"
          aria-hidden="true"
          @click="closeSettingsPanel"
        />
      </transition>

      <transition name="gnaural-schedule-settings-panel">
        <aside
          v-if="settingsPanelOpen"
          id="gnaural-schedule-settings-panel"
          class="gnaural-schedule-view__settings-panel"
          role="dialog"
          aria-modal="false"
          :aria-label="t('audio.scheduleSettingsTitle')"
        >
          <div class="gnaural-schedule-view__settings-panel-header">
            <div class="gnaural-schedule-view__settings-heading">
              <div class="gnaural-schedule-view__settings-title">{{ t('audio.scheduleSettingsTitle') }}</div>
              <div class="gnaural-schedule-view__settings-subtitle">{{ t('audio.scheduleSettingsSubtitle') }}</div>
            </div>

            <q-btn
              flat
              round
              dense
              color="primary"
              icon="close"
              :aria-label="t('audio.scheduleSettingsClose')"
              @click="closeSettingsPanel"
            />
          </div>

          <div class="gnaural-schedule-view__settings-panel-body">
            <section class="gnaural-schedule-view__settings-section">
              <div class="gnaural-schedule-view__settings-label">{{ t('audio.scheduleLayoutLabel') }}</div>
              <q-select
                v-model="layoutMode"
                dense
                outlined
                behavior="menu"
                emit-value
                map-options
                options-dense
                dropdown-icon="arrow_drop_down"
                class="gnaural-schedule-view__toolbar-select"
                :options="layoutOptions"
                options-selected-class="gnaural-schedule-view__select-option--selected"
                popup-content-class="gnaural-schedule-view__select-menu"
              />
            </section>

            <section class="gnaural-schedule-view__settings-section">
              <div class="gnaural-schedule-view__settings-label">{{ t('audio.scheduleScaleLabel') }}</div>
              <q-select
                v-model="scaleMode"
                dense
                outlined
                behavior="menu"
                emit-value
                map-options
                options-dense
                dropdown-icon="arrow_drop_down"
                class="gnaural-schedule-view__toolbar-select"
                :options="scaleOptions"
                options-selected-class="gnaural-schedule-view__select-option--selected"
                popup-content-class="gnaural-schedule-view__select-menu"
              />
            </section>
          </div>
        </aside>
      </transition>

      <div
        ref="canvasHostEl"
        class="gnaural-schedule-view__canvas-column"
        :style="canvasHostStyle"
        tabindex="0"
        role="group"
        :aria-label="t('audio.scheduleCanvasLabel')"
        aria-keyshortcuts="+, -, ArrowLeft, ArrowRight"
        @keydown="handleKeyDown"
      >
        <div
          class="gnaural-schedule-view__canvas-scroll-host"
          :class="{ 'gnaural-schedule-view__canvas-scroll-host--tracks-scroll': layoutMode === 'tracks' }"
        >
          <div class="gnaural-schedule-view__canvas-host">
            <canvas
              ref="mainCanvasEl"
              class="gnaural-schedule-view__main-canvas"
              role="img"
              :aria-label="t('audio.scheduleCanvasLabel')"
              @wheel.prevent="handleMainWheel"
              @pointerdown="handleMainPointerDown"
            />
            <div v-if="visibleVoices.length === 0" class="gnaural-schedule-view__empty">
              {{ t('audio.scheduleNoVisibleVoices') }}
            </div>
          </div>
        </div>

        <div class="gnaural-schedule-view__minimap-wrap">
          <canvas
            ref="minimapCanvasEl"
            class="gnaural-schedule-view__minimap-canvas"
            role="img"
            :aria-label="t('audio.scheduleMinimapLabel')"
            :style="{ cursor: minimapCursor }"
            @pointerdown="handleMinimapPointerDown"
            @pointermove="handleMinimapPointerMove"
            @pointerleave="handleMinimapPointerLeave"
          />

          <div class="gnaural-schedule-view__overlay-controls">
            <q-btn
              class="gnaural-schedule-view__overlay-settings-toggle"
              :class="{ 'gnaural-schedule-view__overlay-settings-toggle--active': settingsPanelOpen }"
              dense
              round
              size="xs"
              color="primary"
              text-color="white"
              icon="settings"
              :aria-label="t('audio.scheduleSettingsOpen')"
              :title="t('audio.scheduleSettingsOpen')"
              aria-controls="gnaural-schedule-settings-panel"
              @click="toggleSettingsPanel"
            />
          </div>
        </div>
      </div>

      <aside
        v-if="trackPanelOpen"
        id="gnaural-schedule-tracks-panel"
        class="gnaural-schedule-view__tracks-panel"
        role="complementary"
        :aria-label="t('audio.scheduleTracksTitle')"
      >
        <div class="gnaural-schedule-view__tracks-panel-header">
          <div class="gnaural-schedule-view__tracks-heading">
            <div class="gnaural-schedule-view__tracks-title">{{ t('audio.scheduleTracksTitle') }}</div>
            <div class="gnaural-schedule-view__tracks-subtitle">{{ t('audio.scheduleTracksSubtitle', { count: voices.length }) }}</div>
          </div>
          <q-btn
            flat
            round
            dense
            color="primary"
            icon="close"
            :aria-label="t('audio.scheduleTracksHide')"
            @click="closeTrackPanel"
          />
        </div>

        <div class="gnaural-schedule-view__tracks-panel-body">
          <div v-if="voices.length === 0" class="gnaural-schedule-view__tracks-empty">
            {{ t('audio.scheduleTracksEmpty') }}
          </div>
          <div v-else class="gnaural-schedule-view__track-list">
            <article
              v-for="voice in voices"
              :key="voice.id"
              class="gnaural-schedule-view__track-card"
              :class="{
                'gnaural-schedule-view__track-card--hidden': voice.hidden,
                'gnaural-schedule-view__track-card--muted': voice.muted,
              }"
            >
              <div class="gnaural-schedule-view__track-card-row">
                <div class="gnaural-schedule-view__track-copy">
                  <div class="gnaural-schedule-view__track-title" :title="formatVoiceLabel(voice)">
                    <span class="gnaural-schedule-view__track-name">{{ formatVoiceName(voice) }}</span>
                    <span class="gnaural-schedule-view__track-type">({{ voice.type }})</span>
                    <span v-if="voice.description.trim() !== ''" class="gnaural-schedule-view__track-description">
                      - {{ voice.description }}
                    </span>
                  </div>
                </div>

                <div class="gnaural-schedule-view__track-controls">
                  <q-btn
                    dense
                    flat
                    no-caps
                    color="primary"
                    class="gnaural-schedule-view__track-action-btn"
                    :disable="trackStateBusy"
                    :icon="voice.hidden ? 'visibility' : 'visibility_off'"
                    :label="voice.hidden ? t('audio.scheduleTrackShow') : t('audio.scheduleTrackHide')"
                    @click="toggleVoiceHidden(voice)"
                  />
                  <q-btn
                    dense
                    flat
                    no-caps
                    color="primary"
                    class="gnaural-schedule-view__track-action-btn"
                    :disable="trackStateBusy"
                    :icon="voice.muted ? 'volume_up' : 'volume_off'"
                    :label="voice.muted ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute')"
                    @click="toggleVoiceMuted(voice)"
                  />
                  <input
                    type="color"
                    class="gnaural-schedule-view__track-color-input"
                    :value="colorInputValue(voice)"
                    :disabled="trackStateBusy"
                    :aria-label="`${t('audio.scheduleTrackColor')}: ${formatVoiceLabel(voice)}`"
                    @change="handleVoiceColorChange(voice, $event)"
                  >
                </div>
              </div>
            </article>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { AudioTransportState, GnauralScheduleData, GnauralScheduleEntry, GnauralScheduleVoice } from '@protocol'
import { useI18n } from 'vue-i18n'

type LayoutMode = 'overlay' | 'tracks'
type ScaleMode = 'log' | 'linear'
type PointerMode = 'idle' | 'main' | 'minimap'
type MinimapPointerAction = 'pan' | 'resize-start' | 'resize-end'
type MinimapPointerTarget = 'axis' | 'track' | 'viewport' | 'resize-start' | 'resize-end'

interface VoiceStatePatch {
  readonly voiceId: number
  readonly hidden?: boolean
  readonly muted?: boolean
  readonly color?: string
}

interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface FrequencyRange {
  readonly min: number
  readonly max: number
}

interface MinimapLayout {
  readonly axisRect: Rect
  readonly plotRect: Rect
}

interface TimeViewportPayload {
  readonly startSec: number
  readonly endSec: number
}

const VOICE_BASE_COLORS = [
  '#0f766e',
  '#f59e0b',
  '#2563eb',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#65a30d',
  '#ea580c',
] as const
const TONAL_VOICE_TYPES = new Set<GnauralScheduleVoice['type']>([
  'binaural',
  'iso_pulse',
  'iso_pulse_alt',
])
const WATER_ACTIVITY_VOICE_TYPES = new Set<GnauralScheduleVoice['type']>([
  'rain',
  'waterdrops',
])
const BROADBAND_VOICE_TYPES = new Set<GnauralScheduleVoice['type']>([
  'pink_noise',
  'pcm',
])
const MAIN_BG = '#f8fafc'
const PANEL_BG = '#ffffff'
const MINIMAP_BG = '#e2e8f0'
const GRID_COLOR = 'rgba(15, 23, 42, 0.08)'
const AXIS_COLOR = 'rgba(15, 23, 42, 0.2)'
const AXIS_TEXT_COLOR = '#475569'
const LABEL_TEXT_COLOR = '#0f172a'
const CURSOR_COLOR = '#dc2626'
const VIEWPORT_COLOR = 'rgba(37, 99, 235, 0.14)'
const VIEWPORT_STROKE = 'rgba(37, 99, 235, 0.72)'
const MIN_VISIBLE_DURATION_SEC = 0.01
const DEFAULT_MAIN_CANVAS_MIN_HEIGHT = 360
const FREQ_PANEL_RATIO = 0.75
const TRACK_GAP = 25
const PANEL_GAP = 10
const MINIMAP_HANDLE_WIDTH_PX = 12
const MINIMAP_HANDLE_HIT_SLOP_PX = 10
const MINIMAP_MIN_VIEWPORT_WIDTH_PX = 28
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i
const MAIN_PLOT_LEFT_GUTTER = 44
const MAIN_PLOT_RIGHT_GUTTER = 44
const MAIN_PLOT_TOP_GUTTER = 20
const MAIN_PLOT_BOTTOM_GUTTER = 14
const MINIMAP_AXIS_TOP_PADDING_PX = 2
const MINIMAP_AXIS_HEIGHT_PX = 12
const MINIMAP_AXIS_GAP_PX = 2
const MINIMAP_PLOT_BOTTOM_PADDING_PX = 6
const MINIMAP_AXIS_MAJOR_TICK_HEIGHT_PX = 5
const MINIMAP_AXIS_MINOR_TICK_HEIGHT_PX = 3
const MINIMAP_AXIS_MAJOR_TICK_COLOR = '#334155'
const MINIMAP_AXIS_MINOR_TICK_COLOR = 'rgba(71, 85, 105, 0.55)'
const MINIMAP_AXIS_LABEL_MIN_SPACING_PX = 14
const AXIS_LABEL_EDGE_CLEARANCE_PX = 5
const AXIS_LABEL_MIN_SPACING_PX = 14
const WATER_ACTIVITY_GRID_VALUES = [0, 0.5, 1] as const
const TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT = 60
const TRACK_MODE_MIN_VOLUME_PANEL_HEIGHT = 36
const TRACK_MODE_MIN_FREQUENCY_TICK_SPACING_PX = 2
const TIME_TICK_STEP_CANDIDATES = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200] as const
const STORAGE_SCHEDULE_LAYOUT_MODE = 'schedule-layout-mode'
const STORAGE_SCHEDULE_SCALE_MODE = 'schedule-scale-mode'
const STORAGE_SCHEDULE_TRACK_PANEL_OPEN = 'schedule-track-panel-open'

function buildStorageKey(scope: string, key: string): string {
  return `mindwave-audio-${scope}-${key}`
}

function loadStoredLayoutMode(scope: string): LayoutMode {
  try {
    return localStorage.getItem(buildStorageKey(scope, STORAGE_SCHEDULE_LAYOUT_MODE)) === 'tracks' ? 'tracks' : 'overlay'
  } catch {
    return 'overlay'
  }
}

function loadStoredScaleMode(scope: string): ScaleMode {
  try {
    return localStorage.getItem(buildStorageKey(scope, STORAGE_SCHEDULE_SCALE_MODE)) === 'linear' ? 'linear' : 'log'
  } catch {
    return 'log'
  }
}

function saveStoredLayoutMode(scope: string, value: LayoutMode): void {
  try {
    localStorage.setItem(buildStorageKey(scope, STORAGE_SCHEDULE_LAYOUT_MODE), value)
  } catch {
    // Ignore localStorage failures.
  }
}

function saveStoredScaleMode(scope: string, value: ScaleMode): void {
  try {
    localStorage.setItem(buildStorageKey(scope, STORAGE_SCHEDULE_SCALE_MODE), value)
  } catch {
    // Ignore localStorage failures.
  }
}

function loadStoredTrackPanelOpen(scope: string): boolean {
  try {
    return localStorage.getItem(buildStorageKey(scope, STORAGE_SCHEDULE_TRACK_PANEL_OPEN)) !== '0'
  } catch {
    return true
  }
}

function saveStoredTrackPanelOpen(scope: string, value: boolean): void {
  try {
    localStorage.setItem(buildStorageKey(scope, STORAGE_SCHEDULE_TRACK_PANEL_OPEN), value ? '1' : '0')
  } catch {
    // Ignore localStorage failures.
  }
}

const props = defineProps<{
  readonly schedule: GnauralScheduleData | null
  readonly filePath: string | null
  readonly positionSec: number
  readonly transportState: AudioTransportState
  readonly trackStateBusy: boolean
  readonly canSeek: boolean
  readonly uiStateScope?: string
  readonly timeViewportStartSec?: number | null
  readonly timeViewportEndSec?: number | null
}>()

const emit = defineEmits<{
  seek: [positionSec: number]
  'patch-voice-state': [patch: VoiceStatePatch]
  'patch-voice-state-batch': [patches: readonly VoiceStatePatch[]]
  'update:time-viewport': [viewport: TimeViewportPayload]
}>()

const { t } = useI18n()
const uiStateScope = computed(() => {
  const rawScope = props.uiStateScope?.trim()
  return rawScope && rawScope.length > 0 ? rawScope : 'default'
})
const canvasHostEl = ref<HTMLDivElement | null>(null)
const mainCanvasEl = ref<HTMLCanvasElement | null>(null)
const minimapCanvasEl = ref<HTMLCanvasElement | null>(null)

const layoutMode = ref<LayoutMode>(loadStoredLayoutMode(uiStateScope.value))
const scaleMode = ref<ScaleMode>(loadStoredScaleMode(uiStateScope.value))
const settingsPanelOpen = ref(false)
const frequencyZoom = ref(1)
const trackPanelOpen = ref(loadStoredTrackPanelOpen(uiStateScope.value))
const timeViewport = reactive({ startSec: 0, endSec: 1 })
const ctrlKeyPressed = ref(false)
const minimapPointerInside = ref(false)
const minimapHoverTarget = ref<MinimapPointerTarget>('track')
const pointerState = reactive({
  active: false,
  mode: 'idle' as PointerMode,
  minimapAction: 'pan' as MinimapPointerAction,
  startX: 0,
  moved: false,
  dragOffsetSec: 0,
  viewportStart: 0,
  viewportEnd: 1,
})

const minimapSeekMode = computed(() => {
  return props.canSeek
    && minimapPointerInside.value
    && ctrlKeyPressed.value
    && !(pointerState.active && pointerState.mode === 'minimap')
})

let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null

const layoutOptions = computed(() => {
  return [
    { label: t('audio.scheduleLayoutOverlay'), value: 'overlay' },
    { label: t('audio.scheduleLayoutTracks'), value: 'tracks' },
  ] satisfies Array<{ readonly label: string, readonly value: LayoutMode }>
})

const scaleOptions = computed(() => {
  return [
    { label: t('audio.scheduleScaleLog'), value: 'log' },
    { label: t('audio.scheduleScaleLinear'), value: 'linear' },
  ] satisfies Array<{ readonly label: string, readonly value: ScaleMode }>
})

const voices = computed<readonly GnauralScheduleVoice[]>(() => {
  return props.schedule?.voices ?? []
})

const visibleVoices = computed<readonly GnauralScheduleVoice[]>(() => {
  return voices.value.filter((voice: GnauralScheduleVoice) => !voice.hidden)
})

const visibleTonalVoices = computed<readonly GnauralScheduleVoice[]>(() => {
  return visibleVoices.value.filter((voice: GnauralScheduleVoice) => voiceHasTonalFrequencyCurve(voice))
})

const visibleWaterActivityVoices = computed(() => {
  return visibleVoices.value.filter((voice) => voiceUsesWaterActivityPanel(voice))
})

const visibleBroadbandVoices = computed(() => {
  return visibleVoices.value.filter((voice) => voiceIsBroadband(voice))
})

const overlayUsesWaterActivityPanel = computed(() => {
  return visibleTonalVoices.value.length === 0 && visibleWaterActivityVoices.value.length > 0
})

const overlayUsesBroadbandPanel = computed(() => {
  return visibleTonalVoices.value.length === 0
    && visibleWaterActivityVoices.value.length === 0
    && visibleBroadbandVoices.value.length > 0
})

const minimumTrackModePlotHeight = computed(() => {
  if (layoutMode.value !== 'tracks' || visibleVoices.value.length === 0) {
    return 0
  }

  return visibleVoices.value.reduce((height, voice, index) => {
    return height + getMinimumTrackBlockHeight(voice) + (index > 0 ? TRACK_GAP : 0)
  }, 0)
})

const canvasHostStyle = computed((): Record<string, string> => {
  const defaultTrackModePlotHeight = DEFAULT_MAIN_CANVAS_MIN_HEIGHT - MAIN_PLOT_TOP_GUTTER - MAIN_PLOT_BOTTOM_GUTTER
  if (minimumTrackModePlotHeight.value <= defaultTrackModePlotHeight) {
    return {}
  }

  const minimumMainCanvasHeight = minimumTrackModePlotHeight.value + MAIN_PLOT_TOP_GUTTER + MAIN_PLOT_BOTTOM_GUTTER

  return {
    '--gnaural-main-canvas-min-height': `${Math.max(DEFAULT_MAIN_CANVAS_MIN_HEIGHT, minimumMainCanvasHeight)}px`,
  }
})

const minimapCursor = computed(() => {
  if (minimapSeekMode.value) {
    return 'crosshair'
  }

  const target: MinimapPointerTarget | MinimapPointerAction = pointerState.active && pointerState.mode === 'minimap'
    ? pointerState.minimapAction
    : minimapHoverTarget.value

  if (target === 'resize-start' || target === 'resize-end') {
    return 'ew-resize'
  }

  if (target === 'viewport' || target === 'pan') {
    return pointerState.active && pointerState.mode === 'minimap' ? 'grabbing' : 'grab'
  }

  return 'pointer'
})

function withAlpha(color: string, alpha: number): string {
  const normalized = color.replace('#', '')
  if (normalized.length !== 6) {
    return color
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function fallbackColorForVoiceId(voiceId: number): string {
  const voiceIndex = voices.value.findIndex((voice) => voice.id === voiceId)
  if (voiceIndex < 0) {
    return VOICE_BASE_COLORS[0]
  }

  return VOICE_BASE_COLORS[voiceIndex % VOICE_BASE_COLORS.length]
}

function colorForVoice(voice: GnauralScheduleVoice): string {
  if (voice.color !== null && HEX_COLOR_PATTERN.test(voice.color)) {
    return voice.color.toUpperCase()
  }

  return fallbackColorForVoiceId(voice.id)
}

function colorInputValue(voice: GnauralScheduleVoice): string {
  return colorForVoice(voice)
}

function voiceHasTonalFrequencyCurve(voice: GnauralScheduleVoice): boolean {
  return TONAL_VOICE_TYPES.has(voice.type)
}

function voiceUsesWaterActivityPanel(voice: GnauralScheduleVoice): boolean {
  return WATER_ACTIVITY_VOICE_TYPES.has(voice.type)
}

function voiceIsBroadband(voice: GnauralScheduleVoice): boolean {
  return BROADBAND_VOICE_TYPES.has(voice.type)
}

function formatUnitInterval(value: number): string {
  if (value === 0 || value === 1) {
    return value.toFixed(0)
  }

  return value.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '')
}

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerp(startValue: number, endValue: number, ratio: number): number {
  return startValue + (endValue - startValue) * ratio
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453123
  return value - Math.floor(value)
}

function normalizeWaterDropCount(beatHalf: number): number {
  const dropCount = Math.max(2, Math.min(100, beatHalf * 2))
  return Math.log1p(dropCount) / Math.log1p(100)
}

function normalizeWaterTriggerThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return Math.min(1, Math.sqrt(value))
}

function getEntryAverageVolume(entry: GnauralScheduleEntry): number {
  return clampUnitInterval(
    (entry.volLStart + entry.volLEnd + entry.volRStart + entry.volREnd) / 4,
  )
}

function getWaterActivityLevel(baseFreq: number, beatHalf: number, volume: number): number {
  const triggerLevel = normalizeWaterTriggerThreshold(baseFreq)
  const concurrencyLevel = normalizeWaterDropCount(beatHalf)
  const loudnessLevel = clampUnitInterval(volume)

  return clampUnitInterval(
    Math.max(
      triggerLevel * 0.75 + concurrencyLevel * 0.25,
      loudnessLevel * 0.55,
      concurrencyLevel * 0.3,
    ),
  )
}

function getWaterEntryMetrics(entry: GnauralScheduleEntry): {
  readonly activityStart: number
  readonly activityEnd: number
  readonly concurrencyStart: number
  readonly concurrencyEnd: number
} {
  const volumeStart = clampUnitInterval((entry.volLStart + entry.volRStart) / 2)
  const volumeEnd = clampUnitInterval((entry.volLEnd + entry.volREnd) / 2)
  const concurrencyStart = normalizeWaterDropCount(entry.beatFreqHalfStart)
  const concurrencyEnd = normalizeWaterDropCount(entry.beatFreqHalfEnd)

  return {
    activityStart: getWaterActivityLevel(entry.baseFreqStart, entry.beatFreqHalfStart, volumeStart),
    activityEnd: getWaterActivityLevel(entry.baseFreqEnd, entry.beatFreqHalfEnd, volumeEnd),
    concurrencyStart,
    concurrencyEnd,
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '00:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatFrequency(value: number): string {
  if (!Number.isFinite(value)) {
    return ''
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  }

  if (value >= 100) {
    return `${Math.round(value)}`
  }

  return value.toFixed(1)
}

function formatVoiceLabel(voice: GnauralScheduleVoice): string {
  const baseLabel = `${formatVoiceName(voice)} (${voice.type})`

  if (voice.description.trim() === '') {
    return baseLabel
  }

  return `${baseLabel} - ${voice.description}`
}

function formatVoiceName(voice: GnauralScheduleVoice): string {
  return t('audio.voiceIndexLabel', {
    index: voice.id + 1,
  })
}

function toggleVoiceHidden(voice: GnauralScheduleVoice): void {
  emitVoiceStatePatch({
    voiceId: voice.id,
    hidden: !voice.hidden,
  })
}

function toggleVoiceMuted(voice: GnauralScheduleVoice): void {
  emitVoiceStatePatch({
    voiceId: voice.id,
    muted: !voice.muted,
  })
}

function handleVoiceColorChange(voice: GnauralScheduleVoice, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  emitVoiceStatePatch({
    voiceId: voice.id,
    color: target.value.toUpperCase(),
  })
}

function getTotalTimeSec(): number {
  return Math.max(props.schedule?.totalTimeSec ?? 0, 1)
}

function getVisibleDurationSec(): number {
  return Math.max(timeViewport.endSec - timeViewport.startSec, MIN_VISIBLE_DURATION_SEC)
}

function setTimeViewport(startSec: number, durationSec: number): boolean {
  const totalTimeSec = getTotalTimeSec()
  const clampedDuration = Math.min(Math.max(durationSec, MIN_VISIBLE_DURATION_SEC), totalTimeSec)
  const maxStartSec = Math.max(0, totalTimeSec - clampedDuration)
  const clampedStartSec = Math.min(Math.max(startSec, 0), maxStartSec)
  const nextEndSec = clampedStartSec + clampedDuration
  const didChange = Math.abs(timeViewport.startSec - clampedStartSec) > 0.0001
    || Math.abs(timeViewport.endSec - nextEndSec) > 0.0001

  if (!didChange) {
    return false
  }

  timeViewport.startSec = clampedStartSec
  timeViewport.endSec = nextEndSec
  emit('update:time-viewport', {
    startSec: timeViewport.startSec,
    endSec: timeViewport.endSec,
  })
  return true
}

function panTimeViewport(deltaSec: number): void {
  setTimeViewport(timeViewport.startSec + deltaSec, getVisibleDurationSec())
}

function zoomTimeViewport(factor: number, anchorSec: number): void {
  const visibleDurationSec = getVisibleDurationSec()
  const nextDurationSec = visibleDurationSec * factor
  const anchorRatio = (anchorSec - timeViewport.startSec) / visibleDurationSec
  const nextStartSec = anchorSec - nextDurationSec * anchorRatio
  setTimeViewport(nextStartSec, nextDurationSec)
}

function resetView(): void {
  frequencyZoom.value = 1
  setTimeViewport(0, getTotalTimeSec())
}

function normalizeExternalTimeViewport(
  startSec: number | null | undefined,
  endSec: number | null | undefined,
): TimeViewportPayload | null {
  if (props.schedule === null) {
    return null
  }

  if (
    typeof startSec !== 'number'
    || typeof endSec !== 'number'
    || !Number.isFinite(startSec)
    || !Number.isFinite(endSec)
  ) {
    return null
  }

  const totalTimeSec = getTotalTimeSec()
  const clampedStartSec = Math.min(Math.max(0, startSec), totalTimeSec)
  const clampedEndSec = Math.min(
    Math.max(clampedStartSec + MIN_VISIBLE_DURATION_SEC, endSec),
    totalTimeSec,
  )

  return {
    startSec: clampedStartSec,
    endSec: clampedEndSec,
  }
}

function closeTrackPanel(): void {
  trackPanelOpen.value = false
}

function toggleTrackPanel(): void {
  trackPanelOpen.value = !trackPanelOpen.value
}

function emitVoiceStatePatch(patch: VoiceStatePatch): void {
  emit('patch-voice-state', patch)
}

function showAllVoices(): void {
  const patches = voices.value
    .filter((voice: GnauralScheduleVoice) => voice.hidden)
    .map((voice: GnauralScheduleVoice) => ({
      voiceId: voice.id,
      hidden: false,
    }))

  if (patches.length > 0) {
    emit('patch-voice-state-batch', patches)
  }
}

function hideAllVoices(): void {
  const patches = voices.value
    .filter((voice: GnauralScheduleVoice) => !voice.hidden)
    .map((voice: GnauralScheduleVoice) => ({
      voiceId: voice.id,
      hidden: true,
    }))

  if (patches.length > 0) {
    emit('patch-voice-state-batch', patches)
  }
}

function isRenderableFrequency(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false
  }

  return scaleMode.value === 'log' ? value > 0 : value >= 0
}

function collectVoiceFrequencyRange(voice: GnauralScheduleVoice): FrequencyRange | null {
  if (!voiceHasTonalFrequencyCurve(voice)) {
    return null
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const entry of voice.entries) {
    const values = [
      entry.baseFreqStart - entry.beatFreqHalfStart,
      entry.baseFreqStart + entry.beatFreqHalfStart,
      entry.baseFreqEnd - entry.beatFreqHalfEnd,
      entry.baseFreqEnd + entry.beatFreqHalfEnd,
      entry.baseFreqStart,
      entry.baseFreqEnd,
    ]

    for (const value of values) {
      if (!isRenderableFrequency(value)) {
        continue
      }

      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null
  }

  if (max <= min) {
    max = min + (scaleMode.value === 'log' ? min * 0.25 : 10)
  }

  if (scaleMode.value === 'linear') {
    min = Math.max(0, min)
  }

  return { min, max }
}

function applyFrequencyZoom(range: FrequencyRange | null): FrequencyRange | null {
  if (range === null) {
    return null
  }

  if (scaleMode.value === 'log') {
    const safeMin = Math.max(range.min, 1)
    const safeMax = Math.max(range.max, safeMin * 1.2)
    const minLog = Math.log10(safeMin)
    const maxLog = Math.log10(safeMax)
    const centerLog = (minLog + maxLog) / 2
    const halfSpanLog = (maxLog - minLog) / (2 * frequencyZoom.value)
    return {
      min: Math.pow(10, centerLog - halfSpanLog),
      max: Math.pow(10, centerLog + halfSpanLog),
    }
  }

  const center = (range.min + range.max) / 2
  const halfSpan = (range.max - range.min) / (2 * frequencyZoom.value)
  return {
    min: Math.max(0, center - halfSpan),
    max: center + halfSpan,
  }
}

function getOverlayFrequencyRange(): FrequencyRange | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const voice of visibleVoices.value) {
    const voiceRange = collectVoiceFrequencyRange(voice)
    if (voiceRange === null) {
      continue
    }

    min = Math.min(min, voiceRange.min)
    max = Math.max(max, voiceRange.max)
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null
  }

  return applyFrequencyZoom({ min, max })
}

function getTrackFrequencyRange(voice: GnauralScheduleVoice): FrequencyRange | null {
  return applyFrequencyZoom(collectVoiceFrequencyRange(voice))
}

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const context = canvas.getContext('2d')
  if (context === null) {
    return null
  }

  const pixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(width * pixelRatio))
  canvas.height = Math.max(1, Math.floor(height * pixelRatio))
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  return context
}

function getHorizontalPlotGeometry(width: number): { readonly left: number, readonly width: number } {
  return {
    left: MAIN_PLOT_LEFT_GUTTER,
    width: Math.max(1, width - MAIN_PLOT_LEFT_GUTTER - MAIN_PLOT_RIGHT_GUTTER),
  }
}

function getCanvasLogicalWidth(context: CanvasRenderingContext2D): number {
  const pixelRatio = window.devicePixelRatio || 1
  return context.canvas.width / pixelRatio
}

function getMainPlotRect(width: number, height: number): Rect {
  const horizontal = getHorizontalPlotGeometry(width)
  const top = MAIN_PLOT_TOP_GUTTER
  const bottom = MAIN_PLOT_BOTTOM_GUTTER

  return {
    left: horizontal.left,
    top,
    width: horizontal.width,
    height: Math.max(1, height - top - bottom),
  }
}

function getMinimapLayout(width: number, height: number): MinimapLayout {
  const horizontal = getHorizontalPlotGeometry(width)
  const axisTop = MINIMAP_AXIS_TOP_PADDING_PX
  const axisHeight = MINIMAP_AXIS_HEIGHT_PX
  const plotTop = axisTop + axisHeight + MINIMAP_AXIS_GAP_PX

  return {
    axisRect: {
      left: horizontal.left,
      top: axisTop,
      width: horizontal.width,
      height: axisHeight,
    },
    plotRect: {
      left: horizontal.left,
      top: plotTop,
      width: horizontal.width,
      height: Math.max(1, height - plotTop - MINIMAP_PLOT_BOTTOM_PADDING_PX),
    },
  }
}

function getMinimapPlotRect(width: number, height: number): Rect {
  return getMinimapLayout(width, height).plotRect
}

function minimapXToTime(rect: Rect, x: number): number {
  return ((x - rect.left) / Math.max(1, rect.width)) * getTotalTimeSec()
}

function timeToMinimapX(rect: Rect, timeSec: number): number {
  return rect.left + (timeSec / getTotalTimeSec()) * rect.width
}

function getMinimapViewportRect(plotRect: Rect): Rect {
  return {
    left: timeToMinimapX(plotRect, timeViewport.startSec),
    top: plotRect.top,
    width: (getVisibleDurationSec() / getTotalTimeSec()) * plotRect.width,
    height: plotRect.height,
  }
}

function getMinimapMinimumDurationSec(plotRect: Rect): number {
  return Math.max(
    MIN_VISIBLE_DURATION_SEC,
    (MINIMAP_MIN_VIEWPORT_WIDTH_PX / Math.max(1, plotRect.width)) * getTotalTimeSec(),
  )
}

function getMinimapPointerTarget(layout: MinimapLayout, localX: number, localY: number): MinimapPointerTarget {
  const plotRect = layout.plotRect
  const clampedX = Math.max(plotRect.left, Math.min(plotRect.left + plotRect.width, localX))

  if (localY < plotRect.top) {
    return 'axis'
  }

  const viewportRect = getMinimapViewportRect(plotRect)
  const viewportRight = viewportRect.left + viewportRect.width
  const distanceToLeft = Math.abs(clampedX - viewportRect.left)
  const distanceToRight = Math.abs(clampedX - viewportRight)

  if (distanceToLeft <= MINIMAP_HANDLE_HIT_SLOP_PX || distanceToRight <= MINIMAP_HANDLE_HIT_SLOP_PX) {
    return distanceToLeft <= distanceToRight ? 'resize-start' : 'resize-end'
  }

  if (clampedX >= viewportRect.left && clampedX <= viewportRight) {
    return 'viewport'
  }

  return 'track'
}

function drawMinimapViewportHandle(
  context: CanvasRenderingContext2D,
  plotRect: Rect,
  centerX: number,
  handleWidth: number,
): void {
  const clampedLeft = Math.max(
    plotRect.left,
    Math.min(centerX - handleWidth / 2, plotRect.left + plotRect.width - handleWidth),
  )
  const top = plotRect.top + 4
  const height = Math.max(16, plotRect.height - 8)

  context.fillStyle = '#ffffff'
  context.strokeStyle = VIEWPORT_STROKE
  context.lineWidth = 1
  context.fillRect(clampedLeft, top, handleWidth, height)
  context.strokeRect(clampedLeft + 0.5, top + 0.5, Math.max(1, handleWidth - 1), Math.max(1, height - 1))

  context.strokeStyle = 'rgba(37, 99, 235, 0.48)'
  context.lineWidth = 1
  const gripCenter = clampedLeft + handleWidth / 2
  const gripTop = top + 4
  const gripBottom = top + height - 4

  context.beginPath()
  context.moveTo(gripCenter - 1.5, gripTop)
  context.lineTo(gripCenter - 1.5, gripBottom)
  context.moveTo(gripCenter + 1.5, gripTop)
  context.lineTo(gripCenter + 1.5, gripBottom)
  context.stroke()
}

function getOverlayPanelRects(plotRect: Rect): { readonly freqRect: Rect, readonly volumeRect: Rect } {
  const freqHeight = Math.max(80, (plotRect.height - PANEL_GAP) * FREQ_PANEL_RATIO)
  const volumeHeight = Math.max(48, plotRect.height - freqHeight - PANEL_GAP)

  return {
    freqRect: {
      left: plotRect.left,
      top: plotRect.top,
      width: plotRect.width,
      height: freqHeight,
    },
    volumeRect: {
      left: plotRect.left,
      top: plotRect.top + freqHeight + PANEL_GAP,
      width: plotRect.width,
      height: volumeHeight,
    },
  }
}

function getFrequencyTickValues(range: FrequencyRange): readonly number[] {
  return scaleMode.value === 'log' ? getLogTicks(range) : getLinearTicks(range)
}

function getFrequencyValueRatio(value: number, range: FrequencyRange): number {
  if (scaleMode.value === 'log') {
    const safeValue = Math.max(value, range.min)
    const minLog = Math.log10(range.min)
    const maxLog = Math.log10(range.max)
    const valueLog = Math.log10(safeValue)
    return (valueLog - minLog) / Math.max(0.0001, maxLog - minLog)
  }

  return (value - range.min) / Math.max(0.0001, range.max - range.min)
}

function getMinimumTrackFrequencyPanelHeight(range: FrequencyRange | null): number {
  if (range === null) {
    return TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT
  }

  const ticks = getFrequencyTickValues(range)
  if (ticks.length < 2) {
    return TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT
  }

  let minimumRatioDistance = Number.POSITIVE_INFINITY

  for (let index = 1; index < ticks.length; index += 1) {
    const previousRatio = getFrequencyValueRatio(ticks[index - 1], range)
    const currentRatio = getFrequencyValueRatio(ticks[index], range)
    const ratioDistance = Math.abs(currentRatio - previousRatio)

    if (ratioDistance > 0) {
      minimumRatioDistance = Math.min(minimumRatioDistance, ratioDistance)
    }
  }

  if (!Number.isFinite(minimumRatioDistance) || minimumRatioDistance <= 0) {
    return TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT
  }

  return Math.max(
    TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT,
    Math.ceil(TRACK_MODE_MIN_FREQUENCY_TICK_SPACING_PX / minimumRatioDistance),
  )
}

function getMinimumTrackBlockHeight(voice: GnauralScheduleVoice): number {
  const minimumFrequencyPanelHeight = getMinimumTrackFrequencyPanelHeight(getTrackFrequencyRange(voice))

  return Math.max(
    minimumFrequencyPanelHeight + PANEL_GAP + TRACK_MODE_MIN_VOLUME_PANEL_HEIGHT,
    Math.ceil(minimumFrequencyPanelHeight / FREQ_PANEL_RATIO + PANEL_GAP),
  )
}

function getTrackPanelRects(plotRect: Rect, index: number, count: number): { readonly freqRect: Rect, readonly volumeRect: Rect, readonly trackRect: Rect } {
  const trackHeight = (plotRect.height - Math.max(0, count - 1) * TRACK_GAP) / count
  const trackTop = plotRect.top + index * (trackHeight + TRACK_GAP)
  const freqHeight = Math.max(TRACK_MODE_MIN_FREQUENCY_PANEL_HEIGHT, (trackHeight - PANEL_GAP) * FREQ_PANEL_RATIO)
  const volumeHeight = Math.max(TRACK_MODE_MIN_VOLUME_PANEL_HEIGHT, trackHeight - freqHeight - PANEL_GAP)

  return {
    trackRect: {
      left: plotRect.left,
      top: trackTop,
      width: plotRect.width,
      height: trackHeight,
    },
    freqRect: {
      left: plotRect.left,
      top: trackTop,
      width: plotRect.width,
      height: freqHeight,
    },
    volumeRect: {
      left: plotRect.left,
      top: trackTop + freqHeight + PANEL_GAP,
      width: plotRect.width,
      height: volumeHeight,
    },
  }
}

function clipRect(context: CanvasRenderingContext2D, rect: Rect): void {
  context.beginPath()
  context.rect(rect.left, rect.top, rect.width, rect.height)
  context.clip()
}

function timeToX(rect: Rect, timeSec: number): number {
  const visibleDurationSec = getVisibleDurationSec()
  return rect.left + ((timeSec - timeViewport.startSec) / visibleDurationSec) * rect.width
}

function xToTime(rect: Rect, x: number): number {
  const ratio = rect.width <= 0 ? 0 : (x - rect.left) / rect.width
  return timeViewport.startSec + Math.max(0, Math.min(1, ratio)) * getVisibleDurationSec()
}

function frequencyToY(rect: Rect, value: number, range: FrequencyRange): number {
  if (scaleMode.value === 'log') {
    const safeValue = Math.max(value, range.min)
    const minLog = Math.log10(range.min)
    const maxLog = Math.log10(range.max)
    const valueLog = Math.log10(safeValue)
    const ratio = (valueLog - minLog) / Math.max(0.0001, maxLog - minLog)
    return rect.top + rect.height - ratio * rect.height
  }

  const ratio = (value - range.min) / Math.max(0.0001, range.max - range.min)
  return rect.top + rect.height - ratio * rect.height
}

function volumeToY(rect: Rect, value: number): number {
  const clampedValue = Math.max(0, Math.min(1, value))
  return rect.top + rect.height - clampedValue * rect.height
}

function drawPanelFrame(context: CanvasRenderingContext2D, rect: Rect): void {
  context.fillStyle = PANEL_BG
  context.fillRect(rect.left, rect.top, rect.width, rect.height)
  context.strokeStyle = AXIS_COLOR
  context.lineWidth = 1
  context.strokeRect(rect.left + 0.5, rect.top + 0.5, rect.width - 1, rect.height - 1)
}

function drawAxisValueLabels(
  context: CanvasRenderingContext2D,
  rect: Rect,
  labels: readonly { readonly y: number, readonly text: string }[],
): void {
  const sortedLabels = [...labels].sort((left, right) => left.y - right.y)
  const visibleLabels = sortedLabels.length <= 2
    ? sortedLabels
    : (() => {
        const selectedLabels = [sortedLabels[0]]
        const lastLabel = sortedLabels[sortedLabels.length - 1]

        for (let index = 1; index < sortedLabels.length - 1; index += 1) {
          const label = sortedLabels[index]
          const previousVisibleLabel = selectedLabels[selectedLabels.length - 1]

          if (
            label.y - previousVisibleLabel.y >= AXIS_LABEL_MIN_SPACING_PX
            && lastLabel.y - label.y >= AXIS_LABEL_MIN_SPACING_PX
          ) {
            selectedLabels.push(label)
          }
        }

        selectedLabels.push(lastLabel)
        return selectedLabels
      })()

  context.save()
  context.font = '11px ui-sans-serif, system-ui, sans-serif'
  context.fillStyle = AXIS_TEXT_COLOR
  context.textBaseline = 'middle'
  const canvasWidth = getCanvasLogicalWidth(context)
  const leftLabelX = AXIS_LABEL_EDGE_CLEARANCE_PX
  const rightLabelX = canvasWidth - AXIS_LABEL_EDGE_CLEARANCE_PX

  for (const label of visibleLabels) {
    context.textAlign = 'left'
    context.fillText(label.text, leftLabelX, label.y)
    context.textAlign = 'right'
    context.fillText(label.text, rightLabelX, label.y)
  }

  context.restore()
}

function drawVolumeGrid(context: CanvasRenderingContext2D, rect: Rect): void {
  const labels = [0, 0.25, 0.5, 0.75, 1].map((value) => ({
    y: volumeToY(rect, value),
    text: value.toFixed(value === 0 || value === 1 ? 0 : 2),
  }))

  context.save()
  clipRect(context, rect)
  context.strokeStyle = GRID_COLOR
  context.lineWidth = 1

  for (const label of labels) {
    context.beginPath()
    context.moveTo(rect.left, label.y)
    context.lineTo(rect.left + rect.width, label.y)
    context.stroke()
  }

  context.restore()
  drawAxisValueLabels(context, rect, labels)
}

function drawWaterActivityGrid(context: CanvasRenderingContext2D, rect: Rect): void {
  const labels = WATER_ACTIVITY_GRID_VALUES.map((value) => ({
    y: volumeToY(rect, value),
    text: formatUnitInterval(value),
  }))

  context.save()
  clipRect(context, rect)
  context.strokeStyle = GRID_COLOR
  context.lineWidth = 1

  for (const label of labels) {
    context.beginPath()
    context.moveTo(rect.left, label.y)
    context.lineTo(rect.left + rect.width, label.y)
    context.stroke()
  }

  context.restore()
  drawAxisValueLabels(context, rect, labels)
}

function getLogTicks(range: FrequencyRange): number[] {
  const candidates = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000]
  return candidates.filter((value) => value >= range.min && value <= range.max)
}

function getLinearTicks(range: FrequencyRange): number[] {
  const tickCount = 6
  const ticks: number[] = []

  for (let index = 0; index < tickCount; index += 1) {
    ticks.push(range.min + ((range.max - range.min) * index) / (tickCount - 1))
  }

  return ticks
}

function drawFrequencyGrid(context: CanvasRenderingContext2D, rect: Rect, range: FrequencyRange | null): void {
  if (range === null) {
    return
  }

  const ticks = getFrequencyTickValues(range)
  const labels = ticks.map((tickValue) => ({
    y: frequencyToY(rect, tickValue, range),
    text: formatFrequency(tickValue),
  }))

  context.save()
  clipRect(context, rect)
  context.strokeStyle = GRID_COLOR
  context.lineWidth = 1

  for (const label of labels) {
    context.beginPath()
    context.moveTo(rect.left, label.y)
    context.lineTo(rect.left + rect.width, label.y)
    context.stroke()
  }

  context.restore()
  drawAxisValueLabels(context, rect, labels)
}

function getTimeTickStep(visibleDurationSec: number): number {
  return getTimeTickStepForCount(visibleDurationSec)
}

function getTimeTickStepForCount(durationSec: number, maxTickCount = 8): number {
  const normalizedMaxTickCount = Math.max(2, maxTickCount)

  for (const candidate of TIME_TICK_STEP_CANDIDATES) {
    if (durationSec / candidate <= normalizedMaxTickCount) {
      return candidate
    }
  }

  return TIME_TICK_STEP_CANDIDATES[TIME_TICK_STEP_CANDIDATES.length - 1]
}

function getTimeTickValues(startSec: number, endSec: number, maxTickCount = 8): number[] {
  const durationSec = Math.max(MIN_VISIBLE_DURATION_SEC, endSec - startSec)
  const stepSec = getTimeTickStepForCount(durationSec, maxTickCount)
  const firstTickSec = Math.floor(startSec / stepSec) * stepSec
  const tickValues: number[] = []

  for (let tickSec = firstTickSec; tickSec <= endSec + stepSec * 0.5; tickSec += stepSec) {
    const normalizedTickSec = Math.max(0, Number.parseFloat(tickSec.toFixed(6)))
    if (normalizedTickSec < startSec - stepSec * 0.5) {
      continue
    }

    tickValues.push(normalizedTickSec)
  }

  return tickValues
}

function getAdaptiveMinorTickCount(segmentWidthPx: number): number {
  if (segmentWidthPx >= 180) {
    return 3
  }

  if (segmentWidthPx >= 108) {
    return 2
  }

  if (segmentWidthPx >= 56) {
    return 1
  }

  return 0
}

function drawTimeGrid(context: CanvasRenderingContext2D, rect: Rect): void {
  const tickValues = getTimeTickValues(timeViewport.startSec, timeViewport.endSec)

  context.save()
  clipRect(context, rect)
  context.strokeStyle = GRID_COLOR
  context.lineWidth = 1

  for (const tickSec of tickValues) {
    const x = timeToX(rect, tickSec)
    context.beginPath()
    context.moveTo(x, rect.top)
    context.lineTo(x, rect.top + rect.height)
    context.stroke()
  }

  context.restore()
}

function getHorizontalTextBounds(
  context: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  align: 'left' | 'center' | 'right',
): { readonly left: number, readonly right: number } {
  const textWidth = context.measureText(text).width

  if (align === 'left') {
    return {
      left: anchorX,
      right: anchorX + textWidth,
    }
  }

  if (align === 'right') {
    return {
      left: anchorX - textWidth,
      right: anchorX,
    }
  }

  return {
    left: anchorX - textWidth / 2,
    right: anchorX + textWidth / 2,
  }
}

function getVisibleMinimapAxisInteriorTickValues(
  context: CanvasRenderingContext2D,
  plotRect: Rect,
  tickValues: readonly number[],
  leftEdgeLabelText: string,
  rightEdgeLabelText: string,
): number[] {
  const plotRight = plotRect.left + plotRect.width
  const leftEdgeBounds = getHorizontalTextBounds(context, leftEdgeLabelText, plotRect.left, 'left')
  const rightEdgeBounds = getHorizontalTextBounds(context, rightEdgeLabelText, plotRight, 'right')
  const minimumLabelLeft = leftEdgeBounds.right + MINIMAP_AXIS_LABEL_MIN_SPACING_PX
  const maximumLabelRight = rightEdgeBounds.left - MINIMAP_AXIS_LABEL_MIN_SPACING_PX

  if (maximumLabelRight <= minimumLabelLeft) {
    return []
  }

  const visibleTickValues: number[] = []
  let previousLabelRight = minimumLabelLeft

  for (const tickSec of tickValues) {
    const tickLabelText = formatTime(tickSec)
    const tickBounds = getHorizontalTextBounds(context, tickLabelText, timeToMinimapX(plotRect, tickSec), 'center')

    if (tickBounds.left < previousLabelRight || tickBounds.right > maximumLabelRight) {
      continue
    }

    visibleTickValues.push(tickSec)
    previousLabelRight = tickBounds.right + MINIMAP_AXIS_LABEL_MIN_SPACING_PX
  }

  return visibleTickValues
}

function drawMinimapTimeAxis(context: CanvasRenderingContext2D, axisRect: Rect, plotRect: Rect): void {
  const totalTimeSec = getTotalTimeSec()
  const totalLabelBudget = Math.max(2, Math.floor(plotRect.width / 64))
  const interiorTickValues = totalLabelBudget <= 2
    ? []
    : getTimeTickValues(0, totalTimeSec, totalLabelBudget - 1)
      .filter((tickSec) => tickSec > 0 && tickSec < totalTimeSec)
  const majorTickValues = [0, ...interiorTickValues, totalTimeSec]

  context.save()
  context.font = '600 10px ui-sans-serif, system-ui, sans-serif'
  context.fillStyle = AXIS_TEXT_COLOR
  context.strokeStyle = AXIS_COLOR
  context.lineWidth = 1
  context.textBaseline = 'top'
  context.lineCap = 'butt'
  const plotRight = plotRect.left + plotRect.width
  const axisY = plotRect.top - 0.5
  const leftEdgeLabelText = formatTime(0)
  const rightEdgeLabelText = formatTime(totalTimeSec)
  const visibleInteriorTickValues = getVisibleMinimapAxisInteriorTickValues(
    context,
    plotRect,
    interiorTickValues,
    leftEdgeLabelText,
    rightEdgeLabelText,
  )

  context.beginPath()
  context.moveTo(plotRect.left, axisY)
  context.lineTo(plotRight, axisY)
  context.stroke()

  context.strokeStyle = MINIMAP_AXIS_MINOR_TICK_COLOR
  for (let index = 0; index < majorTickValues.length - 1; index += 1) {
    const startX = timeToMinimapX(plotRect, majorTickValues[index])
    const endX = timeToMinimapX(plotRect, majorTickValues[index + 1])
    const minorTickCount = getAdaptiveMinorTickCount(endX - startX)

    for (let minorIndex = 1; minorIndex <= minorTickCount; minorIndex += 1) {
      const x = lerp(startX, endX, minorIndex / (minorTickCount + 1))

      context.beginPath()
      context.moveTo(x + 0.5, axisY)
      context.lineTo(x + 0.5, axisY - MINIMAP_AXIS_MINOR_TICK_HEIGHT_PX)
      context.stroke()
    }
  }

  context.strokeStyle = MINIMAP_AXIS_MAJOR_TICK_COLOR
  for (const tickSec of majorTickValues) {
    const x = timeToMinimapX(plotRect, tickSec)

    context.beginPath()
    context.moveTo(x + 0.5, axisY)
    context.lineTo(x + 0.5, axisY - MINIMAP_AXIS_MAJOR_TICK_HEIGHT_PX)
    context.stroke()
  }

  context.textAlign = 'left'
  context.fillText(leftEdgeLabelText, plotRect.left, axisRect.top)

  for (const tickSec of visibleInteriorTickValues) {
    const x = timeToMinimapX(plotRect, tickSec)

    context.textAlign = 'center'
    context.fillText(formatTime(tickSec), x, axisRect.top)
  }

  context.textAlign = 'right'
  context.fillText(rightEdgeLabelText, plotRight, axisRect.top)
  context.restore()
}

function drawFrequencyBand(context: CanvasRenderingContext2D, rect: Rect, entry: GnauralScheduleEntry, range: FrequencyRange, color: string): void {
  const lowerStart = scaleMode.value === 'log'
    ? Math.max(entry.baseFreqStart - entry.beatFreqHalfStart, range.min)
    : Math.max(0, entry.baseFreqStart - entry.beatFreqHalfStart)
  const lowerEnd = scaleMode.value === 'log'
    ? Math.max(entry.baseFreqEnd - entry.beatFreqHalfEnd, range.min)
    : Math.max(0, entry.baseFreqEnd - entry.beatFreqHalfEnd)
  const upperStart = scaleMode.value === 'log'
    ? Math.max(entry.baseFreqStart + entry.beatFreqHalfStart, range.min)
    : Math.max(0, entry.baseFreqStart + entry.beatFreqHalfStart)
  const upperEnd = scaleMode.value === 'log'
    ? Math.max(entry.baseFreqEnd + entry.beatFreqHalfEnd, range.min)
    : Math.max(0, entry.baseFreqEnd + entry.beatFreqHalfEnd)

  if (!Number.isFinite(upperStart) || !Number.isFinite(upperEnd)) {
    return
  }

  context.fillStyle = withAlpha(color, 0.18)
  context.beginPath()
  context.moveTo(timeToX(rect, entry.startSec), frequencyToY(rect, upperStart, range))
  context.lineTo(timeToX(rect, entry.endSec), frequencyToY(rect, upperEnd, range))
  context.lineTo(timeToX(rect, entry.endSec), frequencyToY(rect, lowerEnd, range))
  context.lineTo(timeToX(rect, entry.startSec), frequencyToY(rect, lowerStart, range))
  context.closePath()
  context.fill()
}

function drawBaseLine(context: CanvasRenderingContext2D, rect: Rect, entry: GnauralScheduleEntry, range: FrequencyRange, color: string): void {
  if (!isRenderableFrequency(entry.baseFreqStart) || !isRenderableFrequency(entry.baseFreqEnd)) {
    return
  }

  context.strokeStyle = color
  context.lineWidth = 1.35
  context.beginPath()
  context.moveTo(timeToX(rect, entry.startSec), frequencyToY(rect, entry.baseFreqStart, range))
  context.lineTo(timeToX(rect, entry.endSec), frequencyToY(rect, entry.baseFreqEnd, range))
  context.stroke()
}

function drawVolumeLayer(context: CanvasRenderingContext2D, rect: Rect, entry: GnauralScheduleEntry, startValue: number, endValue: number, color: string, alpha: number): void {
  const baselineY = rect.top + rect.height

  context.fillStyle = withAlpha(color, alpha)
  context.beginPath()
  context.moveTo(timeToX(rect, entry.startSec), baselineY)
  context.lineTo(timeToX(rect, entry.startSec), volumeToY(rect, startValue))
  context.lineTo(timeToX(rect, entry.endSec), volumeToY(rect, endValue))
  context.lineTo(timeToX(rect, entry.endSec), baselineY)
  context.closePath()
  context.fill()
}

function drawVolumeOutline(context: CanvasRenderingContext2D, rect: Rect, entry: GnauralScheduleEntry, startValue: number, endValue: number, color: string, alpha: number): void {
  context.strokeStyle = withAlpha(color, alpha)
  context.lineWidth = 1.1
  context.beginPath()
  context.moveTo(timeToX(rect, entry.startSec), volumeToY(rect, startValue))
  context.lineTo(timeToX(rect, entry.endSec), volumeToY(rect, endValue))
  context.stroke()
}

function drawPanelLabel(context: CanvasRenderingContext2D, rect: Rect, text: string): void {
  context.save()
  context.font = '600 12px ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'left'
  context.textBaseline = 'middle'

  const textWidth = context.measureText(text).width
  const labelLeft = rect.left + 8
  const labelTop = rect.top - 16
  const labelHeight = 16

  context.fillStyle = MAIN_BG
  context.fillRect(labelLeft - 5, labelTop, textWidth + 10, labelHeight)

  context.fillStyle = LABEL_TEXT_COLOR
  context.fillText(text, labelLeft, labelTop + labelHeight / 2)
  context.restore()
}

function drawNoFrequencyDataMessage(context: CanvasRenderingContext2D, rect: Rect): void {
  context.save()
  context.fillStyle = AXIS_TEXT_COLOR
  context.font = '12px ui-sans-serif, system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(t('audio.scheduleNoFrequencyData'), rect.left + rect.width / 2, rect.top + rect.height / 2)
  context.restore()
}

function drawWaterActivityTexture(
  context: CanvasRenderingContext2D,
  rect: Rect,
  voice: GnauralScheduleVoice,
  entry: GnauralScheduleEntry,
  entryIndex: number,
  activityStart: number,
  activityEnd: number,
  concurrencyStart: number,
  concurrencyEnd: number,
): void {
  const startX = timeToX(rect, entry.startSec)
  const endX = timeToX(rect, entry.endSec)
  const segmentWidth = Math.max(1, endX - startX)
  const averageActivity = (activityStart + activityEnd) / 2
  const averageConcurrency = (concurrencyStart + concurrencyEnd) / 2
  const densityFactor = 0.45 + averageActivity * 0.9 + averageConcurrency * 0.55
  const maxMarks = voice.type === 'rain' ? 140 : 72
  const markCount = Math.max(
    1,
    Math.min(
      maxMarks,
      Math.round((segmentWidth / (voice.type === 'rain' ? 20 : 46)) * densityFactor),
    ),
  )

  context.save()
  clipRect(context, rect)
  context.strokeStyle = withAlpha(colorForVoice(voice), voice.type === 'rain' ? 0.3 : 0.42)
  context.fillStyle = withAlpha(colorForVoice(voice), voice.type === 'rain' ? 0.16 : 0.28)
  context.lineCap = 'round'

  for (let markIndex = 0; markIndex < markCount; markIndex += 1) {
    const seedBase = (voice.id + 1) * 1000 + (entryIndex + 1) * 100 + markIndex
    const timeRatio = (markIndex + pseudoRandom(seedBase)) / markCount
    const x = lerp(startX, endX, timeRatio)
    const activity = lerp(activityStart, activityEnd, timeRatio)
    const concurrency = lerp(concurrencyStart, concurrencyEnd, timeRatio)
    const baseY = volumeToY(rect, activity)
    const verticalJitter = (pseudoRandom(seedBase + 1) - 0.5) * rect.height * 0.18 * (0.4 + concurrency)

    if (voice.type === 'rain') {
      const streakLength = 8 + concurrency * 18
      const streakTilt = 2 + pseudoRandom(seedBase + 2) * 5
      const startY = Math.max(rect.top + 2, baseY - streakLength * 0.65 + verticalJitter)
      const endY = Math.min(rect.top + rect.height - 2, startY + streakLength)

      context.lineWidth = 1 + concurrency * 1.4
      context.beginPath()
      context.moveTo(x, startY)
      context.lineTo(x + streakTilt, endY)
      context.stroke()
      continue
    }

    const radius = 1.8 + concurrency * 2.6 + pseudoRandom(seedBase + 3) * 1.2
    const dropletY = Math.max(rect.top + radius, Math.min(rect.top + rect.height - radius, baseY + verticalJitter))
    context.beginPath()
    context.ellipse(x, dropletY, radius * 0.72, radius, 0, 0, Math.PI * 2)
    context.fill()
  }

  context.restore()
}

function drawWaterActivityLayer(context: CanvasRenderingContext2D, rect: Rect, voice: GnauralScheduleVoice): void {
  const baseColor = colorForVoice(voice)

  context.save()
  clipRect(context, rect)

  for (const [entryIndex, entry] of voice.entries.entries()) {
    const { activityStart, activityEnd, concurrencyStart, concurrencyEnd } = getWaterEntryMetrics(entry)
    const startX = timeToX(rect, entry.startSec)
    const endX = timeToX(rect, entry.endSec)
    const activityStartY = volumeToY(rect, activityStart)
    const activityEndY = volumeToY(rect, activityEnd)
    const concurrencyStartY = volumeToY(rect, concurrencyStart)
    const concurrencyEndY = volumeToY(rect, concurrencyEnd)

    context.fillStyle = withAlpha(baseColor, voice.type === 'rain' ? 0.16 : 0.2)
    context.beginPath()
    context.moveTo(startX, rect.top + rect.height)
    context.lineTo(startX, activityStartY)
    context.lineTo(endX, activityEndY)
    context.lineTo(endX, rect.top + rect.height)
    context.closePath()
    context.fill()

    context.strokeStyle = withAlpha(baseColor, 0.88)
    context.lineWidth = 1.4
    context.beginPath()
    context.moveTo(startX, activityStartY)
    context.lineTo(endX, activityEndY)
    context.stroke()

    context.setLineDash([5, 5])
    context.strokeStyle = withAlpha(baseColor, 0.48)
    context.lineWidth = 1.1
    context.beginPath()
    context.moveTo(startX, concurrencyStartY)
    context.lineTo(endX, concurrencyEndY)
    context.stroke()
    context.setLineDash([])

    drawWaterActivityTexture(
      context,
      rect,
      voice,
      entry,
      entryIndex,
      activityStart,
      activityEnd,
      concurrencyStart,
      concurrencyEnd,
    )
  }

  context.restore()
}

function drawBroadbandLayer(context: CanvasRenderingContext2D, rect: Rect, voice: GnauralScheduleVoice): void {
  const baseColor = colorForVoice(voice)

  context.save()
  clipRect(context, rect)

  for (const entry of voice.entries) {
    const volStart = clampUnitInterval((entry.volLStart + entry.volRStart) / 2)
    const volEnd = clampUnitInterval((entry.volLEnd + entry.volREnd) / 2)
    const startX = timeToX(rect, entry.startSec)
    const endX = timeToX(rect, entry.endSec)

    context.fillStyle = withAlpha(baseColor, ((volStart + volEnd) / 2) * 0.14)
    context.fillRect(startX, rect.top, Math.max(1, endX - startX), rect.height)

    context.strokeStyle = withAlpha(baseColor, 0.72)
    context.lineWidth = 1.2
    context.beginPath()
    context.moveTo(startX, volumeToY(rect, volStart))
    context.lineTo(endX, volumeToY(rect, volEnd))
    context.stroke()
  }

  context.restore()
}

function drawVoiceFrequencyLayer(context: CanvasRenderingContext2D, rect: Rect, voice: GnauralScheduleVoice, range: FrequencyRange | null): void {
  if (!voiceHasTonalFrequencyCurve(voice) || range === null) {
    return
  }

  const baseColor = colorForVoice(voice)

  context.save()
  clipRect(context, rect)

  for (const entry of voice.entries) {
    drawFrequencyBand(context, rect, entry, range, baseColor)
  }

  for (const entry of voice.entries) {
    drawBaseLine(context, rect, entry, range, baseColor)
  }

  context.restore()
}

function drawVoiceVolumeLayer(context: CanvasRenderingContext2D, rect: Rect, voice: GnauralScheduleVoice): void {
  const baseColor = colorForVoice(voice)

  context.save()
  clipRect(context, rect)

  for (const entry of voice.entries) {
    drawVolumeLayer(context, rect, entry, entry.volLStart, entry.volLEnd, baseColor, 0.2)
    drawVolumeLayer(context, rect, entry, entry.volRStart, entry.volREnd, baseColor, 0.12)
  }

  for (const entry of voice.entries) {
    drawVolumeOutline(context, rect, entry, entry.volLStart, entry.volLEnd, baseColor, 0.72)
    drawVolumeOutline(context, rect, entry, entry.volRStart, entry.volREnd, baseColor, 0.42)
  }

  context.restore()
}

function drawOverlayMode(context: CanvasRenderingContext2D, plotRect: Rect): void {
  const { freqRect, volumeRect } = getOverlayPanelRects(plotRect)
  const range = getOverlayFrequencyRange()

  drawPanelFrame(context, freqRect)
  drawPanelFrame(context, volumeRect)
  if (overlayUsesWaterActivityPanel.value) {
    drawWaterActivityGrid(context, freqRect)
  } else if (overlayUsesBroadbandPanel.value) {
    drawVolumeGrid(context, freqRect)
  } else {
    drawFrequencyGrid(context, freqRect, range)
  }
  drawVolumeGrid(context, volumeRect)

  if (overlayUsesWaterActivityPanel.value) {
    for (const voice of visibleWaterActivityVoices.value) {
      drawWaterActivityLayer(context, freqRect, voice)
    }
  } else {
    for (const voice of visibleBroadbandVoices.value) {
      drawBroadbandLayer(context, freqRect, voice)
    }
    for (const voice of visibleTonalVoices.value) {
      drawVoiceFrequencyLayer(context, freqRect, voice, range)
    }
    for (const voice of visibleWaterActivityVoices.value) {
      drawWaterActivityLayer(context, freqRect, voice)
    }
  }

  if (!overlayUsesWaterActivityPanel.value && !overlayUsesBroadbandPanel.value && (visibleTonalVoices.value.length === 0 || range === null)) {
    drawNoFrequencyDataMessage(context, freqRect)
  }

  for (const voice of visibleVoices.value) {
    drawVoiceVolumeLayer(context, volumeRect, voice)
  }

  drawPanelLabel(context, freqRect, overlayUsesWaterActivityPanel.value ? t('audio.chartAxisActivity') : t('audio.chartAxisFrequency'))
  drawPanelLabel(context, volumeRect, t('audio.chartAxisVolume'))
}

function drawTrackMode(context: CanvasRenderingContext2D, plotRect: Rect): void {
  const trackCount = Math.max(1, visibleVoices.value.length)

  visibleVoices.value.forEach((voice: GnauralScheduleVoice, index: number) => {
    const { trackRect, freqRect, volumeRect } = getTrackPanelRects(plotRect, index, trackCount)
    const range = getTrackFrequencyRange(voice)

    drawPanelFrame(context, trackRect)
    drawPanelFrame(context, freqRect)
    drawPanelFrame(context, volumeRect)
    if (voiceUsesWaterActivityPanel(voice)) {
      drawWaterActivityGrid(context, freqRect)
    } else if (voiceIsBroadband(voice)) {
      drawVolumeGrid(context, freqRect)
    } else {
      drawFrequencyGrid(context, freqRect, range)
    }
    drawVolumeGrid(context, volumeRect)
    if (voiceUsesWaterActivityPanel(voice)) {
      drawWaterActivityLayer(context, freqRect, voice)
    } else if (voiceIsBroadband(voice)) {
      drawBroadbandLayer(context, freqRect, voice)
    } else {
      drawVoiceFrequencyLayer(context, freqRect, voice, range)
    }

    if (!voiceHasTonalFrequencyCurve(voice) && !voiceUsesWaterActivityPanel(voice) && !voiceIsBroadband(voice)) {
      drawNoFrequencyDataMessage(context, freqRect)
    } else if (voiceHasTonalFrequencyCurve(voice) && range === null) {
      drawNoFrequencyDataMessage(context, freqRect)
    }

    drawVoiceVolumeLayer(context, volumeRect, voice)

    context.fillStyle = LABEL_TEXT_COLOR
    context.font = '600 12px ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'top'
    context.fillText(formatVoiceLabel(voice), trackRect.left + 8, trackRect.top + 6)
  })
}

function drawPlaybackCursor(context: CanvasRenderingContext2D, plotRect: Rect): void {
  if (props.positionSec < timeViewport.startSec || props.positionSec > timeViewport.endSec) {
    return
  }

  const x = timeToX(plotRect, props.positionSec)
  context.strokeStyle = CURSOR_COLOR
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(x, plotRect.top)
  context.lineTo(x, plotRect.top + plotRect.height)
  context.stroke()
}

function renderMainCanvas(): void {
  const canvas = mainCanvasEl.value
  if (canvas === null) {
    return
  }

  const width = Math.max(1, Math.floor(canvas.clientWidth))
  const height = Math.max(1, Math.floor(canvas.clientHeight))
  const context = setupCanvas(canvas, width, height)
  if (context === null) {
    return
  }

  context.fillStyle = MAIN_BG
  context.fillRect(0, 0, width, height)

  if (props.schedule === null) {
    return
  }

  const plotRect = getMainPlotRect(width, height)
  drawTimeGrid(context, plotRect)

  if (layoutMode.value === 'overlay') {
    drawOverlayMode(context, plotRect)
  } else {
    drawTrackMode(context, plotRect)
  }

  drawPlaybackCursor(context, plotRect)
}

function renderMinimapCanvas(): void {
  const canvas = minimapCanvasEl.value
  if (canvas === null) {
    return
  }

  const width = Math.max(1, Math.floor(canvas.clientWidth))
  const height = Math.max(1, Math.floor(canvas.clientHeight))
  const context = setupCanvas(canvas, width, height)
  if (context === null) {
    return
  }

  context.fillStyle = MINIMAP_BG
  context.fillRect(0, 0, width, height)

  if (props.schedule === null) {
    return
  }

  const minimapLayout = getMinimapLayout(width, height)
  const plotRect = minimapLayout.plotRect
  const allRange = applyFrequencyZoom(visibleTonalVoices.value.reduce<FrequencyRange | null>((currentRange: FrequencyRange | null, voice: GnauralScheduleVoice) => {
    const voiceRange = collectVoiceFrequencyRange(voice)
    if (voiceRange === null) {
      return currentRange
    }

    if (currentRange === null) {
      return voiceRange
    }

    return {
      min: Math.min(currentRange.min, voiceRange.min),
      max: Math.max(currentRange.max, voiceRange.max),
    }
  }, null))

  context.fillStyle = PANEL_BG
  context.fillRect(plotRect.left, plotRect.top, plotRect.width, plotRect.height)
  context.strokeStyle = AXIS_COLOR
  context.lineWidth = 1
  context.strokeRect(plotRect.left + 0.5, plotRect.top + 0.5, plotRect.width - 1, plotRect.height - 1)

  if (allRange !== null) {
    context.save()
    clipRect(context, plotRect)

    for (const voice of visibleTonalVoices.value) {
      const color = colorForVoice(voice)
      context.strokeStyle = withAlpha(color, 0.5)
      context.lineWidth = 1

      for (const entry of voice.entries) {
        if (!isRenderableFrequency(entry.baseFreqStart) || !isRenderableFrequency(entry.baseFreqEnd)) {
          continue
        }

        const startX = plotRect.left + (entry.startSec / getTotalTimeSec()) * plotRect.width
        const endX = plotRect.left + (entry.endSec / getTotalTimeSec()) * plotRect.width
        const startY = frequencyToY(plotRect, entry.baseFreqStart, allRange)
        const endY = frequencyToY(plotRect, entry.baseFreqEnd, allRange)

        context.beginPath()
        context.moveTo(startX, startY)
        context.lineTo(endX, endY)
        context.stroke()
      }
    }

    context.restore()
  }

  for (const voice of visibleWaterActivityVoices.value) {
    const color = colorForVoice(voice)
    context.save()
    clipRect(context, plotRect)
    context.strokeStyle = withAlpha(color, 0.7)
    context.fillStyle = withAlpha(color, 0.15)
    context.lineWidth = 1

    for (const entry of voice.entries) {
      const { activityStart, activityEnd } = getWaterEntryMetrics(entry)
      const startX = plotRect.left + (entry.startSec / getTotalTimeSec()) * plotRect.width
      const endX = plotRect.left + (entry.endSec / getTotalTimeSec()) * plotRect.width
      const startY = volumeToY(plotRect, activityStart)
      const endY = volumeToY(plotRect, activityEnd)
      const baselineY = plotRect.top + plotRect.height

      context.beginPath()
      context.moveTo(startX, baselineY)
      context.lineTo(startX, startY)
      context.lineTo(endX, endY)
      context.lineTo(endX, baselineY)
      context.closePath()
      context.fill()

      context.beginPath()
      context.moveTo(startX, startY)
      context.lineTo(endX, endY)
      context.stroke()
    }

    context.restore()
  }

  for (const voice of visibleBroadbandVoices.value) {
    const color = colorForVoice(voice)
    context.save()
    clipRect(context, plotRect)
    context.strokeStyle = withAlpha(color, 0.5)
    context.lineWidth = 1

    for (const entry of voice.entries) {
      const volStart = clampUnitInterval((entry.volLStart + entry.volRStart) / 2)
      const volEnd = clampUnitInterval((entry.volLEnd + entry.volREnd) / 2)
      const startX = plotRect.left + (entry.startSec / getTotalTimeSec()) * plotRect.width
      const endX = plotRect.left + (entry.endSec / getTotalTimeSec()) * plotRect.width

      context.fillStyle = withAlpha(color, ((volStart + volEnd) / 2) * 0.12)
      context.fillRect(startX, plotRect.top, Math.max(1, endX - startX), plotRect.height)

      context.beginPath()
      context.moveTo(startX, volumeToY(plotRect, volStart))
      context.lineTo(endX, volumeToY(plotRect, volEnd))
      context.stroke()
    }

    context.restore()
  }

  const viewportRect = getMinimapViewportRect(plotRect)
  const viewportRight = viewportRect.left + viewportRect.width
  const renderedViewportWidth = Math.max(1, viewportRect.width)
  const renderedViewportRight = viewportRect.left + renderedViewportWidth

  context.fillStyle = 'rgba(248, 250, 252, 0.42)'
  context.fillRect(plotRect.left, plotRect.top, Math.max(0, viewportRect.left - plotRect.left), plotRect.height)
  context.fillRect(viewportRight, plotRect.top, Math.max(0, plotRect.left + plotRect.width - viewportRight), plotRect.height)

  context.fillStyle = VIEWPORT_COLOR
  context.fillRect(viewportRect.left, plotRect.top, renderedViewportWidth, plotRect.height)
  context.strokeStyle = VIEWPORT_STROKE
  context.lineWidth = 1.25
  context.strokeRect(viewportRect.left + 0.5, plotRect.top + 0.5, Math.max(1, renderedViewportWidth - 1), plotRect.height - 1)

  const clampedPositionSec = Math.max(0, Math.min(getTotalTimeSec(), props.positionSec))
  const playbackCursorX = timeToMinimapX(plotRect, clampedPositionSec)
  context.strokeStyle = CURSOR_COLOR
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(playbackCursorX + 0.5, plotRect.top + 1)
  context.lineTo(playbackCursorX + 0.5, plotRect.top + plotRect.height - 1)
  context.stroke()

  const handleWidth = Math.min(MINIMAP_HANDLE_WIDTH_PX, Math.max(6, renderedViewportWidth / 2))
  drawMinimapViewportHandle(context, plotRect, viewportRect.left, handleWidth)
  drawMinimapViewportHandle(context, plotRect, renderedViewportRight, handleWidth)
  drawMinimapTimeAxis(context, minimapLayout.axisRect, plotRect)
}

function renderAll(): void {
  renderMainCanvas()
  renderMinimapCanvas()
}

function scheduleRender(): void {
  if (renderFrameId !== 0) {
    cancelAnimationFrame(renderFrameId)
  }

  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0
    renderAll()
  })
}

function getMainCanvasPlotRect(): Rect | null {
  const canvas = mainCanvasEl.value
  if (canvas === null) {
    return null
  }

  return getMainPlotRect(canvas.clientWidth, canvas.clientHeight)
}

function getMinimapCanvasPlotRect(): Rect | null {
  const canvas = minimapCanvasEl.value
  if (canvas === null) {
    return null
  }

  return getMinimapPlotRect(canvas.clientWidth, canvas.clientHeight)
}

function getMinimapCanvasLayout(): MinimapLayout | null {
  const canvas = minimapCanvasEl.value
  if (canvas === null) {
    return null
  }

  return getMinimapLayout(canvas.clientWidth, canvas.clientHeight)
}

function maybeSeekAtClientX(clientX: number): void {
  if (!props.canSeek) {
    return
  }

  const canvas = mainCanvasEl.value
  const plotRect = getMainCanvasPlotRect()
  if (canvas === null || plotRect === null) {
    return
  }

  const rect = canvas.getBoundingClientRect()
  const localX = clientX - rect.left
  if (localX < plotRect.left || localX > plotRect.left + plotRect.width) {
    return
  }

  emit('seek', xToTime(plotRect, localX))
}

function handleMainWheel(event: WheelEvent): void {
  const plotRect = getMainCanvasPlotRect()
  const canvas = mainCanvasEl.value
  if (plotRect === null || canvas === null) {
    return
  }

  if (event.shiftKey) {
    const multiplier = event.deltaY < 0 ? 1.12 : 1 / 1.12
    frequencyZoom.value = Math.max(1, Math.min(24, frequencyZoom.value * multiplier))
    scheduleRender()
    return
  }

  const rect = canvas.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const anchorSec = xToTime(plotRect, localX)

  if (event.ctrlKey) {
    const factor = event.deltaY < 0 ? 0.84 : 1.18
    zoomTimeViewport(factor, anchorSec)
    scheduleRender()
    return
  }

  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  panTimeViewport((dominantDelta / 240) * getVisibleDurationSec() * 0.18)
  scheduleRender()
}

function handleMainPointerDown(event: PointerEvent): void {
  canvasHostEl.value?.focus()
  pointerState.active = true
  pointerState.mode = 'main'
  pointerState.startX = event.clientX
  pointerState.moved = false
  pointerState.viewportStart = timeViewport.startSec
  pointerState.viewportEnd = timeViewport.endSec
}

function handleMinimapPointerDown(event: PointerEvent): void {
  const canvas = minimapCanvasEl.value
  const minimapLayout = getMinimapCanvasLayout()
  if (canvas === null || minimapLayout === null || props.schedule === null) {
    return
  }

  const plotRect = minimapLayout.plotRect

  canvasHostEl.value?.focus()

  const rect = canvas.getBoundingClientRect()
  const rawLocalX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const localX = Math.max(plotRect.left, Math.min(plotRect.left + plotRect.width, rawLocalX))
  const clickedTimeSec = minimapXToTime(plotRect, localX)
  const pointerTarget = getMinimapPointerTarget(minimapLayout, rawLocalX, localY)

  if (pointerTarget === 'axis' && props.canSeek) {
    emit('seek', clickedTimeSec)
    return
  }

  if (event.ctrlKey && props.canSeek) {
    emit('seek', clickedTimeSec)
    return
  }

  const visibleDurationSec = getVisibleDurationSec()

  pointerState.active = true
  pointerState.mode = 'minimap'
  pointerState.minimapAction = pointerTarget === 'resize-start' || pointerTarget === 'resize-end'
    ? pointerTarget
    : 'pan'
  pointerState.startX = event.clientX
  pointerState.moved = false
  pointerState.viewportStart = timeViewport.startSec
  pointerState.viewportEnd = timeViewport.endSec
  minimapHoverTarget.value = pointerTarget

  if (pointerTarget === 'viewport') {
    pointerState.dragOffsetSec = clickedTimeSec - timeViewport.startSec
    return
  }

  if (pointerTarget === 'resize-start' || pointerTarget === 'resize-end') {
    pointerState.dragOffsetSec = 0
    return
  }

  pointerState.dragOffsetSec = visibleDurationSec / 2
  setTimeViewport(clickedTimeSec - visibleDurationSec / 2, visibleDurationSec)
  scheduleRender()
}

function handleMinimapPointerMove(event: PointerEvent): void {
  minimapPointerInside.value = true
  ctrlKeyPressed.value = event.ctrlKey

  if (pointerState.active && pointerState.mode === 'minimap') {
    return
  }

  const canvas = minimapCanvasEl.value
  const minimapLayout = getMinimapCanvasLayout()
  if (canvas === null || minimapLayout === null) {
    return
  }

  const plotRect = minimapLayout.plotRect

  const rect = canvas.getBoundingClientRect()
  const rawLocalX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  minimapHoverTarget.value = getMinimapPointerTarget(minimapLayout, rawLocalX, localY)
}

function handleMinimapPointerLeave(): void {
  minimapPointerInside.value = false

  if (!pointerState.active) {
    minimapHoverTarget.value = 'track'
  }
}

function handleWindowPointerMove(event: PointerEvent): void {
  if (!pointerState.active) {
    return
  }

  if (pointerState.mode === 'main') {
    const plotRect = getMainCanvasPlotRect()
    if (plotRect === null) {
      return
    }

    const deltaX = event.clientX - pointerState.startX
    if (Math.abs(deltaX) > 3) {
      pointerState.moved = true
    }

    if (!pointerState.moved) {
      return
    }

    const visibleDurationSec = pointerState.viewportEnd - pointerState.viewportStart
    const deltaSec = (deltaX / Math.max(1, plotRect.width)) * visibleDurationSec
    setTimeViewport(pointerState.viewportStart - deltaSec, visibleDurationSec)
    scheduleRender()
    return
  }

  if (pointerState.mode === 'minimap') {
    const canvas = minimapCanvasEl.value
    const plotRect = getMinimapCanvasPlotRect()
    if (canvas === null || plotRect === null) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const localX = Math.max(plotRect.left, Math.min(plotRect.left + plotRect.width, event.clientX - rect.left))
    const timeSec = minimapXToTime(plotRect, localX)
    const deltaX = event.clientX - pointerState.startX
    if (Math.abs(deltaX) > 3) {
      pointerState.moved = true
    }

    if (pointerState.minimapAction === 'resize-start') {
      const minimumDurationSec = getMinimapMinimumDurationSec(plotRect)
      const nextStartSec = Math.min(
        Math.max(0, timeSec),
        pointerState.viewportEnd - minimumDurationSec,
      )
      setTimeViewport(nextStartSec, pointerState.viewportEnd - nextStartSec)
      scheduleRender()
      return
    }

    if (pointerState.minimapAction === 'resize-end') {
      const minimumDurationSec = getMinimapMinimumDurationSec(plotRect)
      const nextEndSec = Math.max(
        pointerState.viewportStart + minimumDurationSec,
        Math.min(timeSec, getTotalTimeSec()),
      )
      setTimeViewport(pointerState.viewportStart, nextEndSec - pointerState.viewportStart)
      scheduleRender()
      return
    }

    const visibleDurationSec = pointerState.viewportEnd - pointerState.viewportStart
    setTimeViewport(timeSec - pointerState.dragOffsetSec, visibleDurationSec)
    pointerState.moved = true
    scheduleRender()
  }
}

function handleWindowPointerUp(event: PointerEvent): void {
  if (!pointerState.active) {
    return
  }

  const shouldSeek = pointerState.mode === 'main' && !pointerState.moved
  pointerState.active = false
  pointerState.mode = 'idle'
  pointerState.minimapAction = 'pan'

  if (shouldSeek) {
    maybeSeekAtClientX(event.clientX)
  }
}

function closeSettingsPanel(): void {
  settingsPanelOpen.value = false
}

function toggleSettingsPanel(): void {
  settingsPanelOpen.value = !settingsPanelOpen.value
}

function handleWindowKeyDown(event: KeyboardEvent): void {
  ctrlKeyPressed.value = event.ctrlKey

  if (event.key === 'Escape' && settingsPanelOpen.value) {
    closeSettingsPanel()
  }
}

function handleWindowKeyUp(event: KeyboardEvent): void {
  ctrlKeyPressed.value = event.ctrlKey
}

function handleWindowBlur(): void {
  ctrlKeyPressed.value = false
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomTimeViewport(0.84, timeViewport.startSec + getVisibleDurationSec() / 2)
    scheduleRender()
    return
  }

  if (event.key === '-') {
    event.preventDefault()
    zoomTimeViewport(1.18, timeViewport.startSec + getVisibleDurationSec() / 2)
    scheduleRender()
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    panTimeViewport(-getVisibleDurationSec() * 0.12)
    scheduleRender()
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    panTimeViewport(getVisibleDurationSec() * 0.12)
    scheduleRender()
  }
}

watch(() => props.filePath, () => {
  resetView()
  scheduleRender()
}, { immediate: true })

watch(() => props.schedule, () => {
  scheduleRender()
}, { immediate: true })

watch(
  () => [props.timeViewportStartSec, props.timeViewportEndSec] as const,
  ([startSec, endSec]) => {
    const externalViewport = normalizeExternalTimeViewport(startSec, endSec)
    if (externalViewport === null) {
      return
    }

    if (setTimeViewport(
      externalViewport.startSec,
      externalViewport.endSec - externalViewport.startSec,
    )) {
      scheduleRender()
    }
  },
  { immediate: true },
)

watch(layoutMode, (nextLayoutMode: LayoutMode) => {
  saveStoredLayoutMode(uiStateScope.value, nextLayoutMode)
})

watch(scaleMode, (nextScaleMode: ScaleMode) => {
  saveStoredScaleMode(uiStateScope.value, nextScaleMode)
})

watch(trackPanelOpen, (nextTrackPanelOpen: boolean) => {
  saveStoredTrackPanelOpen(uiStateScope.value, nextTrackPanelOpen)
  scheduleRender()
})

watch(uiStateScope, (nextScope: string) => {
  layoutMode.value = loadStoredLayoutMode(nextScope)
  scaleMode.value = loadStoredScaleMode(nextScope)
  trackPanelOpen.value = loadStoredTrackPanelOpen(nextScope)
})

watch([layoutMode, scaleMode, frequencyZoom], () => {
  scheduleRender()
})

watch(() => props.positionSec, (positionSec: number) => {
  if (pointerState.active) {
    scheduleRender()
    return
  }

  if (props.transportState === 'playing') {
    const visibleDurationSec = getVisibleDurationSec()
    const targetAnchorSec = timeViewport.startSec + visibleDurationSec * 0.25

    if (positionSec > targetAnchorSec) {
      setTimeViewport(positionSec - visibleDurationSec * 0.25, visibleDurationSec)
    } else if (positionSec < timeViewport.startSec) {
      setTimeViewport(positionSec - visibleDurationSec * 0.05, visibleDurationSec)
    }
  }

  scheduleRender()
})

watch(() => props.transportState, () => {
  scheduleRender()
})

defineExpose({
  resetView,
})

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeyDown)
  window.addEventListener('keyup', handleWindowKeyUp)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('pointermove', handleWindowPointerMove)
  window.addEventListener('pointerup', handleWindowPointerUp)

  if (typeof ResizeObserver !== 'undefined' && canvasHostEl.value !== null) {
    resizeObserver = new ResizeObserver(() => {
      scheduleRender()
    })
    resizeObserver.observe(canvasHostEl.value)
  }

  scheduleRender()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeyDown)
  window.removeEventListener('keyup', handleWindowKeyUp)
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('pointermove', handleWindowPointerMove)
  window.removeEventListener('pointerup', handleWindowPointerUp)

  if (renderFrameId !== 0) {
    cancelAnimationFrame(renderFrameId)
  }

  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<style scoped>
.gnaural-schedule-view {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 9px;
  height: 100%;
  min-height: 0;
  width: 100%;
}

.gnaural-schedule-view__toolbar {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 16px;
}

.gnaural-schedule-view__toolbar-leading {
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  padding-top: 3px;
}

.gnaural-schedule-view__toolbar-actions {
  display: flex;
  flex: 1 1 360px;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.gnaural-schedule-view__toolbar-tracks-toggle {
  min-height: 40px;
}

.gnaural-schedule-view__toolbar-tracks-toggle--active {
  background: rgba(37, 99, 235, 0.12);
}

.gnaural-schedule-view__toolbar-slot {
  flex: 0 1 auto;
  min-width: 0;
}

.gnaural-schedule-view__overlay-controls {
  align-items: flex-end;
  bottom: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  position: absolute;
  right: 4px;
  z-index: 35;
}

.gnaural-schedule-view__overlay-settings-toggle {
  border: 1px solid rgba(37, 99, 235, 0.2);
  min-height: 34px;
  min-width: 34px;
  pointer-events: auto;
}

.gnaural-schedule-view__overlay-settings-toggle--active {
  background: rgba(37, 99, 235, 0.12);
}

.gnaural-schedule-view__settings-label {
  align-items: center;
  align-self: flex-start;
  background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
  border: 1px solid rgba(191, 219, 254, 0.48);
  border-radius: 999px;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.18);
  color: #eff6ff;
  display: inline-flex;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  padding: 5px 10px;
  text-shadow: 0 1px 2px rgba(15, 23, 42, 0.28);
}

.gnaural-schedule-view__toolbar-select:deep(.q-field__control) {
  background: #ffffff;
  border-radius: 10px;
  color: #0f172a;
  min-height: 42px;
}

.gnaural-schedule-view__toolbar-select:deep(.q-field__native),
.gnaural-schedule-view__toolbar-select:deep(.q-field__input),
.gnaural-schedule-view__toolbar-select:deep(.q-field__marginal),
.gnaural-schedule-view__toolbar-select:deep(.q-field__append) {
  color: #0f172a;
}

.gnaural-schedule-view__toolbar-select:deep(.q-field__control:before) {
  border-color: rgba(37, 99, 235, 0.36);
}

.gnaural-schedule-view__toolbar-select:deep(.q-field__control:hover:before) {
  border-color: rgba(37, 99, 235, 0.56);
}

.gnaural-schedule-view__toolbar-select:deep(.q-field--focused .q-field__control:before),
.gnaural-schedule-view__toolbar-select:deep(.q-field--highlighted .q-field__control:before) {
  border-color: rgba(37, 99, 235, 0.78);
}

.gnaural-schedule-view__toolbar-select:deep(.q-field__control:after) {
  border-color: rgba(37, 99, 235, 0.78);
}

:global(.gnaural-schedule-view__select-menu) {
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.16);
  color: #0f172a;
}

:global(.gnaural-schedule-view__select-menu .q-item) {
  background: #f8fafc;
  color: #1e293b;
  min-height: 46px;
  padding: 0 14px;
}

:global(.gnaural-schedule-view__select-menu .q-item + .q-item) {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

:global(.gnaural-schedule-view__select-menu .q-item__label),
:global(.gnaural-schedule-view__select-menu .q-item__section) {
  color: #1e293b;
  font-weight: 600;
}

:global(.gnaural-schedule-view__select-menu .q-item.q-manual-focusable--focused),
:global(.gnaural-schedule-view__select-menu .q-item.q-item--active),
:global(.gnaural-schedule-view__select-menu .q-item:hover) {
  background: #e2e8f0;
  color: #0f172a;
}

:global(.gnaural-schedule-view__select-option--selected) {
  background: rgba(37, 99, 235, 0.12);
  color: #0f172a;
  font-weight: 600;
}

.gnaural-schedule-view__content {
  align-items: stretch;
  display: flex;
  flex: 1 1 auto;
  gap: 5px;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.gnaural-schedule-view__settings-backdrop {
  background: rgba(15, 23, 42, 0.16);
  inset: 0;
  position: absolute;
  z-index: 20;
}

.gnaural-schedule-view__settings-panel {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0;
  bottom: 0;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 56px);
  position: absolute;
  right: 0;
  top: 0;
  width: 320px;
  z-index: 30;
}

.gnaural-schedule-view__settings-panel-header {
  align-items: flex-start;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 16px 16px 14px;
}

.gnaural-schedule-view__settings-heading {
  min-width: 0;
}

.gnaural-schedule-view__settings-title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
}

.gnaural-schedule-view__settings-subtitle {
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 4px;
}

.gnaural-schedule-view__settings-panel-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding: 16px;
}

.gnaural-schedule-view__settings-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gnaural-schedule-view__canvas-scroll-host {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.gnaural-schedule-view__canvas-scroll-host--tracks-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}

.gnaural-schedule-view__canvas-scroll-host--tracks-scroll .gnaural-schedule-view__canvas-host {
  flex: 0 0 auto;
  min-height: var(--gnaural-main-canvas-min-height, 360px);
  width: 100%;
}

.gnaural-schedule-view__canvas-scroll-host--tracks-scroll .gnaural-schedule-view__main-canvas {
  height: var(--gnaural-main-canvas-min-height, 360px);
}

.gnaural-schedule-view__canvas-column {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  display: grid;
  flex: 1 1 auto;
  gap: 10px;
  grid-template-rows: minmax(0, 1fr) 68px;
  min-height: 0;
  min-width: 0;
  outline: none;
  overflow: hidden;
  padding: 0;
  position: relative;
}

.gnaural-schedule-view__minimap-wrap {
  min-height: 0;
  position: relative;
}

.gnaural-schedule-view--tracks-layout .gnaural-schedule-view__canvas-column {
  grid-template-rows: minmax(360px, 1fr) 68px;
  min-height: 436px;
}

.gnaural-schedule-view__canvas-host {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.gnaural-schedule-view__tracks-panel {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
  display: flex;
  flex: 0 0 340px;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  width: 340px;
}

.gnaural-schedule-view__tracks-panel-header {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  gap: 5px;
  justify-content: space-between;
  min-height: 52px;
  padding: 5px;
}

.gnaural-schedule-view__tracks-heading {
  min-width: 0;
}

.gnaural-schedule-view__tracks-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.gnaural-schedule-view__tracks-subtitle {
  color: #64748b;
  font-size: 12px;
  line-height: 1.2;
  margin-top: 3px;
}

.gnaural-schedule-view__tracks-panel-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 5px;
}

.gnaural-schedule-view__tracks-empty {
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.gnaural-schedule-view__track-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.gnaural-schedule-view__track-card {
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 0;
  box-shadow: 0 8px 16px rgba(148, 163, 184, 0.08);
  padding: 5px;
}

.gnaural-schedule-view__track-card--hidden {
  background: rgba(241, 245, 249, 0.96);
}

.gnaural-schedule-view__track-card--muted {
  border-color: rgba(239, 68, 68, 0.28);
}

.gnaural-schedule-view__track-card-row {
  align-items: stretch;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.gnaural-schedule-view__track-copy {
  flex: 1 1 auto;
  min-width: 0;
}

.gnaural-schedule-view__track-title {
  align-items: baseline;
  color: #0f172a;
  display: flex;
  font-size: 12.5px;
  gap: 4px;
  line-height: 1.3;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.gnaural-schedule-view__track-name {
  color: #0f172a;
  flex: 0 1 auto;
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gnaural-schedule-view__track-type {
  color: #6366f1;
  flex: 0 0 auto;
  font-size: 11.5px;
  font-weight: 700;
}

.gnaural-schedule-view__track-description {
  color: #475569;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gnaural-schedule-view__track-controls {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-start;
  width: 100%;
}

.gnaural-schedule-view__track-controls :deep(.q-btn) {
  min-height: 28px;
  padding: 0 6px;
  background: rgba(226, 232, 240, 0.62);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
}

.gnaural-schedule-view__track-color-input {
  appearance: none;
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  flex: 0 0 30px;
  height: 30px;
  padding: 0;
  width: 30px;
}

.gnaural-schedule-view__track-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.gnaural-schedule-view__track-color-input::-webkit-color-swatch {
  border: none;
  border-radius: 7px;
}

.gnaural-schedule-view__canvas-column:focus-visible {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 0 0 2px rgba(37, 99, 235, 0.28);
}

.gnaural-schedule-view__main-canvas,
.gnaural-schedule-view__minimap-canvas {
  display: block;
  height: 100%;
  user-select: none;
  width: 100%;
}

.gnaural-schedule-view__main-canvas {
  cursor: crosshair;
  min-height: 0;
}

.gnaural-schedule-view--tracks-layout .gnaural-schedule-view__main-canvas {
  min-height: var(--gnaural-main-canvas-min-height, 360px);
}

.gnaural-schedule-view__minimap-canvas {
  border-radius: 0;
  cursor: grab;
  min-height: 68px;
  touch-action: none;
}

.gnaural-schedule-view__empty {
  align-items: center;
  background: rgba(248, 250, 252, 0.76);
  color: #475569;
  display: flex;
  inset: 76px 24px 24px 96px;
  justify-content: center;
  pointer-events: none;
  position: absolute;
  text-align: center;
}

.gnaural-schedule-settings-backdrop-enter-active,
.gnaural-schedule-settings-backdrop-leave-active {
  transition: opacity 0.18s ease;
}

.gnaural-schedule-settings-backdrop-enter-from,
.gnaural-schedule-settings-backdrop-leave-to {
  opacity: 0;
}

.gnaural-schedule-settings-panel-enter-active,
.gnaural-schedule-settings-panel-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.gnaural-schedule-settings-panel-enter-from,
.gnaural-schedule-settings-panel-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

@media (max-width: 900px) {
  .gnaural-schedule-view__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .gnaural-schedule-view__toolbar-leading,
  .gnaural-schedule-view__toolbar-slot,
  .gnaural-schedule-view__toolbar-actions {
    flex: none;
    width: 100%;
  }

  .gnaural-schedule-view__toolbar-leading {
    align-items: stretch;
  }

  .gnaural-schedule-view__toolbar-actions {
    justify-content: flex-start;
  }

  .gnaural-schedule-view__settings-panel {
    max-width: none;
    width: 100%;
  }

  .gnaural-schedule-view__content {
    flex-direction: column;
  }

  .gnaural-schedule-view__tracks-panel {
    flex-basis: auto;
    width: 100%;
  }

  .gnaural-schedule-view__canvas-column {
    grid-template-rows: minmax(320px, 1fr) 64px;
    min-height: 404px;
  }

  .gnaural-schedule-view__main-canvas {
    min-height: var(--gnaural-main-canvas-min-height, 320px);
  }

  .gnaural-schedule-view__track-card-row {
    align-items: stretch;
    flex-direction: column;
  }

  .gnaural-schedule-view__track-controls {
    justify-content: flex-start;
    width: 100%;
  }
}
</style>