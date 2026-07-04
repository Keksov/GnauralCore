<template>
  <div class="spectrogram-settings">
    <div class="spectrogram-settings__presets">
      <q-btn-dropdown dense flat no-caps icon="tune" :label="t('audio.spectrogramPresets')" class="spectrogram-settings__field">
        <q-list dense>
          <q-item
            v-for="preset in presets"
            :key="preset.name"
            clickable
            v-close-popup
            @click="store.applyPreset(preset.name)"
          >
            <q-item-section>{{ preset.label }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
    </div>

    <!-- SF13.1: Audacity-style groups (Масштаб / Цвет / FFT-фильтр). -->
    <div v-for="group in groups" :key="group.key" class="spectrogram-settings__group">
      <div class="spectrogram-settings__title">{{ group.title }}</div>

      <div v-for="field in group.fields" :key="field.key" class="spectrogram-settings__field">
        <div class="spectrogram-settings__label-row">
          <span class="spectrogram-settings__label">{{ field.label }}</span>
          <!-- SF13.3: per-parameter help. -->
          <q-icon
            name="help_outline"
            size="15px"
            class="spectrogram-settings__help"
            :aria-label="t('audio.spectrogramHelpFor', { field: field.label })"
            tabindex="0"
          >
            <q-menu anchor="bottom right" self="top right" max-width="280px">
              <div class="spectrogram-settings__help-text">{{ field.help }}</div>
            </q-menu>
          </q-icon>
        </div>

        <q-select
          v-if="field.kind === 'select'"
          v-model="sVal[field.key]"
          :options="field.options"
          dense outlined emit-value map-options
          class="spectrogram-settings__control"
        />
        <q-input
          v-else-if="field.kind === 'number'"
          v-model.number="sNum[field.key]"
          type="number"
          dense outlined
          class="spectrogram-settings__control"
        />
        <template v-else>
          <div class="spectrogram-settings__slider-value text-grey-7">
            {{ Number(sNum[field.key]).toFixed(field.slider!.decimals) }}
          </div>
          <q-slider
            v-model="sNum[field.key]"
            :min="field.slider!.min"
            :max="field.slider!.max"
            :step="field.slider!.step"
            dense
          />
        </template>
      </div>
    </div>

    <div class="spectrogram-settings__actions">
      <q-btn flat dense no-caps :label="t('audio.spectrogramReset')" icon="restart_alt" @click="store.reset()" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpectrogramStore } from '../stores/spectrogram'
import {
  SPECTROGRAM_DATA_MODES,
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_PRESETS,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WINDOW_SIZES,
  SPECTROGRAM_WIN_FUNCS,
  SPECTROGRAM_ZERO_PADDING,
  type SpectrogramSettings,
} from '../composables/spectrogram-settings'

const { t } = useI18n()
const store = useSpectrogramStore()
const s = store.settings
// Same reactive object, loosely typed for the data-driven v-models (the field kind
// guarantees the runtime type; TS can't narrow s[field.key] from a dynamic key).
const sNum = s as unknown as Record<string, number>
const sVal = s as unknown as Record<string, string | number>
const presets = [...SPECTROGRAM_PRESETS]

type SelectableKey = keyof SpectrogramSettings

interface SliderSpec {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

// SF13.2: enum -> localized option {label,value}. `optionsKey` is the i18n namespace
// holding one label per enum value (e.g. audio.spectrogramWinFuncOpt.hann).
function enumOptions(aList: readonly string[], aOptionsKey: string): { label: string; value: string }[] {
  return aList.map((v) => ({ label: t(`audio.${aOptionsKey}.${v}`), value: v }))
}
function numberOptions(aList: readonly number[], aSuffix = ''): { label: string; value: number }[] {
  return aList.map((v) => ({ label: `${v}${aSuffix}`, value: v }))
}

interface Field {
  readonly key: SelectableKey
  readonly kind: 'select' | 'number' | 'slider'
  readonly label: string
  readonly help: string
  readonly options?: { label: string; value: string | number }[]
  readonly slider?: SliderSpec
}
interface Group {
  readonly key: string
  readonly title: string
  readonly fields: Field[]
}

// helpers building a field with its localized label + help.
const sel = (key: SelectableKey, labelKey: string, options: { label: string; value: string | number }[]): Field =>
  ({ key, kind: 'select', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), options })
const num = (key: SelectableKey, labelKey: string): Field =>
  ({ key, kind: 'number', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`) })
const sld = (key: SelectableKey, labelKey: string, slider: SliderSpec): Field =>
  ({ key, kind: 'slider', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), slider })

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
      sld('gain', 'spectrogramGain', { min: 0.1, max: 8, step: 0.1, decimals: 1 }),
      sld('drange', 'spectrogramDynamicRange', { min: 20, max: 200, step: 5, decimals: 0 }),
      sld('limit', 'spectrogramLimit', { min: -60, max: 0, step: 1, decimals: 0 }),
      sld('frequencyGain', 'spectrogramFrequencyGain', { min: -20, max: 20, step: 1, decimals: 0 }),
      sld('saturation', 'spectrogramSaturation', { min: -10, max: 10, step: 0.5, decimals: 1 }),
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
])
</script>

<style scoped>
.spectrogram-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.spectrogram-settings__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.spectrogram-settings__title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
}

.spectrogram-settings__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spectrogram-settings__label-row {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 4px;
  justify-content: space-between;
}

.spectrogram-settings__label {
  min-width: 0;
}

.spectrogram-settings__help {
  cursor: help;
  flex: 0 0 auto;
  opacity: 0.6;
}

.spectrogram-settings__help:hover {
  opacity: 1;
}

.spectrogram-settings__help-text {
  font-size: 12px;
  line-height: 1.4;
  padding: 10px 12px;
}

.spectrogram-settings__slider-value {
  font-size: 12px;
  text-align: right;
}

.spectrogram-settings__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
