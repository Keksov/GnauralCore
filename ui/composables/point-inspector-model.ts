// PI3.1 (point-inspector-panel): the serializable view-model + action contract for «Параметры точки».
//
// Same three-consumer shape as track-list (PW5.7): PointInspectorView is a pure view — it renders a
// PointInspectorSnapshot and emits exactly one PointInspectorAction per committed gesture. It holds no
// composable/gtracks state; only a transient INPUT BUFFER for the numeric fields (PI-D8). Consumers:
//   * the in-window adapter (PointInspectorPanel) builds a snapshot from the shared use-point-inspector
//     singleton and applies actions straight back via applyPointInspectorAction;
//   * the detached child adapter (PointInspectorRemote) receives the snapshot over the panel bridge and
//     forwards actions back — it owns NO gtracks/composable/localStorage state (PW-D11: the child window
//     is a separate JS realm and must not clobber the shared per-file state);
//   * the child's parent (PointInspectorDialog) applies the forwarded actions to the authoritative
//     singletons and pushes the updated snapshot back.
// Everything here MUST stay JSON-serializable — a snapshot and every action cross a BroadcastChannel.

/** Single-point form values. `beatFreq` is the FULL beat (2x half, GT-D6) as shown/edited. */
export interface PointFormValues {
  readonly timeSec: number
  readonly baseFreq: number
  readonly beatFreq: number
  readonly volL: number
  readonly volR: number
}

/** One row of the multi-select table. `timeSec` is read-only there (GT10.40). */
export interface PointTableRow {
  readonly voiceId: number
  readonly pointIndex: number
  readonly timeSec: number
  readonly baseFreq: number
  readonly beatFreq: number
  readonly volL: number
  readonly volR: number
}

export interface PointTableGroup {
  readonly voiceId: number
  readonly name: string
  readonly rows: readonly PointTableRow[]
}

export interface PointInspectorSnapshot {
  readonly mode: 'single' | 'table' | 'none'
  /** Voice display name for the title (empty when nothing is targeted). */
  readonly voiceName: string
  /** Multi-selection size (drives the table-mode title count). */
  readonly multiCount: number
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly autosave: boolean
  // Single mode:
  readonly mono: boolean
  readonly hasNext: boolean
  /** Model-derived form values; null unless mode==='single' with a live point. */
  readonly form: PointFormValues | null
  // Table mode:
  readonly groups: readonly PointTableGroup[]
}

/** Value patch for a table row (time is not editable there). */
export interface PointRowValues {
  readonly baseFreq: number
  readonly beatFreq: number
  readonly volL: number
  readonly volR: number
}

export type PointInspectorAction =
  | { readonly kind: 'apply'; readonly values: PointFormValues }
  | { readonly kind: 'set-autosave'; readonly on: boolean }
  | { readonly kind: 'delete-point' }
  | { readonly kind: 'add-point-right' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'apply-row'; readonly voiceId: number; readonly pointIndex: number; readonly values: PointRowValues }
  | { readonly kind: 'apply-all-rows'; readonly rows: readonly { readonly voiceId: number; readonly pointIndex: number; readonly values: PointRowValues }[] }
  | { readonly kind: 'remove-checked'; readonly refs: readonly { readonly voiceId: number; readonly pointIndex: number }[] }
