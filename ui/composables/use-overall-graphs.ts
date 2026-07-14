// PW5.4: shared visibility (fold) state for the OVERALL waveform + spectrogram tracks. Both the Треки
// tab (which renders the stacks with a fold header) and the AudioPage-hosted «Список треков» panel
// (which lists them as rows with a show/hide eye) toggle ONE reactive source. Persisted to the
// existing 'mindwave-tracks-overall-folded' key (per-tab UI state, like heights / view-mode).
import { effectScope, ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'mindwave-tracks-overall-folded'

export interface OverallGraphsState {
  readonly waveFolded: Ref<boolean>
  readonly spectrumFolded: Ref<boolean>
  toggleWaveFolded: () => void
  toggleSpectrumFolded: () => void
}

let shared: OverallGraphsState | null = null

export function useOverallGraphs(): OverallGraphsState {
  if (shared === null) {
    const scope = effectScope(true)
    shared = scope.run(() => {
      const waveFolded = ref(false)
      const spectrumFolded = ref(false)
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw) as { wave?: boolean; spectrum?: boolean }
          waveFolded.value = parsed.wave === true
          spectrumFolded.value = parsed.spectrum === true
        }
      } catch { /* ignore */ }
      watch([waveFolded, spectrumFolded], () => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ wave: waveFolded.value, spectrum: spectrumFolded.value }))
        } catch { /* ignore */ }
      })
      return {
        waveFolded,
        spectrumFolded,
        toggleWaveFolded: () => { waveFolded.value = !waveFolded.value },
        toggleSpectrumFolded: () => { spectrumFolded.value = !spectrumFolded.value },
      }
    }) ?? null
    if (shared === null) throw new Error('useOverallGraphs: initialisation failed')
  }
  return shared
}
