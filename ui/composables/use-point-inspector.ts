// PI1.1 (point-inspector-panel): the point inspector's TARGET + authoritative model operations, lifted
// out of TracksPanel so they can be shared by the Треки tab (which triggers open on a vertex click) AND
// the AudioPage-hosted PanelWindow that renders it (PI-D5). Like useSharedGtrackLanes (PW5.6a) this is a
// process-wide SINGLETON living in a DETACHED effect scope: its selection-follow watch then lives for the
// app's lifetime, which is what a shared inspector wants.
//
// PI3.x (PI-D8): the input BUFFER (the numeric-field state, the multi-select table, the derived
// volume/balance and the Alt+Arrow big-step) moved into the pure PointInspectorView, which both the
// in-window adapter and the detached child render. This composable keeps only the target/mode + the
// authoritative, value-taking commit operations that applyPointInspectorAction drives.
//
// Deliberately UI-free: it never calls useI18n/useQuasar (unavailable in a detached scope with no
// component instance). The $q confirm for a locked (preparse) voice and the i18n labels stay in the
// hosting component; this composable only exposes state + model operations over the shared gtracks.

import { computed, effectScope, ref, watch } from 'vue'
import { useSharedGtrackLanes, type GTrackPointRef } from './use-gtrack-lanes'
import type { PointFormValues, PointRowValues } from './point-inspector-model'

export interface PointInspectorTarget {
  laneId: number
  voiceId: number
  pointIndex: number
}

function buildPointInspector() {
  const gtracks = useSharedGtrackLanes()

  // GT3.3/GT3.12: the point inspector. Opened by double-clicking a vertex in point mode; edits every
  // entry field in one undo unit (time uses crossover semantics — see applyPointEdit). GT3.12 (GT-D18)
  // makes it a non-modal LIVE inspector: follows the selection, delete-node + add-node-to-the-right.
  const pointDialogTarget = ref<PointInspectorTarget | null>(null)

  const pointDialogVoiceName = computed(() => {
    const tgt = pointDialogTarget.value
    if (tgt === null) return ''
    const v = gtracks.getVoice(tgt.voiceId)
    if (v === undefined) return ''
    return v.description.trim() !== '' ? v.description : `#${v.id}`
  })
  const pointDialogVoiceMono = computed(() => {
    const tgt = pointDialogTarget.value
    return tgt !== null && (gtracks.getVoice(tgt.voiceId)?.mono ?? false)
  })
  /** Whether the inspected point has a right neighbour (Add-node-right needs one to interpolate into). */
  const pointDialogHasNext = computed(() => {
    const tgt = pointDialogTarget.value
    if (tgt === null) return false
    const voice = gtracks.getVoice(tgt.voiceId)
    return voice !== undefined && tgt.pointIndex < voice.points.length - 1
  })

  // GT10.33: auto-close when the targeted point vanished (deleted elsewhere) — UNLESS the voice was fully
  // emptied (last point deleted), which keeps the panel open with the frozen snapshot so the user can Undo.
  function closeIfPointGone(): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    const voice = gtracks.getVoice(tgt.voiceId)
    if (voice === undefined) {
      pointDialogTarget.value = null // the voice is gone — nothing to show
      return
    }
    if (voice.points[tgt.pointIndex] === undefined && voice.points.length > 0) {
      pointDialogTarget.value = null
    }
  }

  // PI1.1: the non-prompt core of the old openPointDialog. The preparse gate ($q confirm) stays in the
  // hosting component (it needs i18n + Quasar) and calls this only when the voice is editable.
  // GT10.35 (owner 2026-07-12): move the visual focus (selected vertex / white circle) to the clicked
  // point too, so it doesn't stay on the previously added/selected node.
  function setTarget(laneId: number, p: GTrackPointRef): void {
    pointDialogTarget.value = { laneId, voiceId: p.voiceId, pointIndex: p.pointIndex }
    gtracks.selectPoint(laneId, { voiceId: p.voiceId, pointIndex: p.pointIndex })
  }

  // GT3.16 (review #4): closing the inspector clears BOTH the multi-selection and the single target, so
  // dismissing the table can't "reveal" a stale single inspector left over from before the
  // multi-selection began.
  function closeInspector(): void {
    gtracks.clearMultiSelection()
    pointDialogTarget.value = null
  }

  // GT3.12 (owner req. 27+29): while the inspector is open, follow the selection — clicking or dragging a
  // different vertex re-targets it (the crossover re-index and a plain click stay in sync in one flush).
  // The view re-derives its fields from the snapshot; here we only keep the target valid.
  watch(
    () => [gtracks.selection.value, gtracks.voices.value] as const,
    ([sel]) => {
      const tgt = pointDialogTarget.value
      if (tgt === null) return
      if (sel !== null && (sel.voiceId !== tgt.voiceId || sel.pointIndex !== tgt.pointIndex)) {
        pointDialogTarget.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: sel.pointIndex }
        return
      }
      closeIfPointGone()
    },
  )

  // GT3.15 (owner req. 30, GT-D18): the inspector shows the single-point form, or — once 2+ vertices are
  // Ctrl/Shift-selected — a table. Table mode takes priority whenever it applies.
  const inspectorMode = computed<'single' | 'table' | 'none'>(() => {
    if (gtracks.multiSelection.value.size >= 2) return 'table'
    if (pointDialogTarget.value !== null) return 'single'
    return 'none'
  })

  // GT10.36 (owner 2026-07-12): after undo/redo, move the focus to the point that CHANGED — a restored
  // (previously deleted) node becomes selected, wherever it landed. We diff the inspected voice's point
  // times before/after: a time that (re)appears is the restored/added node.
  function withRestoredFocus(op: () => void): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) { op(); return }
    const { laneId, voiceId } = tgt
    const before = gtracks.getVoice(voiceId)?.points.map((p) => p.timeSec) ?? []
    op()
    const voice = gtracks.getVoice(voiceId)
    if (voice === undefined) return
    // Multiset of prior times; the first current point whose time isn't accounted for is the one that
    // (re)appeared (a restored/added node).
    const remaining = new Map<number, number>()
    for (const t of before) remaining.set(t, (remaining.get(t) ?? 0) + 1)
    let idx = -1
    for (let i = 0; i < voice.points.length; i += 1) {
      const t = voice.points[i]!.timeSec
      const n = remaining.get(t) ?? 0
      if (n > 0) { remaining.set(t, n - 1); continue }
      idx = i
      break
    }
    if (idx < 0) idx = Math.min(tgt.pointIndex, voice.points.length - 1) // no new node — keep/clamp
    if (idx < 0) return
    pointDialogTarget.value = { laneId, voiceId, pointIndex: idx }
    gtracks.selectPoint(laneId, { voiceId, pointIndex: idx })
  }
  function undoWithFocus(): void { withRestoredFocus(() => gtracks.undoEdit()) }
  function redoWithFocus(): void { withRestoredFocus(() => gtracks.redoEdit()) }

  // GT3.12 (owner req. 31) / GT10.33 (owner req. 82, revised 2026-07-12): delete the inspected point and
  // MOVE FOCUS — to the right neighbour (same index after the shift), else the previous point. Deleting
  // the LAST point empties the voice but keeps the dialog OPEN (frozen values) so the user can Undo. No
  // min-2 floor / no block.
  function deleteCurrentPointFromDialog(): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    const voice = gtracks.getVoice(tgt.voiceId)
    if (voice === undefined) return
    const countBefore = voice.points.length
    const idx = tgt.pointIndex
    if (!gtracks.deletePointAt(tgt.laneId, { voiceId: tgt.voiceId, pointIndex: idx })) return
    const remaining = countBefore - 1
    if (remaining <= 0) return // voice emptied — leave the dialog open (frozen) for Undo
    // Right neighbour has shifted into `idx`; if we deleted the last point, fall back to the previous.
    const nextIndex = Math.min(idx, remaining - 1)
    pointDialogTarget.value = { laneId: tgt.laneId, voiceId: tgt.voiceId, pointIndex: nextIndex }
    gtracks.selectPoint(tgt.laneId, { voiceId: tgt.voiceId, pointIndex: nextIndex })
  }
  // GT3.12 (owner req. 32): insert an interpolated point to the right, at the midpoint of the segment
  // leading to the next point (disabled when this is the voice's last point).
  function addPointToRight(): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    const voice = gtracks.getVoice(tgt.voiceId)
    const cur = voice?.points[tgt.pointIndex]
    const next = voice?.points[tgt.pointIndex + 1]
    if (voice === undefined || cur === undefined || next === undefined) return
    gtracks.insertPointAt(tgt.laneId, tgt.voiceId, (cur.timeSec + next.timeSec) / 2)
  }

  // PI3.2 (point-inspector-panel): value-taking commit methods invoked by applyPointInspectorAction — the
  // same authoritative applier used by the in-window adapter and the detached-window parent. The view
  // holds the input buffer; these take explicit committed values (beat = full, GT-D6).
  function toValuePatch(v: { baseFreq: number; beatFreq: number; volL: number; volR: number }) {
    return {
      baseFreq: Math.max(0, Number(v.baseFreq) || 0),
      beatFreqHalf: Math.max(0, Number(v.beatFreq) || 0) / 2,
      volL: Math.max(0, Math.min(1, Number(v.volL) || 0)),
      volR: Math.max(0, Math.min(1, Number(v.volR) || 0)),
    }
  }
  function commitForm(values: PointFormValues): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    gtracks.applyPointEdit(
      { voiceId: tgt.voiceId, pointIndex: tgt.pointIndex },
      { timeSec: Math.max(0, Number(values.timeSec) || 0), ...toValuePatch(values) },
    )
  }
  function setAutosave(on: boolean): void {
    gtracks.setPointAutosave(on)
  }
  function commitRow(voiceId: number, pointIndex: number, values: PointRowValues): void {
    gtracks.setPointValues({ voiceId, pointIndex }, toValuePatch(values))
  }
  function commitAllRows(rowsIn: readonly { readonly voiceId: number; readonly pointIndex: number; readonly values: PointRowValues }[]): void {
    gtracks.setMultiplePointValues(rowsIn.map((r) => ({ ref: { voiceId: r.voiceId, pointIndex: r.pointIndex }, patch: toValuePatch(r.values) })))
  }
  function removeChecked(refs: readonly { readonly voiceId: number; readonly pointIndex: number }[]): void {
    gtracks.removePointsBulk(refs.map((r) => ({ voiceId: r.voiceId, pointIndex: r.pointIndex })))
  }

  return {
    // state
    pointDialogTarget,
    // computed
    pointDialogVoiceName,
    pointDialogVoiceMono,
    pointDialogHasNext,
    inspectorMode,
    // target ops
    setTarget,
    closeInspector,
    undoWithFocus,
    redoWithFocus,
    deleteCurrentPointFromDialog,
    addPointToRight,
    // PI3.2: value-taking commit methods for the remote-control applier
    commitForm,
    setAutosave,
    commitRow,
    commitAllRows,
    removeChecked,
  }
}

// Process-wide singleton (PI-D5), mirroring useSharedGtrackLanes: a detached effect scope keeps the
// inspector's watch alive for the app's lifetime and shared across every window/component that reads it.
let sharedPointInspector: ReturnType<typeof buildPointInspector> | null = null

export function usePointInspector(): ReturnType<typeof buildPointInspector> {
  if (sharedPointInspector === null) {
    const scope = effectScope(true)
    sharedPointInspector = scope.run(() => buildPointInspector()) ?? null
    if (sharedPointInspector === null) throw new Error('usePointInspector: initialisation failed')
  }
  return sharedPointInspector
}
