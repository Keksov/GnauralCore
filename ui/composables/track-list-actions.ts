// PW5.7b: the authoritative TrackListAction -> state mapping, shared by the in-window adapter
// (TrackListPanel) and the detached-window parent (TrackListDialog, PW5.7c). Whichever adapter
// captured the gesture already resolved any confirmation (e.g. the fix-preparse dialog), so this is
// a total, side-effect-only function: no dialogs, no notifications beyond the optional onFixed hook.
//
// The dependencies are typed structurally (not via the composable return types) so the applier stays
// trivially unit-testable with fakes and free of Vue/Pinia imports.
import type { GTrackMode } from './gtrack-render'
import type { GTrackPointDragMode } from './use-gtrack-lanes'
import type { TrackListAction } from './track-list-model'

export interface TrackListGtracksApi {
  readonly mergeAllIntoOneLane: () => void
  readonly spreadPerVoiceLanes: () => void
  readonly showAllModesPerVoice: () => void
  /** VS4.1: one lane per voice with every display mode checked (a per-mode graph stack). */
  readonly allModesOneLanePerVoice: () => void
  readonly setAllLanesHidden: (hidden: boolean) => void
  readonly setAllLanesMode: (mode: GTrackMode) => void
  readonly setVoiceMode: (voiceId: number, mode: GTrackMode) => void
  readonly setVoiceVisible: (voiceId: number, visible: boolean) => void
  readonly setVoiceInMix: (voiceId: number, inMix: boolean) => void
  readonly setPointDragMode: (mode: GTrackPointDragMode) => void
  readonly fixPreparseVoice: (voiceId: number) => boolean
}

export interface TrackListOverallApi {
  readonly setWaveHidden: (hidden: boolean) => void
  readonly setSpectrumHidden: (hidden: boolean) => void
}

export interface TrackListActionContext {
  readonly gtracks: TrackListGtracksApi
  readonly overall: TrackListOverallApi
  /** Mute is not a gtracks edit: it round-trips through AudioPage (voice_mute patch + reload). */
  readonly toggleVoiceMuted: (voiceId: number) => void
  /** Called after a successful fixPreparseVoice — the caller decides whether to notify. */
  readonly onFixed?: () => void
}

export function applyTrackListAction(action: TrackListAction, ctx: TrackListActionContext): void {
  switch (action.kind) {
    case 'merge-all':
      ctx.gtracks.mergeAllIntoOneLane()
      break
    case 'spread-all':
      ctx.gtracks.spreadPerVoiceLanes()
      break
    case 'show-all-modes':
      ctx.gtracks.showAllModesPerVoice()
      break
    case 'show-all-modes-stacked':
      ctx.gtracks.allModesOneLanePerVoice()
      break
    case 'set-all-hidden':
      ctx.gtracks.setAllLanesHidden(action.hidden)
      break
    case 'set-all-mode':
      ctx.gtracks.setAllLanesMode(action.mode)
      break
    case 'set-voice-mode':
      ctx.gtracks.setVoiceMode(action.voiceId, action.mode)
      break
    case 'set-voice-visible':
      ctx.gtracks.setVoiceVisible(action.voiceId, action.visible)
      break
    case 'toggle-voice-muted':
      ctx.toggleVoiceMuted(action.voiceId)
      break
    case 'set-voice-in-mix':
      ctx.gtracks.setVoiceInMix(action.voiceId, action.inMix)
      break
    case 'set-point-drag-mode':
      ctx.gtracks.setPointDragMode(action.mode)
      break
    case 'fix-preparse':
      if (ctx.gtracks.fixPreparseVoice(action.voiceId)) {
        ctx.onFixed?.()
      }
      break
    case 'set-wave-hidden':
      ctx.overall.setWaveHidden(action.hidden)
      break
    case 'set-spectrum-hidden':
      ctx.overall.setSpectrumHidden(action.hidden)
      break
  }
}
