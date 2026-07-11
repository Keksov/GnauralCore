<template>
  <!-- GT8.2 (GT-D19, owner req. 37): per-lane spectrum settings as an ACCORDION. Compact core-field
       editor over a lane's independent SpectrogramSettings (v-model). Separate from the global
       SpectrogramSettingsPanel so the frozen tab is untouched (risk R7). -->
  <div class="gtrack-spectrum-settings">
    <q-list bordered class="rounded-borders">
      <q-expansion-item default-opened dense :label="t('audio.spectrogramGroupFft')" header-class="text-caption">
        <div class="gtrack-spectrum-settings__body">
          <q-select
            dense options-dense outlined emit-value map-options
            :model-value="modelValue.window"
            :options="windowOptions"
            :label="t('audio.spectrogramWindow')"
            @update:model-value="(v: number) => patch('window', v)"
          />
          <q-select
            dense options-dense outlined emit-value map-options
            :model-value="modelValue.winFunc"
            :options="strOptions(WIN_FUNCS)"
            :label="t('audio.spectrogramWinFunc')"
            @update:model-value="(v: string) => patch('winFunc', v)"
          />
          <div class="gtrack-spectrum-settings__slider">
            <div class="text-caption text-grey">{{ t('audio.spectrogramOverlap') }}: {{ modelValue.overlap.toFixed(2) }}</div>
            <q-slider
              :model-value="modelValue.overlap" :min="0" :max="0.95" :step="0.05" dense
              @update:model-value="(v: number | null) => patch('overlap', v ?? 0)"
            />
          </div>
          <q-select
            dense options-dense outlined emit-value map-options
            :model-value="modelValue.fscale"
            :options="strOptions(FSCALES)"
            :label="t('audio.spectrogramFreqScale')"
            @update:model-value="(v: string) => patch('fscale', v)"
          />
        </div>
      </q-expansion-item>

      <q-expansion-item dense :label="t('audio.spectrogramGroupColor')" header-class="text-caption">
        <div class="gtrack-spectrum-settings__body">
          <q-select
            dense options-dense outlined emit-value map-options
            :model-value="modelValue.scale"
            :options="strOptions(SCALES)"
            :label="t('audio.spectrogramIntensityScale')"
            @update:model-value="(v: string) => patch('scale', v)"
          />
          <q-select
            dense options-dense outlined emit-value map-options
            :model-value="modelValue.palette"
            :options="strOptions(PALETTES)"
            :label="t('audio.spectrogramPalette')"
            @update:model-value="(v: string) => patch('palette', v)"
          />
          <q-input
            dense outlined type="number" :step="1"
            :model-value="modelValue.gain"
            :label="t('audio.spectrogramGain')"
            @update:model-value="(v: string | number | null) => patch('gain', Number(v))"
          />
          <q-input
            dense outlined type="number" :step="5"
            :model-value="modelValue.drange"
            :label="t('audio.spectrogramDynamicRange')"
            @update:model-value="(v: string | number | null) => patch('drange', Number(v))"
          />
        </div>
      </q-expansion-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WINDOW_SIZES,
  SPECTROGRAM_WIN_FUNCS,
  type SpectrogramSettings,
} from '../composables/spectrogram-settings'

const props = defineProps<{ modelValue: SpectrogramSettings }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: SpectrogramSettings): void }>()

const { t } = useI18n()

const WIN_FUNCS = SPECTROGRAM_WIN_FUNCS
const FSCALES = SPECTROGRAM_FSCALES
const SCALES = SPECTROGRAM_SCALES
const PALETTES = SPECTROGRAM_PALETTES

const windowOptions = SPECTROGRAM_WINDOW_SIZES.map((n) => ({ label: String(n), value: n }))
function strOptions(values: readonly string[]): { label: string; value: string }[] {
  return values.map((v) => ({ label: v, value: v }))
}

// value comes from the option lists (valid by construction), so a loose parameter + spread is safe.
function patch(key: keyof SpectrogramSettings, value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) return
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.gtrack-spectrum-settings__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.gtrack-spectrum-settings__slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
