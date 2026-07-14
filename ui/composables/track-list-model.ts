// PW5.7b: the serializable view-model + action contract for the «Список треков» panel.
//
// TrackListView is a pure view: it renders a TrackListSnapshot and emits exactly one TrackListAction
// per user gesture — it holds no gtracks/store state of its own. Three consumers share this contract:
//   * the in-window adapter (TrackListPanel) builds a snapshot from the shared gtracks/overall
//     singletons and applies actions straight back;
//   * the detached child adapter (TrackListRemote, PW5.7c) receives the snapshot over the panel
//     bridge and forwards actions back — it owns NO gtracks/store state (PW-D11: the child window is
//     a separate JS realm and must not clobber the shared localStorage);
//   * the child's parent (TrackListDialog, PW5.7c) applies the forwarded actions to the authoritative
//     singletons.
// Everything here MUST stay JSON-serializable — a snapshot and every action cross a BroadcastChannel.
import type { GTrackMode } from './gtrack-render'
import type { GTrackPointDragMode } from './use-gtrack-lanes'

export interface TrackListVoiceSnapshot {
  readonly id: number
  /** Display name: the trimmed description, or `#<id>` when empty. */
  readonly label: string
  readonly type: string
  /** GT-D9: a generator-expanded (preparse) voice — shows the "fix / make editable" control. */
  readonly preparse: boolean
  readonly mode: GTrackMode | null
  readonly visible: boolean
  readonly muted: boolean
  readonly inMix: boolean
  readonly dotColor: string
}

export interface TrackListSnapshot {
  /** gnaural document → the gnaural-only controls (bulk lane actions, point-drag mode) are shown. */
  readonly isGnaural: boolean
  readonly allLanesHidden: boolean
  readonly pointDragMode: GTrackPointDragMode
  readonly waveHidden: boolean
  readonly spectrumHidden: boolean
  readonly voices: readonly TrackListVoiceSnapshot[]
}

export type TrackListAction =
  | { readonly kind: 'merge-all' }
  | { readonly kind: 'spread-all' }
  | { readonly kind: 'show-all-modes' }
  | { readonly kind: 'set-all-hidden'; readonly hidden: boolean }
  | { readonly kind: 'set-all-mode'; readonly mode: GTrackMode }
  | { readonly kind: 'set-voice-mode'; readonly voiceId: number; readonly mode: GTrackMode }
  | { readonly kind: 'set-voice-visible'; readonly voiceId: number; readonly visible: boolean }
  | { readonly kind: 'toggle-voice-muted'; readonly voiceId: number }
  | { readonly kind: 'set-voice-in-mix'; readonly voiceId: number; readonly inMix: boolean }
  | { readonly kind: 'set-point-drag-mode'; readonly mode: GTrackPointDragMode }
  | { readonly kind: 'fix-preparse'; readonly voiceId: number }
  | { readonly kind: 'set-wave-hidden'; readonly hidden: boolean }
  | { readonly kind: 'set-spectrum-hidden'; readonly hidden: boolean }
