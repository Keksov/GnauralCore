import { computed, reactive, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  mergeStoredSettings,
  presetSettings,
  toAnalysisParams,
  toRenderOptions,
  type SpectrogramPresetName,
  type SpectrogramSettings,
} from '../composables/spectrogram-settings'

type MutableSpectrogramSettings = { -readonly [K in keyof SpectrogramSettings]: SpectrogramSettings[K] }

const STORAGE_KEY = 'mindwave-spectrogram-settings'

function loadStoredSettings(): SpectrogramSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return mergeStoredSettings(raw === null ? null : (JSON.parse(raw) as unknown))
  } catch {
    return { ...DEFAULT_SPECTROGRAM_SETTINGS }
  }
}

function persistSettings(aSettings: SpectrogramSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aSettings))
  } catch {
    // storage unavailable -> ignore
  }
}

/**
 * Spectrogram settings store (U4.1): the full backend capability set (DU4) bound
 * to the panel. `renderOptions` (client-side, live) and `analysisParams` (worker
 * re-analysis) are derived groups consumed by the view (DU5). Persistence +
 * apply-semantics polish are U4.2.
 */
export const useSpectrogramStore = defineStore('spectrogram', () => {
  const settings = reactive<MutableSpectrogramSettings>(loadStoredSettings())

  const renderOptions = computed(() => toRenderOptions(settings))
  const analysisParams = computed(() => toAnalysisParams(settings))

  // persist any change (U4.2)
  watch(settings, () => persistSettings(settings), { deep: true })

  function reset(): void {
    Object.assign(settings, DEFAULT_SPECTROGRAM_SETTINGS)
  }

  function applyPreset(aName: SpectrogramPresetName): void {
    const preset = presetSettings(aName)
    if (preset !== null) {
      Object.assign(settings, preset)
    }
  }

  return { settings, renderOptions, analysisParams, reset, applyPreset }
})
