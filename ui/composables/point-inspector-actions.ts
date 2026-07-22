// PI3.1 (point-inspector-panel): the authoritative PointInspectorAction -> state mapping, shared by the
// in-window adapter (PointInspectorPanel) and the detached-window parent (PointInspectorDialog). It is a
// total, side-effect-only function: no dialogs, no notifications. The dependencies are typed structurally
// (not via the composable return types) so the applier stays trivially unit-testable with fakes and free
// of Vue/Pinia imports.
import type { PointFormValues, PointInspectorAction, PointRowValues } from './point-inspector-model'

export interface PointInspectorApi {
  /** Commit the single-point form to the current target (one undo unit). */
  readonly commitForm: (values: PointFormValues) => void
  readonly setAutosave: (on: boolean) => void
  readonly deleteCurrentPoint: () => void
  readonly addPointRight: () => void
  readonly undo: () => void
  readonly redo: () => void
  readonly commitRow: (voiceId: number, pointIndex: number, values: PointRowValues) => void
  readonly commitAllRows: (rows: readonly { readonly voiceId: number; readonly pointIndex: number; readonly values: PointRowValues }[]) => void
  readonly removeChecked: (refs: readonly { readonly voiceId: number; readonly pointIndex: number }[]) => void
}

export function applyPointInspectorAction(action: PointInspectorAction, api: PointInspectorApi): void {
  switch (action.kind) {
    case 'apply':
      api.commitForm(action.values)
      break
    case 'set-autosave':
      api.setAutosave(action.on)
      break
    case 'delete-point':
      api.deleteCurrentPoint()
      break
    case 'add-point-right':
      api.addPointRight()
      break
    case 'undo':
      api.undo()
      break
    case 'redo':
      api.redo()
      break
    case 'apply-row':
      api.commitRow(action.voiceId, action.pointIndex, action.values)
      break
    case 'apply-all-rows':
      api.commitAllRows(action.rows)
      break
    case 'remove-checked':
      api.removeChecked(action.refs)
      break
  }
}
