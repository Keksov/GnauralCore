// PW5.7b: build the reactive «Список треков» snapshot from the authoritative singletons (shared
// gtracks + overall graphs) and the audio store. Both the in-window adapter (TrackListPanel) and the
// detached-window parent (TrackListDialog, PW5.7c) read the SAME snapshot — the latter pushes it over
// the panel bridge to the stateless child. Must run where Pinia is active (main window only).
import { computed, type ComputedRef } from 'vue'
import { useSharedGtrackLanes } from './use-gtrack-lanes'
import { useOverallGraphs } from './use-overall-graphs'
import { voiceDotColor } from './gtrack-voice-color'
import { useAudioStore } from '../stores/audio'
import type { TrackListSnapshot } from './track-list-model'

export function useTrackListSnapshot(): ComputedRef<TrackListSnapshot> {
  const audio = useAudioStore()
  const gtracks = useSharedGtrackLanes()
  const overall = useOverallGraphs()

  // BK8a: mute lives in the schedule dump (the editor model drops it), not in gtracks.
  const isVoiceMuted = (voiceId: number): boolean =>
    audio.gnauralSchedule?.voices.find((v) => v.id === voiceId)?.muted ?? false

  return computed<TrackListSnapshot>(() => ({
    isGnaural: audio.displayMode === 'gnaural',
    allLanesHidden: gtracks.allLanesHidden.value,
    pointDragMode: gtracks.pointDragMode.value,
    baseScaleMode: gtracks.baseScaleMode.value,
    waveHidden: overall.waveHidden.value,
    spectrumHidden: overall.spectrumHidden.value,
    voices: gtracks.voices.value.map((v, vi) => ({
      id: v.id,
      label: v.description.trim() !== '' ? v.description : `#${v.id}`,
      type: v.type,
      preparse: gtracks.isVoicePreparse(v.id),
      mode: gtracks.voiceMode(v.id),
      visible: gtracks.isVoiceVisible(v.id),
      muted: isVoiceMuted(v.id),
      inMix: gtracks.isVoiceInMix(v.id),
      dotColor: voiceDotColor(v, vi),
    })),
  }))
}
