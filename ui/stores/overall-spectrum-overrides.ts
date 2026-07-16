// SG3.1 (SG-D7): reactive + persisted wrapper around the pure per-channel override model
// (composables/overall-spectrum-overrides). The MAIN window is authoritative: a detached «Параметры»
// panel runs its own Pinia (SS-D3), so — like the program-level store — the child never writes here
// directly; it bridges actions back to the parent (that is SG3.2's remote wiring).
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { SpectrogramSettings } from '../composables/spectrogram-settings'
import {
  channelOverride,
  clearBothOverride,
  clearChannelOverride,
  emptyOverrides,
  ensureChannelOverride,
  isChannelIndividual,
  loadOverrides,
  setBothOverride,
  setChannelOverride,
  type SpectrumOverrides,
} from '../composables/overall-spectrum-overrides'

const STORAGE_KEY = 'mindwave-spectrogram-channel-overrides'

function loadFromStorage(): SpectrumOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? emptyOverrides() : loadOverrides(JSON.parse(raw))
  } catch {
    return emptyOverrides()
  }
}

export const useOverallSpectrumOverridesStore = defineStore('overall-spectrum-overrides', () => {
  const overrides = ref<SpectrumOverrides>(loadFromStorage())

  function getChannel(ch: number): SpectrogramSettings | null {
    return channelOverride(overrides.value, ch)
  }
  function isIndividual(ch: number): boolean {
    return isChannelIndividual(overrides.value, ch)
  }
  function setChannel(ch: number, settings: SpectrogramSettings): void {
    overrides.value = setChannelOverride(overrides.value, ch, settings)
  }
  function ensureChannel(ch: number, seed: SpectrogramSettings): void {
    overrides.value = ensureChannelOverride(overrides.value, ch, seed)
  }
  function clearChannel(ch: number): void {
    overrides.value = clearChannelOverride(overrides.value, ch)
  }
  function setBoth(settings: SpectrogramSettings): void {
    overrides.value = setBothOverride(settings)
  }
  function clearBoth(): void {
    overrides.value = clearBothOverride()
  }

  watch(
    overrides,
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // best-effort, matching the other spectrogram persistence
      }
    },
    { deep: true },
  )

  return { overrides, getChannel, isIndividual, setChannel, ensureChannel, clearChannel, setBoth, clearBoth }
})
