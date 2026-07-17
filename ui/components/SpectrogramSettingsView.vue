<template>
  <!-- SS3.1 (SS-D2): the PURE «Параметры» view. It renders from `snapshot` and emits one `action`
       per gesture — no store, so the SAME view renders in the main window (via the in-window adapter
       SpectrogramSettingsPanel) and in the detached child window (via SpectrogramSettingsRemote).
       Layout: each group is a card; tiles (masonry) when wide, single-column accordion when narrow
       (SS-D4). «Пресеты»/«Сброс» are NOT here — they live in the window chrome (SS-D6). -->
  <div ref="rootEl" class="spectrogram-settings" :class="`spectrogram-settings--${layout}`">
    <template v-for="block in blocks" :key="block.key">
      <!-- Accordion: a collapsible card; the header rule shows only when open (SS2.8). -->
      <q-expansion-item
        v-if="layout === 'accordion'"
        :model-value="openSet.has(block.key)"
        :label="block.title"
        dense
        :header-class="openSet.has(block.key)
          ? 'spectrogram-settings__block-header spectrogram-settings__block-header--ruled'
          : 'spectrogram-settings__block-header'"
        class="spectrogram-settings__card"
        @update:model-value="(v: boolean) => setOpen(block.key, v)"
      >
        <div class="spectrogram-settings__card-body">
          <spectrogram-settings-fields :fields="block.fields" :values="snapshot.settings" :disable="disabled" @action="onAction" />
        </div>
      </q-expansion-item>

      <!-- Tiles (window mode): the SAME card, static — a ruled header, no chevron (SS2.8). -->
      <section v-else class="spectrogram-settings__card">
        <div class="spectrogram-settings__block-header spectrogram-settings__block-header--ruled spectrogram-settings__block-header--static">
          {{ block.title }}
        </div>
        <div class="spectrogram-settings__card-body">
          <spectrogram-settings-fields :fields="block.fields" :values="snapshot.settings" :disable="disabled" @action="onAction" />
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SpectrogramSettingsFields from './SpectrogramSettingsFields.vue'
import {
  SPECTROGRAM_DATA_MODES,
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_HIGH_ZOOM_MODES,
  SPECTROGRAM_IMAGE_SCALINGS,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WINDOW_SIZES,
  SPECTROGRAM_WIN_FUNCS,
  SPECTROGRAM_ZERO_PADDING,
} from '../composables/spectrogram-settings'
import {
  SPECTRUM_TILES_THRESHOLD_PX,
  type Field,
  type Group,
  type SelectableKey,
  type SliderSpec,
  type SpectrumLayout,
  type SpinSpec,
} from '../composables/spectrogram-settings-fields'
import type { SpectrumSettingsSnapshot, SpectrumSettingsAction } from '../composables/spectrum-settings-model'

defineProps<{
  readonly snapshot: SpectrumSettingsSnapshot
  /** SG3.5 (WS-D3 mirror): render every field inert — the host's «Оба канала» scope is not in
   *  effect while the channels are unlinked. Accordion open/close stays live (it is view state). */
  readonly disabled?: boolean
}>()
const emit = defineEmits<{ action: [action: SpectrumSettingsAction] }>()

function onAction(action: SpectrumSettingsAction): void {
  emit('action', action)
}

const { t } = useI18n()

// SF13.2: enum -> localized option {label,value}. `optionsKey` is the i18n namespace holding one
// label per enum value (e.g. audio.spectrogramWinFuncOpt.hann).
function enumOptions(aList: readonly string[], aOptionsKey: string): { label: string; value: string }[] {
  return aList.map((v) => ({ label: t(`audio.${aOptionsKey}.${v}`), value: v }))
}
function numberOptions(aList: readonly number[], aSuffix = ''): { label: string; value: number }[] {
  return aList.map((v) => ({ label: `${v}${aSuffix}`, value: v }))
}

// helpers building a field with its localized label + help.
const sel = (key: SelectableKey, labelKey: string, options: { label: string; value: string | number }[]): Field =>
  ({ key, kind: 'select', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), options })
const num = (key: SelectableKey, labelKey: string): Field =>
  ({ key, kind: 'number', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`) })
const sld = (key: SelectableKey, labelKey: string, slider: SliderSpec): Field =>
  ({ key, kind: 'slider', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), slider })
const spn = (key: SelectableKey, labelKey: string, spin: SpinSpec): Field =>
  ({ key, kind: 'spin', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), spin })

// SF13.1 + SF13.2: grouped, localized (reactive to locale via t()).
const groups = computed<Group[]>(() => [
  {
    key: 'scale',
    title: t('audio.spectrogramGroupScale'),
    fields: [
      sel('fscale', 'spectrogramFreqScale', enumOptions(SPECTROGRAM_FSCALES, 'spectrogramFscaleOpt')),
      num('startHz', 'spectrogramStartHz'),
      num('stopHz', 'spectrogramStopHz'),
    ],
  },
  {
    key: 'color',
    title: t('audio.spectrogramGroupColor'),
    fields: [
      sel('scale', 'spectrogramIntensityScale', enumOptions(SPECTROGRAM_SCALES, 'spectrogramScaleOpt')),
      // SF16.1: numeric spinbox dials (default 0 where meaningful). Gain is in dB now.
      spn('gain', 'spectrogramGain', { min: -60, max: 60, step: 1, decimals: 0 }),
      spn('drange', 'spectrogramDynamicRange', { min: 10, max: 200, step: 5, decimals: 0 }),
      spn('limit', 'spectrogramLimit', { min: -100, max: 0, step: 1, decimals: 0 }),
      spn('frequencyGain', 'spectrogramFrequencyGain', { min: -60, max: 60, step: 1, decimals: 0 }),
      spn('saturation', 'spectrogramSaturation', { min: 0, max: 1, step: 0.1, decimals: 1 }),
      sel('palette', 'spectrogramPalette', enumOptions(SPECTROGRAM_PALETTES, 'spectrogramPaletteOpt')),
    ],
  },
  {
    key: 'fft',
    title: t('audio.spectrogramGroupFft'),
    fields: [
      sel('data', 'spectrogramAlgorithm', enumOptions(SPECTROGRAM_DATA_MODES, 'spectrogramDataOpt')),
      sel('window', 'spectrogramWindow', numberOptions(SPECTROGRAM_WINDOW_SIZES)),
      sel('winFunc', 'spectrogramWinFunc', enumOptions(SPECTROGRAM_WIN_FUNCS, 'spectrogramWinFuncOpt')),
      sel('zeroPaddingFactor', 'spectrogramZeroPad', numberOptions(SPECTROGRAM_ZERO_PADDING, 'x')),
      // SF14 (variant b): Overlap is the frame-step control; the worker hop is derived
      // from it. (The redundant Hop field was removed.)
      sld('overlap', 'spectrogramOverlap', { min: 0, max: 0.95, step: 0.05, decimals: 2 }),
      // SF14.1: 'Channel mode' removed (a no-op — the L/R split is UI-driven).
      // SF15.2: 'Channel' removed too — it was overridden by the L/R split (AudioPage always
      // opens channel 0 + channel 1 as two tracks), so the field did nothing.
    ],
  },
  {
    // SF17.2/17.3: sharpness controls for high zoom.
    key: 'sharpness',
    title: t('audio.spectrogramGroupSharpness'),
    fields: [
      sel('imageScaling', 'spectrogramImageScaling', enumOptions(SPECTROGRAM_IMAGE_SCALINGS, 'spectrogramImageScalingOpt')),
      sel('highZoomMode', 'spectrogramHighZoomMode', enumOptions(SPECTROGRAM_HIGH_ZOOM_MODES, 'spectrogramHighZoomModeOpt')),
      spn('highZoomThreshold', 'spectrogramHighZoomThreshold', { min: 2, max: 64, step: 1, decimals: 0 }),
      sel('highZoomWindow', 'spectrogramHighZoomWindow', numberOptions(SPECTROGRAM_WINDOW_SIZES)),
    ],
  },
])

// SS-D6 rev. 2: presets are NOT a block (they moved to a title-bar modal). Blocks = the four groups.
const blocks = computed<Group[]>(() => groups.value)

// ---- Layout: tiles vs accordion, driven by the view's own width (SS-D4) ---------------------------
const rootEl = ref<HTMLElement | null>(null)
// Default to accordion: the safe single-column layout, and what a narrow window shows anyway.
const layout = ref<SpectrumLayout>('accordion')
let ro: ResizeObserver | null = null

// SS2.6: hysteresis around the threshold so a scrollbar (~15px) can't ping-pong the switch.
const LAYOUT_HYSTERESIS_PX = 24
function measure(): void {
  const el = rootEl.value
  if (el === null) return
  const w = el.clientWidth
  if (layout.value === 'accordion') {
    if (w >= SPECTRUM_TILES_THRESHOLD_PX) layout.value = 'tiles'
  } else if (w < SPECTRUM_TILES_THRESHOLD_PX - LAYOUT_HYSTERESIS_PX) {
    layout.value = 'accordion'
  }
}

onMounted(() => {
  measure()
  // Guarded like every other ResizeObserver in this codebase; without it we stay in accordion.
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => measure())
    if (rootEl.value !== null) ro.observe(rootEl.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

// ---- Accordion open-set (SS-D5): multi-open, persisted ------------------------------------------
const OPEN_KEY = 'mindwave-panel-spectrum-settings-groups'

function loadOpenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return new Set(parsed.filter((k): k is string => typeof k === 'string'))
    }
  } catch {
    // best-effort, like the @panel state persistence
  }
  // Default: the first block open (SS-D5) — after SS-D6 rev.2 that is «Масштаб».
  return new Set(['scale'])
}
const openSet = ref<Set<string>>(loadOpenSet())

function setOpen(aKey: string, aOpen: boolean): void {
  const next = new Set(openSet.value)
  if (aOpen) next.add(aKey)
  else next.delete(aKey)
  openSet.value = next
}
watch(openSet, (v) => {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...v]))
  } catch {
    // best-effort
  }
}, { deep: true })
</script>

<style scoped>
.spectrogram-settings {
  display: flex;
  flex-direction: column;
}

/* SS2.7/SS2.8: tiles = masonry (CSS multicol) of self-bordered 1px cards, no gap. display:block
   (not the base flex) is required for multicol to apply. */
.spectrogram-settings--tiles {
  display: block;
  column-width: 280px;
  column-gap: 0;
}

.spectrogram-settings--accordion {
  display: flex;
  flex-direction: column;
}

.spectrogram-settings__card {
  break-inside: avoid;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

/* Owner pick: a filled «band» header — a full-width tint, full-brightness text, heavier weight and
   letter-spacing so the groups read as sections rather than faint labels — plus an accent bar on the
   left edge for extra emphasis. */
.spectrogram-settings__block-header {
  background: rgba(148, 163, 184, 0.12);
  border-left: 3px solid var(--q-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.spectrogram-settings__block-header--static {
  padding: 7px 12px;
}

.spectrogram-settings__block-header--ruled {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

/* The accordion header is rendered by q-expansion-item, so reach it through :deep. */
.spectrogram-settings__card :deep(.spectrogram-settings__block-header) {
  background: rgba(148, 163, 184, 0.12);
  border-left: 3px solid var(--q-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.spectrogram-settings__card :deep(.spectrogram-settings__block-header--ruled) {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.spectrogram-settings__card-body {
  padding: 8px 12px 10px;
}
</style>
