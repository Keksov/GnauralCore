import { computed, reactive } from 'vue'
import { defineStore } from 'pinia'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  toAnalysisParams,
  toRenderOptions,
  type SpectrogramSettings,
} from '../composables/spectrogram-settings'

type MutableSpectrogramSettings = { -readonly [K in keyof SpectrogramSettings]: SpectrogramSettings[K] }

/**
 * Spectrogram settings store (U4.1): the full backend capability set (DU4) bound
 * to the panel. `renderOptions` (client-side, live) and `analysisParams` (worker
 * re-analysis) are derived groups consumed by the view (DU5). Persistence +
 * apply-semantics polish are U4.2.
 */
export const useSpectrogramStore = defineStore('spectrogram', () => {
  const settings = reactive<MutableSpectrogramSettings>({ ...DEFAULT_SPECTROGRAM_SETTINGS })

  const renderOptions = computed(() => toRenderOptions(settings))
  const analysisParams = computed(() => toAnalysisParams(settings))

  function reset(): void {
    Object.assign(settings, DEFAULT_SPECTROGRAM_SETTINGS)
  }

  return { settings, renderOptions, analysisParams, reset }
})
