// PI1.1 (point-inspector-panel): the point inspector's MODEL/FORM state + logic, lifted out of
// TracksPanel so it can be shared by the Треки tab (which triggers open on a vertex click) AND the
// AudioPage-hosted PanelWindow that will render it (PI-D5). Like useSharedGtrackLanes (PW5.6a) this is
// a process-wide SINGLETON living in a DETACHED effect scope: its watches (selection-follow, table
// reconcile) then live for the app's lifetime, which is what a shared inspector wants.
//
// Deliberately UI-free: it never calls useI18n/useQuasar (unavailable in a detached scope with no
// component instance). The $q confirm for a locked (preparse) voice and the i18n labels stay in the
// hosting component; this composable only exposes state + model operations over the shared gtracks.
//
// The behaviour is a straight port of TracksPanel's GT3.x/GT10.x inspector — the comments below carry
// the original owner-requirement references.

import { computed, effectScope, reactive, ref, watch } from 'vue'
import { useSharedGtrackLanes, type GTrackPointRef } from './use-gtrack-lanes'
import { ctrlStepValue } from './gtrack-render'
import type { PointFormValues, PointRowValues } from './point-inspector-model'

export interface PointInspectorTarget {
  laneId: number
  voiceId: number
  pointIndex: number
}

export interface MultiFormRow {
  voiceId: number
  pointIndex: number
  /** GT10.40 (owner 2026-07-12): the point time, shown read-only (editing time needs crossover
   *  reindexing, which would desync the multi-selection keys — use the single-point dialog for that). */
  timeSec: number
  baseFreq: number
  beatFreq: number
  volL: number
  volR: number
  /** GT10.9 (owner req. 54): row selection for 'delete selected' (all checked by default). */
  checked: boolean
}

export interface MultiFormGroup {
  voiceId: number
  name: string
  rows: MultiFormRow[]
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

function buildPointInspector() {
  const gtracks = useSharedGtrackLanes()

  // GT3.3/GT3.12: the point inspector. Opened by double-clicking a vertex in point mode; edits every
  // entry field in one undo unit (time uses crossover semantics — see applyPointEdit). GT3.12 (GT-D18)
  // makes it a non-modal LIVE inspector: follows the selection, live values while dragging, field-level
  // autosave, delete-node + add-node-to-the-right.
  const pointDialogTarget = ref<PointInspectorTarget | null>(null)
  const pointForm = reactive({ timeSec: 0, baseFreq: 0, beatFreq: 0, volL: 0, volR: 0 })

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

  function syncPointFormFromModel(): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    const voice = gtracks.getVoice(tgt.voiceId)
    if (voice === undefined) {
      pointDialogTarget.value = null // the voice is gone — nothing to show
      return
    }
    const point = voice.points[tgt.pointIndex] ?? null
    if (point === null) {
      // GT10.33 (owner 2026-07-12): if the voice was emptied (last point deleted), KEEP the dialog
      // open with the frozen values so the user can Undo. Otherwise the point was deleted elsewhere
      // while others remain — close.
      if (voice.points.length === 0) return
      pointDialogTarget.value = null
      return
    }
    pointForm.timeSec = Number(point.timeSec.toFixed(3))
    pointForm.baseFreq = Number(point.baseFreq.toFixed(3))
    pointForm.beatFreq = Number((point.beatFreqHalf * 2).toFixed(3)) // display = full beat (GT-D6)
    pointForm.volL = Number(point.volL.toFixed(3))
    pointForm.volR = Number(point.volR.toFixed(3))
  }

  // PI1.1: the non-prompt core of the old openPointDialog. The preparse gate ($q confirm) stays in the
  // hosting component (it needs i18n + Quasar) and calls this only when the voice is editable.
  // GT10.35 (owner 2026-07-12): move the visual focus (selected vertex / white circle) to the clicked
  // point too, so it doesn't stay on the previously added/selected node.
  function setTarget(laneId: number, p: GTrackPointRef): void {
    pointDialogTarget.value = { laneId, voiceId: p.voiceId, pointIndex: p.pointIndex }
    gtracks.selectPoint(laneId, { voiceId: p.voiceId, pointIndex: p.pointIndex })
    syncPointFormFromModel()
  }

  function closePointDialog(): void {
    pointDialogTarget.value = null
  }
  // GT3.16 (review #4): closing the inspector clears BOTH the multi-selection and the single target, so
  // dismissing the table can't "reveal" a stale single inspector left over from before the
  // multi-selection began.
  function closeInspector(): void {
    gtracks.clearMultiSelection()
    pointDialogTarget.value = null
  }

  // GT3.12 (owner req. 27+29): while the inspector is open, follow the selection (clicking or dragging a
  // different vertex re-targets it) and keep the fields live during a drag. A single watch source
  // combining both signals keeps a drag's crossover re-index and a plain click in perfect sync (both can
  // happen in the same reactive flush).
  watch(
    () => [gtracks.selection.value, gtracks.voices.value] as const,
    ([sel]) => {
      const tgt = pointDialogTarget.value
      if (tgt === null) return
      if (sel !== null && (sel.voiceId !== tgt.voiceId || sel.pointIndex !== tgt.pointIndex)) {
        pointDialogTarget.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: sel.pointIndex }
      }
      syncPointFormFromModel()
    },
  )

  // Derived controls (GT-D6): Volume scales L/R preserving balance; Balance re-splits the total.
  const pointFormVolume = computed(() => (pointForm.volL + pointForm.volR) / 2)
  const pointFormBalance = computed(() => {
    const s = pointForm.volL + pointForm.volR
    return s <= 0 ? 0 : (pointForm.volR - pointForm.volL) / s
  })
  // GT3.11 (owner req. 23): SLIDER edits round volumes to 3 decimals; typing into the L/R inputs stays
  // free-form (no rounding there).
  function setPointFormVolume(v: number): void {
    const clamp = (x: number): number => Math.max(0, Math.min(1, x))
    const cur = pointFormVolume.value
    if (pointDialogVoiceMono.value || cur <= 0) {
      pointForm.volL = round3(clamp(v))
      pointForm.volR = round3(clamp(v))
      return
    }
    const f = v / cur
    pointForm.volL = round3(clamp(pointForm.volL * f))
    pointForm.volR = round3(clamp(pointForm.volR * f))
  }
  function setPointFormBalance(b: number): void {
    const clamp = (x: number): number => Math.max(0, Math.min(1, x))
    const s = pointForm.volL + pointForm.volR
    if (s <= 0) return
    const bb = Math.max(-1, Math.min(1, b))
    pointForm.volL = round3(clamp((s * (1 - bb)) / 2))
    pointForm.volR = round3(clamp((s * (1 + bb)) / 2))
  }

  // GT3.12: Apply commits the form to the model — one undo unit — WITHOUT closing the inspector (req 26:
  // only the user closes it; also required for autosave, which calls this repeatedly).
  function applyPointDialog(): void {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    gtracks.applyPointEdit(
      { voiceId: tgt.voiceId, pointIndex: tgt.pointIndex },
      {
        timeSec: Math.max(0, Number(pointForm.timeSec) || 0),
        baseFreq: Math.max(0, Number(pointForm.baseFreq) || 0),
        beatFreqHalf: Math.max(0, Number(pointForm.beatFreq) || 0) / 2,
        volL: Math.max(0, Math.min(1, Number(pointForm.volL) || 0)),
        volR: Math.max(0, Math.min(1, Number(pointForm.volR) || 0)),
      },
    )
  }
  // GT3.12 (owner req. 28): field-level autosave trigger — blur/enter for text inputs, release for
  // sliders (not every keystroke/drag pixel, to avoid one undo entry per character).
  function maybeAutosave(): void {
    if (gtracks.pointAutosave.value) applyPointDialog()
  }

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
    const laneId = tgt.laneId
    const voiceId = tgt.voiceId
    pointDialogTarget.value = { laneId, voiceId, pointIndex: nextIndex }
    gtracks.selectPoint(laneId, { voiceId, pointIndex: nextIndex })
    syncPointFormFromModel()
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

  // GT3.15 (owner req. 30, GT-D18): the inspector shows the single-point form, or — once 2+ vertices are
  // Ctrl/Shift-selected — a table (view/edit VALUE fields across all of them + bulk delete). Table mode
  // takes priority whenever it applies.
  const inspectorMode = computed<'single' | 'table' | 'none'>(() => {
    if (gtracks.multiSelection.value.size >= 2) return 'table'
    if (pointDialogTarget.value !== null) return 'single'
    return 'none'
  })

  const multiForm = ref<MultiFormRow[]>([])
  function modelRow(voiceId: number, pointIndex: number, point: { timeSec: number; baseFreq: number; beatFreqHalf: number; volL: number; volR: number }): MultiFormRow {
    return {
      voiceId,
      pointIndex,
      timeSec: Number(point.timeSec.toFixed(3)),
      baseFreq: Number(point.baseFreq.toFixed(3)),
      beatFreq: Number((point.beatFreqHalf * 2).toFixed(3)),
      volL: Number(point.volL.toFixed(3)),
      volR: Number(point.volR.toFixed(3)),
      checked: true, // GT10.9 (owner req. 54): rows are selected by default
    }
  }
  // GT10.41 (owner 2026-07-12): the table groups its rows by voice under a collapsible header (the
  // separate voice-name column is gone). Group order follows first appearance in the selection.
  const collapsedGroups = ref<Set<number>>(new Set())
  function toggleGroup(voiceId: number): void {
    const next = new Set(collapsedGroups.value)
    if (next.has(voiceId)) next.delete(voiceId)
    else next.add(voiceId)
    collapsedGroups.value = next
  }
  const groupedMultiForm = computed<MultiFormGroup[]>(() => {
    const groups = new Map<number, MultiFormGroup>()
    for (const row of multiForm.value) {
      let g = groups.get(row.voiceId)
      if (g === undefined) {
        g = { voiceId: row.voiceId, name: multiRowVoiceName(row.voiceId), rows: [] }
        groups.set(row.voiceId, g)
      }
      g.rows.push(row)
    }
    return [...groups.values()]
  })
  // GT3.16 (review #5): RECONCILE rather than rebuild — a row whose "voiceId:pointIndex" key is still
  // selected KEEPS its current (possibly mid-edit) values, so accumulating another point (or an external
  // model change) no longer discards uncommitted typing. Newly-selected keys are seeded from the model;
  // deselected keys drop out. A drag can't happen in table mode (starting a drag clears the
  // multi-selection), so nothing here needs to be "live" during a drag.
  function reconcileMultiForm(): void {
    const existing = new Map(multiForm.value.map((r) => [`${r.voiceId}:${r.pointIndex}`, r]))
    multiForm.value = gtracks.multiSelectionPoints.value.map(({ voiceId, pointIndex, point }) =>
      existing.get(`${voiceId}:${pointIndex}`) ?? modelRow(voiceId, pointIndex, point),
    )
  }
  watch(() => [gtracks.multiSelection.value, gtracks.voices.value] as const, () => {
    reconcileMultiForm()
  })
  function multiRowVoiceName(voiceId: number): string {
    const v = gtracks.getVoice(voiceId)
    if (v === undefined) return `#${voiceId}`
    return v.description.trim() !== '' ? v.description : `#${v.id}`
  }
  function rowPatch(row: MultiFormRow): { baseFreq: number; beatFreqHalf: number; volL: number; volR: number } {
    return {
      baseFreq: Math.max(0, Number(row.baseFreq) || 0),
      beatFreqHalf: Math.max(0, Number(row.beatFreq) || 0) / 2,
      volL: Math.max(0, Math.min(1, Number(row.volL) || 0)),
      volR: Math.max(0, Math.min(1, Number(row.volR) || 0)),
    }
  }
  function maybeAutosaveMultiRow(row: MultiFormRow): void {
    // A single row blur is naturally its own undo unit.
    if (gtracks.pointAutosave.value) {
      gtracks.setPointValues({ voiceId: row.voiceId, pointIndex: row.pointIndex }, rowPatch(row))
    }
  }

  // GT10.6/GT10.22 (owner req. 50/71): Ctrl OR Alt + Arrow steps a numeric field by 1.0 (plain arrows
  // keep the input's own fine step). Handled in the WINDOW keydown (handleTracksKeyDown, in the host) —
  // that is the only listener proven to reliably carry the modifier while an inspector field is focused.
  // The field is located from the focused element's data-step-field ancestor (data-step-row for the
  // table row); the value is clamped per field via ctrlStepValue.
  // GT10.22 (owner 2026-07-12): while Alt is held, a numeric field's native `step` becomes 1, so an
  // Alt+click on the browser spinner arrows (and Alt+ArrowKey) steps by ±1 instead of the fine step.
  const altBigStep = ref(false)
  function fieldStep(fine: string): string {
    return altBigStep.value ? '1' : fine
  }
  function applyFieldBigStep(el: HTMLElement, dir: 1 | -1): void {
    const field = el.getAttribute('data-step-field')
    if (field === null) return
    const rowKey = el.getAttribute('data-step-row')
    if (rowKey !== null) {
      const row = multiForm.value.find((r) => `${r.voiceId}:${r.pointIndex}` === rowKey)
      if (row === undefined) return
      const r = row as unknown as Record<string, number>
      r[field] = ctrlStepValue(Number(r[field]), field, dir)
      maybeAutosaveMultiRow(row)
      return
    }
    const form = pointForm as unknown as Record<string, number>
    form[field] = ctrlStepValue(Number(form[field]), field, dir)
    maybeAutosave()
  }

  // GT10.9 (owner req. 54): delete only the CHECKED table rows (one undo unit).
  function removeCheckedRows(): void {
    gtracks.removePointsBulk(
      multiForm.value.filter((r) => r.checked).map((r) => ({ voiceId: r.voiceId, pointIndex: r.pointIndex })),
    )
  }
  // GT3.16 (review #1): "Apply all" is ONE undo unit — was one per row, so undoing needed N presses.
  function applyAllMultiRows(): void {
    gtracks.setMultiplePointValues(
      multiForm.value.map((row) => ({ ref: { voiceId: row.voiceId, pointIndex: row.pointIndex }, patch: rowPatch(row) })),
    )
  }

  // PI3.2 (point-inspector-panel): value-taking commit methods invoked by applyPointInspectorAction —
  // the same authoritative applier used by the in-window adapter and the detached-window parent. The
  // view holds the input buffer now; these take explicit committed values (beat = full, GT-D6).
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
    pointForm,
    multiForm,
    collapsedGroups,
    altBigStep,
    // computed
    pointDialogVoiceName,
    pointDialogVoiceMono,
    pointDialogHasNext,
    pointFormVolume,
    pointFormBalance,
    inspectorMode,
    groupedMultiForm,
    // single-point ops
    syncPointFormFromModel,
    setTarget,
    closePointDialog,
    closeInspector,
    setPointFormVolume,
    setPointFormBalance,
    applyPointDialog,
    maybeAutosave,
    undoWithFocus,
    redoWithFocus,
    deleteCurrentPointFromDialog,
    addPointToRight,
    // table ops
    toggleGroup,
    reconcileMultiForm,
    maybeAutosaveMultiRow,
    removeCheckedRows,
    applyAllMultiRows,
    // shared keyboard big-step
    fieldStep,
    applyFieldBigStep,
    // PI3.2: value-taking commit methods for the remote-control applier
    commitForm,
    setAutosave,
    commitRow,
    commitAllRows,
    removeChecked,
  }
}

// Process-wide singleton (PI-D5), mirroring useSharedGtrackLanes: a detached effect scope keeps the
// inspector's watches alive for the app's lifetime and shared across every window/component that reads it.
let sharedPointInspector: ReturnType<typeof buildPointInspector> | null = null

export function usePointInspector(): ReturnType<typeof buildPointInspector> {
  if (sharedPointInspector === null) {
    const scope = effectScope(true)
    sharedPointInspector = scope.run(() => buildPointInspector()) ?? null
    if (sharedPointInspector === null) throw new Error('usePointInspector: initialisation failed')
  }
  return sharedPointInspector
}
