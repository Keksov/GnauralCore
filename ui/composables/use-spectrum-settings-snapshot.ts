// SS3.1 (SS-D2): the reactive «Параметры» snapshot, built from the spectrogram store singleton. The
// in-window adapter renders it directly; PanelWindow pushes it to the detached child (which has no
// store of its own — PW-D11 / SS-D3). Must run where Pinia is active (main window only).
import { computed, type ComputedRef } from 'vue'
import { useSpectrogramStore } from '../stores/spectrogram'
import type { SpectrumSettingsSnapshot } from './spectrum-settings-model'

export function useSpectrumSettingsSnapshot(): ComputedRef<SpectrumSettingsSnapshot> {
  const store = useSpectrogramStore()
  return computed<SpectrumSettingsSnapshot>(() => ({
    // Clone so the snapshot is a plain serializable value, not the store's reactive proxy.
    settings: { ...store.settings },
    presets: store.allPresets.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })),
    activePresetId: store.activePresetId,
    isModified: store.isModified,
  }))
}
