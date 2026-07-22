// PI3.1 (point-inspector-panel): build the reactive «Параметры точки» snapshot from the authoritative
// singletons (shared gtracks + the use-point-inspector target/mode). Both the in-window adapter
// (PointInspectorPanel) and the detached-window parent (PointInspectorDialog) read the SAME snapshot —
// the latter pushes it over the panel bridge to the stateless child. Form/table values are MODEL-derived
// (rounded to 3 decimals, beat shown as the full 2x-half), NOT the view's input buffer (PI-D8). Must run
// where the singletons are live (main window only).
import { computed, type ComputedRef } from 'vue'
import { useSharedGtrackLanes } from './use-gtrack-lanes'
import { usePointInspector } from './use-point-inspector'
import type { PointFormValues, PointInspectorSnapshot, PointTableGroup, PointTableRow } from './point-inspector-model'

const r3 = (n: number): number => Number(n.toFixed(3))

export function usePointInspectorSnapshot(): ComputedRef<PointInspectorSnapshot> {
  const gtracks = useSharedGtrackLanes()
  const inspector = usePointInspector()

  return computed<PointInspectorSnapshot>(() => {
    const mode = inspector.inspectorMode.value
    const target = inspector.pointDialogTarget.value

    let form: PointFormValues | null = null
    if (mode === 'single' && target !== null) {
      const point = gtracks.getVoice(target.voiceId)?.points[target.pointIndex]
      if (point !== undefined) {
        form = {
          timeSec: r3(point.timeSec),
          baseFreq: r3(point.baseFreq),
          beatFreq: r3(point.beatFreqHalf * 2), // display = full beat (GT-D6)
          volL: r3(point.volL),
          volR: r3(point.volR),
        }
      }
    }

    const groups: PointTableGroup[] = []
    if (mode === 'table') {
      const byVoice = new Map<number, { voiceId: number; name: string; rows: PointTableRow[] }>()
      for (const { voiceId, pointIndex, point } of gtracks.multiSelectionPoints.value) {
        let g = byVoice.get(voiceId)
        if (g === undefined) {
          const v = gtracks.getVoice(voiceId)
          const name = v === undefined ? `#${voiceId}` : v.description.trim() !== '' ? v.description : `#${v.id}`
          g = { voiceId, name, rows: [] }
          byVoice.set(voiceId, g)
        }
        g.rows.push({
          voiceId,
          pointIndex,
          timeSec: r3(point.timeSec),
          baseFreq: r3(point.baseFreq),
          beatFreq: r3(point.beatFreqHalf * 2),
          volL: r3(point.volL),
          volR: r3(point.volR),
        })
      }
      groups.push(...byVoice.values())
    }

    return {
      mode,
      voiceName: inspector.pointDialogVoiceName.value,
      multiCount: gtracks.multiSelection.value.size,
      canUndo: gtracks.canUndo.value,
      canRedo: gtracks.canRedo.value,
      autosave: gtracks.pointAutosave.value,
      mono: inspector.pointDialogVoiceMono.value,
      hasNext: inspector.pointDialogHasNext.value,
      form,
      groups,
    }
  })
}
