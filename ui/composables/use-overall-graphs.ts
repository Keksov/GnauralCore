// PW5.4 / PW5.8: shared visibility state for the OVERALL waveform + spectrogram tracks. Both the Треки
// tab (which renders the stacks) and the AudioPage-hosted «Список треков» panel (which lists them as
// rows) toggle ONE reactive source. Two independent states per graph: FOLDED (collapse to the header
// bar) and HIDDEN (fully removed, incl. the header — restored from the hidden-tracks dropdown, like a
// gtrack lane). Persisted to 'mindwave-tracks-overall-folded' (back-compatible: old data has only
// wave/spectrum).
import { effectScope, ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'mindwave-tracks-overall-folded'

export interface OverallGraphsState {
  readonly waveFolded: Ref<boolean>
  readonly spectrumFolded: Ref<boolean>
  readonly waveHidden: Ref<boolean>
  readonly spectrumHidden: Ref<boolean>
  toggleWaveFolded: () => void
  toggleSpectrumFolded: () => void
  setWaveHidden: (hidden: boolean) => void
  setSpectrumHidden: (hidden: boolean) => void
}

let shared: OverallGraphsState | null = null

export function useOverallGraphs(): OverallGraphsState {
  if (shared === null) {
    const scope = effectScope(true)
    shared = scope.run(() => {
      const waveFolded = ref(false)
      const spectrumFolded = ref(false)
      const waveHidden = ref(false)
      const spectrumHidden = ref(false)
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
          const p = JSON.parse(raw) as { wave?: boolean; spectrum?: boolean; waveHidden?: boolean; spectrumHidden?: boolean }
          waveFolded.value = p.wave === true
          spectrumFolded.value = p.spectrum === true
          waveHidden.value = p.waveHidden === true
          spectrumHidden.value = p.spectrumHidden === true
        }
      } catch { /* ignore */ }
      watch([waveFolded, spectrumFolded, waveHidden, spectrumHidden], () => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            wave: waveFolded.value,
            spectrum: spectrumFolded.value,
            waveHidden: waveHidden.value,
            spectrumHidden: spectrumHidden.value,
          }))
        } catch { /* ignore */ }
      })
      return {
        waveFolded,
        spectrumFolded,
        waveHidden,
        spectrumHidden,
        toggleWaveFolded: () => { waveFolded.value = !waveFolded.value },
        toggleSpectrumFolded: () => { spectrumFolded.value = !spectrumFolded.value },
        setWaveHidden: (hidden: boolean) => { waveHidden.value = hidden },
        setSpectrumHidden: (hidden: boolean) => { spectrumHidden.value = hidden },
      }
    }) ?? null
    if (shared === null) throw new Error('useOverallGraphs: initialisation failed')
  }
  return shared
}
