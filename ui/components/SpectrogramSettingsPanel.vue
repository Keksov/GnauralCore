<template>
  <!-- SS2.1 (SS-D5/SS-D6, owner req 2-4): each parameter group is a BLOCK. «Пресеты» is block #1.
       When two blocks fit side by side (content width >= threshold) the blocks are TILES; otherwise
       the panel is a single-column ACCORDION (multi-open, remembered). The layout switch is
       structural (accordion collapses, tiles don't), so it can't be pure CSS — a ResizeObserver on
       the panel root drives it (SS-D4). «Сброс» lives in the window footer (SpectrumSettingsDialog),
       not here. -->
  <div ref="rootEl" class="spectrogram-settings" :class="`spectrogram-settings--${layout}`">
    <template v-for="block in blocks" :key="block.key">
      <!-- Accordion: a collapsible q-expansion-item per block (SS-D5, modelled on
           GTrackSpectrumSettings). Independent v-model per block -> several can be open at once. -->
      <q-expansion-item
        v-if="layout === 'accordion'"
        :model-value="openSet.has(block.key)"
        :label="block.title"
        dense
        header-class="spectrogram-settings__acc-header"
        class="spectrogram-settings__block spectrogram-settings__acc"
        @update:model-value="(v: boolean) => setOpen(block.key, v)"
      >
        <div class="spectrogram-settings__acc-body">
          <spectrogram-settings-fields :fields="block.fields" />
        </div>
      </q-expansion-item>

      <!-- Tiles: a non-collapsing titled card; the CSS grid packs two+ across (SS-D4). -->
      <section v-else class="spectrogram-settings__block spectrogram-settings__tile">
        <div class="spectrogram-settings__title">{{ block.title }}</div>
        <spectrogram-settings-fields :fields="block.fields" />
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
  layoutForWidth,
  type Field,
  type Group,
  type SelectableKey,
  type SliderSpec,
  type SpectrumLayout,
  type SpinSpec,
} from '../composables/spectrogram-settings-fields'

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

// SS-D6 rev. 2 (owner 2026-07-16): presets are NOT a block — they moved to a title-bar modal
// (SpectrogramPresetsDialog). The blocks are exactly the four parameter groups.
const blocks = computed<Group[]>(() => groups.value)

// ---- Layout: tiles vs accordion, driven by the panel's own width (SS-D4) --------------------------
const rootEl = ref<HTMLElement | null>(null)
// Default to accordion: it is the safe single-column layout, and it is what a fresh floating window
// (minFloatW 460 < threshold) or a left/right dock (320) shows anyway.
const layout = ref<SpectrumLayout>('accordion')
let ro: ResizeObserver | null = null

function measure(): void {
  const el = rootEl.value
  if (el === null) return
  layout.value = layoutForWidth(el.clientWidth)
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
  // Default: the first block open (SS-D5). After SS-D6 rev. 2 the first block is «Масштаб».
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
  gap: 14px;
}

/* SS-D4: tiles = a grid that packs two+ blocks across; align-items:start so unequal-height blocks
   sit at their natural height instead of stretching (R2). minmax min == SPECTRUM_BLOCK_MIN_PX. */
.spectrogram-settings--tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
  align-items: start;
}

.spectrogram-settings__tile {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.spectrogram-settings__title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
}

/* Accordion blocks read as a bordered stack (SS-D5). */
.spectrogram-settings__acc {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
}

.spectrogram-settings__acc :deep(.spectrogram-settings__acc-header) {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
  text-transform: uppercase;
}

.spectrogram-settings__acc-body {
  padding: 4px 12px 12px;
}
</style>
