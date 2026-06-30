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

    <div class="spectrogram-settings__group">
      <div class="spectrogram-settings__title">{{ t('audio.spectrogramAnalysisGroup') }}</div>
      <q-select v-model="s.window" :options="windowSizes" label="Window" dense outlined emit-value map-options class="spectrogram-settings__field" />
      <q-select v-model="s.zeroPaddingFactor" :options="zeroPadOptions" label="Zero-pad" dense outlined emit-value map-options class="spectrogram-settings__field" />
      <q-input v-model.number="s.hop" type="number" label="Hop" dense outlined class="spectrogram-settings__field" />
      <q-select v-model="s.winFunc" :options="winFuncs" label="Window func" dense outlined class="spectrogram-settings__field" />
      <q-select v-model="s.data" :options="dataModes" label="Data" dense outlined class="spectrogram-settings__field" />
      <q-select v-model="s.fscale" :options="fscales" label="Freq scale" dense outlined class="spectrogram-settings__field" />
      <q-select v-model="s.mode" :options="channelModes" label="Channel mode" dense outlined class="spectrogram-settings__field" />
      <q-input v-model.number="s.channel" type="number" label="Channel" dense outlined class="spectrogram-settings__field" />
      <q-input v-model.number="s.startHz" type="number" label="Start Hz" dense outlined class="spectrogram-settings__field" />
      <q-input v-model.number="s.stopHz" type="number" label="Stop Hz (0 = Nyquist)" dense outlined class="spectrogram-settings__field" />
    </div>

    <div class="spectrogram-settings__group">
      <div class="spectrogram-settings__title">{{ t('audio.spectrogramDisplayGroup') }}</div>
      <q-select v-model="s.scale" :options="scales" label="Intensity scale" dense outlined class="spectrogram-settings__field" />
      <q-select v-model="s.palette" :options="palettes" label="Palette" dense outlined class="spectrogram-settings__field" />

      <div v-for="slider in sliders" :key="slider.key" class="spectrogram-settings__slider">
        <div class="spectrogram-settings__slider-label">
          <span>{{ slider.label }}</span>
          <span class="text-grey-7">{{ Number(s[slider.key]).toFixed(slider.decimals) }}</span>
        </div>
        <q-slider v-model="s[slider.key]" :min="slider.min" :max="slider.max" :step="slider.step" dense />
      </div>
    </div>

    <div class="spectrogram-settings__actions">
      <q-btn flat dense no-caps :label="t('audio.spectrogramReset')" icon="restart_alt" @click="store.reset()" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useSpectrogramStore } from '../stores/spectrogram'
import {
  SPECTROGRAM_CHANNEL_MODES,
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

const windowSizes = SPECTROGRAM_WINDOW_SIZES.map((value) => ({ label: String(value), value }))
const zeroPadOptions = SPECTROGRAM_ZERO_PADDING.map((value) => ({ label: `${value}x`, value }))
const winFuncs = [...SPECTROGRAM_WIN_FUNCS]
const dataModes = [...SPECTROGRAM_DATA_MODES]
const fscales = [...SPECTROGRAM_FSCALES]
const channelModes = [...SPECTROGRAM_CHANNEL_MODES]
const scales = [...SPECTROGRAM_SCALES]
const palettes = [...SPECTROGRAM_PALETTES]
const presets = [...SPECTROGRAM_PRESETS]

interface SliderSpec {
  readonly key: keyof Pick<SpectrogramSettings, 'gain' | 'frequencyGain' | 'drange' | 'limit' | 'saturation' | 'overlap'>
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

const sliders: readonly SliderSpec[] = [
  { key: 'overlap', label: 'Overlap', min: 0, max: 0.95, step: 0.05, decimals: 2 },
  { key: 'gain', label: 'Gain', min: 0.1, max: 8, step: 0.1, decimals: 1 },
  { key: 'frequencyGain', label: 'Frequency gain (dB/dec)', min: -20, max: 20, step: 1, decimals: 0 },
  { key: 'drange', label: 'Dynamic range (dB)', min: 20, max: 200, step: 5, decimals: 0 },
  { key: 'limit', label: 'Limit (dB)', min: -60, max: 0, step: 1, decimals: 0 },
  { key: 'saturation', label: 'Saturation', min: -10, max: 10, step: 0.5, decimals: 1 },
]
</script>

<style scoped>
.spectrogram-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.spectrogram-settings__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spectrogram-settings__title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
}

.spectrogram-settings__slider {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spectrogram-settings__slider-label {
  display: flex;
  font-size: 12px;
  justify-content: space-between;
}

.spectrogram-settings__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
