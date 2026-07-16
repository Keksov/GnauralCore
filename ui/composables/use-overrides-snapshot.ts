// SG3.2b (SG-D6, PW5.7 «пульт»): the reactive per-graph OverridesSnapshot + the apply context, both
// built from the two authoritative stores (program-level spectrogram + per-channel overrides). The
// in-window adapter renders the snapshot directly and applies actions locally; SpectrumSettingsDialog
// pushes the SAME snapshot to the detached child and applies its bridged actions here (SS-D3 — only
// the main window writes the override store). Must run where Pinia is active (main window only).
import { computed, type ComputedRef } from 'vue'
import { useSpectrogramStore } from '../stores/spectrogram'
import { useOverallSpectrumOverridesStore } from '../stores/overall-spectrum-overrides'
import {
  applyOverridesAction,
  type OverridesAction,
  type OverridesSnapshot,
} from './overall-spectrum-overrides-model'

export function useOverridesSnapshot(): ComputedRef<OverridesSnapshot> {
  const store = useSpectrogramStore()
  const overrides = useOverallSpectrumOverridesStore()
  return computed<OverridesSnapshot>(() => {
    const ch0 = overrides.getChannel(0)
    const ch1 = overrides.getChannel(1)
    return {
      // Clone so the snapshot is plain serializable data, not the stores' reactive proxies.
      program: { ...store.settings },
      channel0: ch0 === null ? null : { ...ch0 },
      channel1: ch1 === null ? null : { ...ch1 },
      presets: store.allPresets.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })),
    }
  })
}

/** The apply function bound to the live stores — shared by the in-window adapter and the bridge. */
export function useApplyOverridesAction(): (action: OverridesAction) => void {
  const store = useSpectrogramStore()
  const overrides = useOverallSpectrumOverridesStore()
  return (action: OverridesAction): void => {
    applyOverridesAction(action, {
      overrides,
      program: store.settings,
      findPreset: (id) => store.allPresets.find((p) => p.id === id)?.settings,
    })
  }
}
