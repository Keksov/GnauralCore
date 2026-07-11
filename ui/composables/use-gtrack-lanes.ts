// GT2.2 — lane management for the gtrack editor. Builds a GTrackModel from the current .gnaural
// schedule and manages the set of editor lanes (each shows one or more voices under a display
// mode). Config (which voices, which mode, order, hidden) persists per file. Kept in a composable
// so AudioPage only renders + delegates.

import { computed, ref, shallowRef, watch, type Ref } from 'vue'

import type { GnauralScheduleData } from '@protocol'

import { audioApi } from '../audio-api'
import { GTrackModel, clampPointTime, type GTrackPoint, type GTrackSchedule, type GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, valuePatchForMode, type GTrackMode } from './gtrack-render'
import { findPreparseVoiceIds } from './gtrack-xml'
import { lintSchedule, type GTrackDiagnostic } from './gtrack-lint'

/** GT4.3/GT4.1 (GT-D17): per-lane solo audio of the lane's voice set — waveform, spectrum, both, or
 *  none. Rendered from a muted-others .gnaural render (also how audiofile/noise voices show audio). */
export type GTrackSoloMode = 'off' | 'wave' | 'spectrum' | 'both'
const SOLO_MODES: readonly GTrackSoloMode[] = ['off', 'wave', 'spectrum', 'both']

export interface GTrackLane {
  id: number
  voiceIds: number[]
  mode: GTrackMode
  hidden: boolean
  /** GT4.3: show the solo audio of this lane's voices ('off' when absent). */
  soloMode?: GTrackSoloMode
  /** GT4.2 (GT-D17): true = solo audio UNDER the curves (inline underlay); false = below as a sub-lane. */
  soloInline?: boolean
}

/** GT3.1: a vertex reference within a lane. */
export interface GTrackPointRef {
  readonly voiceId: number
  readonly pointIndex: number
}
/** GT3.1: the globally-selected vertex (which lane + which point). */
export interface GTrackSelection extends GTrackPointRef {
  readonly laneId: number
}
/** GT3.2: payload emitted by GTrackView while dragging a vertex. */
export interface GTrackDragMove {
  readonly point: GTrackPointRef
  readonly timeSec: number
  readonly value: number
}

/** GT3.10 (GT-D16): point-drag behaviour — clamp within neighbours, or cross over them. */
export type GTrackPointDragMode = 'clamp' | 'crossover'

/** GT3.6: payload emitted by GTrackView when double-clicking a curve to add a point. */
export interface GTrackAddPoint {
  readonly voiceId: number
  readonly timeSec: number
}

/**
 * GT3.14 (owner req. 24): the active point-mode cursor tool. 'select' is the normal
 * select+drag+dblclick-edit behaviour; 'add' inserts a point on every click on a curve; 'delete'
 * removes a point on every click on a vertex. One global tool, shared across all lanes.
 */
export type GTrackPointTool = 'select' | 'add' | 'delete'

export interface ResolvedGTrackLane {
  readonly id: number
  readonly mode: GTrackMode
  readonly voiceIds: readonly number[]
  readonly voices: readonly GTrackVoice[]
  readonly soloMode: GTrackSoloMode
  readonly soloInline: boolean
}

interface StoredLane {
  id: number
  voiceIds: number[]
  mode: string
  hidden: boolean
  soloMode?: string
  soloInline?: boolean
}

const STORAGE_KEY = 'mindwave-gtrack-lanes'
const STORAGE_HEIGHT_KEY = 'mindwave-gtrack-lane-height'
const LANE_HEIGHT_DEFAULT = 120
const LANE_HEIGHT_MIN = 60
const LANE_HEIGHT_MAX = 600

function isTonal(voice: GTrackVoice): boolean {
  return voice.points.some((p) => p.baseFreq > 0)
}

function loadAllStored(): Record<string, StoredLane[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, StoredLane[]>) : {}
  } catch {
    return {}
  }
}

function toMode(v: unknown): GTrackMode {
  return typeof v === 'string' && (GTRACK_MODES as readonly string[]).includes(v) ? (v as GTrackMode) : 'base'
}

export function useGtrackLanes(schedule: Ref<GnauralScheduleData | null>, filePath: Ref<string | null>) {
  const model = ref<GTrackModel | null>(null)
  const lanes = ref<GTrackLane[]>([])
  let nextLaneId = 1

  const laneHeight = ref<number>(loadHeight())
  function loadHeight(): number {
    try {
      const raw = localStorage.getItem(STORAGE_HEIGHT_KEY)
      const n = raw === null ? NaN : Number(raw)
      return Number.isFinite(n) ? clampHeight(n) : LANE_HEIGHT_DEFAULT
    } catch {
      return LANE_HEIGHT_DEFAULT
    }
  }
  function clampHeight(n: number): number {
    return Math.max(LANE_HEIGHT_MIN, Math.min(LANE_HEIGHT_MAX, Math.round(n)))
  }
  function setLaneHeight(n: number): void {
    laneHeight.value = clampHeight(n)
    try { localStorage.setItem(STORAGE_HEIGHT_KEY, String(laneHeight.value)) } catch { /* ignore */ }
  }

  // GT3.2: the GTrackModel is a plain class — its internal edits are NOT Vue-reactive. This
  // shallowRef mirrors the model's schedule (a fresh reference is produced on every edit, so
  // assigning it re-triggers voices/visibleLanes). Call syncSchedule() after any model mutation.
  const scheduleRef = shallowRef<GTrackSchedule | null>(model.value?.schedule ?? null)
  function syncSchedule(): void {
    scheduleRef.value = model.value !== null ? model.value.schedule : null
  }
  const voices = computed<readonly GTrackVoice[]>(() => scheduleRef.value?.voices ?? [])
  const durationSec = computed(() => schedule.value?.totalTimeSec ?? 0)
  // GT9.1/GT9.2 (owner req. 42): live schedule lint — re-runs on every edit (scheduleRef changes).
  const diagnostics = computed<GTrackDiagnostic[]>(() =>
    scheduleRef.value === null ? [] : lintSchedule(scheduleRef.value),
  )

  // GT3.1/3.2: point-edit mode + selection (ephemeral). Declared before the immediate schedule
  // watch (which clears the selection) to avoid a temporal-dead-zone reference.
  const pointModeLanes = ref<Set<number>>(new Set())
  const selection = ref<GTrackSelection | null>(null)

  function voiceById(id: number): GTrackVoice | undefined {
    return voices.value.find((v) => v.id === id)
  }

  const visibleLanes = computed<ResolvedGTrackLane[]>(() =>
    lanes.value
      .filter((lane) => !lane.hidden)
      .map((lane) => resolveLane(lane)),
  )
  const hiddenLanes = computed<ResolvedGTrackLane[]>(() =>
    lanes.value.filter((lane) => lane.hidden).map((lane) => resolveLane(lane)),
  )
  function resolveLane(lane: GTrackLane): ResolvedGTrackLane {
    return {
      id: lane.id,
      mode: lane.mode,
      voiceIds: lane.voiceIds,
      voices: lane.voiceIds.map(voiceById).filter((v): v is GTrackVoice => v !== undefined),
      soloMode: lane.soloMode ?? 'off',
      soloInline: lane.soloInline ?? false,
    }
  }

  // --- persistence ---
  function persist(): void {
    const key = filePath.value
    if (key === null) return
    try {
      const all = loadAllStored()
      all[key] = lanes.value.map((l) => ({ id: l.id, voiceIds: l.voiceIds.slice(), mode: l.mode, hidden: l.hidden, soloMode: l.soloMode ?? 'off', soloInline: l.soloInline ?? false }))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // ignore
    }
  }

  // GT-D13 (owner 2026-07-09): default = ONE VOICE -> ONE LANE (like the classic schedule editor's
  // per-voice tracks). A tonal voice starts on Base freq; noise/audiofile on Volume (no base
  // frequency, but a meaningful volume envelope). Users can then merge voices into one lane or
  // spread one voice across several lanes (different parameters) via the lane gear / + lane.
  function defaultLaneConfig(): { voiceIds: number[]; mode: GTrackMode } {
    const all = voices.value
    const tonalIds = all.filter(isTonal).map((v) => v.id)
    if (tonalIds.length > 0) return { voiceIds: tonalIds, mode: 'base' }
    return { voiceIds: all.map((v) => v.id), mode: 'volume' }
  }

  function laneForVoice(v: GTrackVoice): GTrackLane {
    return { id: nextLaneId++, voiceIds: [v.id], mode: (isTonal(v) ? 'base' : 'volume') as GTrackMode, hidden: false }
  }

  // GT-D13 refined (2026-07-11): the DEFAULT layout gives each TONAL voice its own Base-freq lane.
  // Audiofile/noise voices are NOT auto-laned — their only curve is a volume envelope, and a real
  // preset (ForestMeditation: 30 nature clips + 1 binaural) would otherwise open as a 31-lane wall.
  // Those voices stay one toggle away in the voices panel, and Phase 4 gives them real audio
  // (wave/spectrum) lanes. A schedule with NO tonal voices (e.g. an all-noise file) falls back to a
  // single Volume lane with every voice so the stack isn't empty.
  function defaultLanes(): GTrackLane[] {
    const tonal = voices.value.filter(isTonal)
    if (tonal.length > 0) return tonal.map(laneForVoice)
    const cfg = defaultLaneConfig()
    return [{ id: nextLaneId++, voiceIds: cfg.voiceIds, mode: cfg.mode, hidden: false }]
  }

  function restoreOrDefault(): void {
    const key = filePath.value
    const validIds = new Set(voices.value.map((v) => v.id))
    let restored: GTrackLane[] | null = null
    if (key !== null) {
      const stored = loadAllStored()[key]
      if (Array.isArray(stored) && stored.length > 0) {
        restored = stored.map((s) => ({
          id: s.id,
          voiceIds: (Array.isArray(s.voiceIds) ? s.voiceIds : []).filter((id) => validIds.has(id)),
          mode: toMode(s.mode),
          hidden: s.hidden === true,
          soloMode: (SOLO_MODES.includes(s.soloMode as GTrackSoloMode) ? s.soloMode : 'off') as GTrackSoloMode,
          soloInline: s.soloInline === true,
        }))
        nextLaneId = Math.max(nextLaneId, ...restored.map((l) => l.id + 1))
      }
    }
    lanes.value = restored !== null ? restored : defaultLanes()
  }

  // Edit state (dirty / undo / redo). Declared BEFORE the immediate schedule watch so that watch can
  // refresh it when the model is rebuilt (on file switch AND after a Save reload) — otherwise the
  // flags would keep the previous file's/edit's values.
  const dirty = ref(false)
  const canUndo = ref(false)
  const canRedo = ref(false)
  function refreshEditState(): void {
    const m = model.value
    dirty.value = m?.isDirty ?? false
    canUndo.value = m?.canUndo ?? false
    canRedo.value = m?.canRedo ?? false
  }

  // GT3.7 (GT-D9): ids of generator ("preparse") voices, recovered from the SOURCE XML (the dump
  // does not flag provenance). Fed into the model so those voices are edit-locked and rendered
  // distinctly, until the user explicitly fixes them.
  const preparseVoiceIds = ref<number[]>([])

  function buildModel(data: GnauralScheduleData | null): void {
    model.value = data === null ? null : new GTrackModel(data, preparseVoiceIds.value)
    selection.value = null
    syncSchedule()
    refreshEditState() // reset dirty/undo/redo to the freshly-loaded (saved) baseline
    if (model.value === null) {
      lanes.value = []
      return
    }
    restoreOrDefault()
  }

  // Rebuild the model + lane config whenever the schedule (file) changes.
  watch(schedule, (data) => buildModel(data), { immediate: true })

  // GT3.7: fetch the raw .gnaural when the file changes, mark its generator voices, and rebuild the
  // model so they lock. Guarded by a request id (fast file switches) and skipped for non-gnaural
  // paths (the editor endpoint only serves .gnaural).
  let preparseReqId = 0
  watch(
    filePath,
    (path) => {
      preparseVoiceIds.value = []
      if (path === null || !path.toLowerCase().endsWith('.gnaural')) return
      const reqId = ++preparseReqId
      void audioApi
        .fetchEditorDocument(path)
        .then((doc) => {
          if (reqId !== preparseReqId) return // superseded by a newer file selection
          preparseVoiceIds.value = [...findPreparseVoiceIds(doc.content)]
          // Rebuild only when the ids arrived AFTER the schedule and no edit is in progress.
          if (schedule.value !== null && !dirty.value) buildModel(schedule.value)
        })
        .catch(() => {
          /* fetch failed (e.g. non-gnaural) -> treat as no generator voices */
        })
    },
    { immediate: true },
  )

  // --- operations ---
  function addLane(): void {
    const cfg = defaultLaneConfig()
    lanes.value = [
      ...lanes.value,
      { id: nextLaneId++, voiceIds: cfg.voiceIds, mode: cfg.mode, hidden: false },
    ]
    persist()
  }
  function removeLane(id: number): void {
    lanes.value = lanes.value.filter((l) => l.id !== id)
    persist()
  }
  function setLaneMode(id: number, mode: GTrackMode): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, mode } : l))
    persist()
  }
  // GT4.3 (GT-D17): the lane's solo audio (off / wave / spectrum / both of its voice set).
  function setLaneSolo(id: number, soloMode: GTrackSoloMode): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloMode } : l))
    persist()
  }
  // GT4.2 (GT-D17): where the solo audio shows — inline under the curves vs a sub-lane below.
  function setLaneSoloInline(id: number, soloInline: boolean): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloInline } : l))
    persist()
  }
  function toggleLaneVoice(id: number, voiceId: number): void {
    lanes.value = lanes.value.map((l) => {
      if (l.id !== id) return l
      const has = l.voiceIds.includes(voiceId)
      return { ...l, voiceIds: has ? l.voiceIds.filter((v) => v !== voiceId) : [...l.voiceIds, voiceId] }
    })
    persist()
  }
  function setLaneHidden(id: number, hidden: boolean): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, hidden } : l))
    persist()
  }
  /** Reorder: move lane `dragId` to the position of `targetId` (swap-through as the pointer moves). */
  function swapLanes(dragId: number, targetId: number): void {
    const arr = lanes.value.slice()
    const i = arr.findIndex((l) => l.id === dragId)
    const j = arr.findIndex((l) => l.id === targetId)
    if (i < 0 || j < 0 || i === j) return
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
    lanes.value = arr
    persist()
  }

  // --- GT3.1: point-edit mode + vertex selection (ephemeral; not persisted) ---
  function isLanePointMode(id: number): boolean {
    return pointModeLanes.value.has(id)
  }
  function toggleLanePointMode(id: number): void {
    const s = new Set(pointModeLanes.value)
    if (s.has(id)) {
      s.delete(id)
      if (selection.value?.laneId === id) selection.value = null // drop the selection when leaving
    } else {
      s.add(id)
    }
    pointModeLanes.value = s
  }
  /** The selected vertex within a given lane, or null (for passing to that lane's GTrackView). */
  function selectionForLane(id: number): GTrackPointRef | null {
    const sel = selection.value
    return sel !== null && sel.laneId === id ? { voiceId: sel.voiceId, pointIndex: sel.pointIndex } : null
  }
  function selectPoint(laneId: number, point: GTrackPointRef | null): void {
    selection.value = point === null ? null : { laneId, voiceId: point.voiceId, pointIndex: point.pointIndex }
  }
  function clearSelection(): void {
    selection.value = null
  }

  // --- GT3.15 (owner req. 30): Ctrl/Shift-accumulated multi-selection (ephemeral, not persisted).
  // Keyed "voiceId:pointIndex" so it can span multiple voices/lanes. Scope decision: multi-select
  // drives the inspector's TABLE mode (view/edit VALUE fields + bulk delete); it does not support
  // group-dragging (each drag still moves exactly the one vertex under the pointer) and the table
  // does not edit time (time edits use crossover reindexing, which would desync these keys — the
  // single-point inspector still edits time for one point at a time).
  const multiSelection = ref<Set<string>>(new Set())
  function multiSelectionKey(voiceId: number, pointIndex: number): string {
    return `${voiceId}:${pointIndex}`
  }
  function isMultiSelected(voiceId: number, pointIndex: number): boolean {
    return multiSelection.value.has(multiSelectionKey(voiceId, pointIndex))
  }
  function toggleMultiSelect(voiceId: number, pointIndex: number): void {
    const key = multiSelectionKey(voiceId, pointIndex)
    const next = new Set(multiSelection.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    multiSelection.value = next
  }
  function clearMultiSelection(): void {
    multiSelection.value = new Set()
  }
  /** The multi-selection resolved to live point data (drops entries whose point no longer exists). */
  const multiSelectionPoints = computed(() => {
    const out: Array<{ voiceId: number; pointIndex: number; point: GTrackPoint }> = []
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const voiceId = Number(voiceIdStr)
      const pointIndex = Number(pointIndexStr)
      const p = voiceById(voiceId)?.points[pointIndex]
      if (p !== undefined) out.push({ voiceId, pointIndex, point: p })
    }
    return out
  })
  /**
   * GT3.15: set only the VALUE fields of a point (base/beat/volL/volR) — never time — so a table
   * row edit can never trigger crossover reindexing (which would desync the multi-selection's
   * "voiceId:pointIndex" keys against the other selected rows).
   */
  function setPointValues(
    ref_: GTrackPointRef,
    patch: { baseFreq: number; beatFreqHalf: number; volL: number; volR: number },
  ): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => m.setPointFields(ref_.voiceId, ref_.pointIndex, patch))
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /**
   * GT3.16: apply value-field edits to SEVERAL points as ONE undo unit (table "Apply all").
   * Value-only (never time), so — like setPointValues — indices stay stable and the
   * multi-selection keys don't desync. Non-editable voices are skipped silently.
   */
  function setMultiplePointValues(
    edits: ReadonlyArray<{ ref: GTrackPointRef; patch: { baseFreq: number; beatFreqHalf: number; volL: number; volR: number } }>,
  ): boolean {
    const m = model.value
    if (m === null || edits.length === 0) return false
    try {
      m.edit(() => {
        for (const { ref: ref_, patch } of edits) {
          if (!m.isVoiceEditable(ref_.voiceId)) continue
          m.setPointFields(ref_.voiceId, ref_.pointIndex, patch)
        }
      })
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT3.15: bulk-delete every point in the multi-selection as ONE undo unit. */
  function removeMultiSelection(): void {
    const m = model.value
    if (m === null || multiSelection.value.size === 0) return
    const byVoice = new Map<number, number[]>()
    for (const { voiceId, pointIndex } of multiSelectionPoints.value) {
      const arr = byVoice.get(voiceId) ?? []
      arr.push(pointIndex)
      byVoice.set(voiceId, arr)
    }
    m.edit(() => {
      for (const [voiceId, indices] of byVoice) {
        if (!m.isVoiceEditable(voiceId)) continue
        for (const idx of [...indices].sort((a, b) => b - a)) { // highest index first (no reshift)
          const voice = m.schedule.voices.find((v) => v.id === voiceId)
          if (voice === undefined || voice.points.length <= 2) break // model's min-2-points floor
          try { m.removePoint(voiceId, idx) } catch { /* already gone / race — skip */ }
        }
      }
    })
    clearMultiSelection()
    syncSchedule()
    refreshEditState()
  }
  /**
   * GT3.15: keep the multi-selection's "voiceId:pointIndex" keys valid across array-shifting edits
   * elsewhere in the SAME voice — a single-point remove/insert shifts every later index by one.
   * (removeMultiSelection's own bulk removals don't need this: they clear the whole set after.)
   */
  function reindexMultiSelectionAfterRemoval(voiceId: number, removedIndex: number): void {
    if (multiSelection.value.size === 0) return
    const next = new Set<string>()
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const vId = Number(voiceIdStr)
      const pIdx = Number(pointIndexStr)
      if (vId !== voiceId || pIdx < removedIndex) { next.add(key); continue }
      if (pIdx === removedIndex) continue // that vertex is gone — drop it
      next.add(multiSelectionKey(vId, pIdx - 1))
    }
    multiSelection.value = next
  }
  function reindexMultiSelectionAfterInsert(voiceId: number, insertedIndex: number): void {
    if (multiSelection.value.size === 0) return
    const next = new Set<string>()
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const vId = Number(voiceIdStr)
      const pIdx = Number(pointIndexStr)
      next.add(vId === voiceId && pIdx >= insertedIndex ? multiSelectionKey(vId, pIdx + 1) : key)
    }
    multiSelection.value = next
  }
  /**
   * GT3.15: a crossover re-sort (drag or the single-point dialog's time field) can move an
   * ARBITRARY range of points in the same voice — the model only reports the one explicitly-moved
   * point's new index, not how everything else shifted. Rather than risk a table row silently
   * pointing at the wrong vertex, drop that voice's multi-selection entries defensively.
   */
  function dropMultiSelectionForVoice(voiceId: number): void {
    if (multiSelection.value.size === 0) return
    const prefix = `${voiceId}:`
    if (![...multiSelection.value].some((k) => k.startsWith(prefix))) return
    const next = new Set([...multiSelection.value].filter((k) => !k.startsWith(prefix)))
    multiSelection.value = next
  }

  // --- GT3.9 (GT-D15): voice-panel operations. The slide-over panel drives voices; these map its
  // per-voice controls onto the lane model (visibility = hidden of all lanes containing the voice;
  // graph type = mode of all lanes containing the voice; no lane -> one is created).
  function lanesForVoice(voiceId: number): GTrackLane[] {
    return lanes.value.filter((l) => l.voiceIds.includes(voiceId))
  }
  function isVoiceVisible(voiceId: number): boolean {
    return lanesForVoice(voiceId).some((l) => !l.hidden)
  }
  /** The graph type shown for a voice (its first lane's mode), or null when it has no lane. */
  function voiceMode(voiceId: number): GTrackMode | null {
    return lanesForVoice(voiceId)[0]?.mode ?? null
  }
  function defaultModeForVoice(voiceId: number): GTrackMode {
    const v = voiceById(voiceId)
    return v !== undefined && isTonal(v) ? 'base' : 'volume'
  }
  function setVoiceVisible(voiceId: number, visible: boolean): void {
    const owned = lanesForVoice(voiceId)
    if (owned.length === 0) {
      if (visible) {
        lanes.value = [...lanes.value, { id: nextLaneId++, voiceIds: [voiceId], mode: defaultModeForVoice(voiceId), hidden: false }]
      }
    } else {
      lanes.value = lanes.value.map((l) => (l.voiceIds.includes(voiceId) ? { ...l, hidden: !visible } : l))
    }
    persist()
  }
  function setVoiceMode(voiceId: number, mode: GTrackMode): void {
    const owned = lanesForVoice(voiceId)
    if (owned.length === 0) {
      lanes.value = [...lanes.value, { id: nextLaneId++, voiceIds: [voiceId], mode, hidden: false }]
    } else {
      lanes.value = lanes.value.map((l) => (l.voiceIds.includes(voiceId) ? { ...l, mode } : l))
    }
    persist()
  }
  // Bulk actions (owner req. 20).
  /** All voices merged into ONE lane (mode = the first visible lane's, else the default). */
  function mergeAllIntoOneLane(): void {
    const mode = lanes.value.find((l) => !l.hidden)?.mode ?? defaultLaneConfig().mode
    lanes.value = [{ id: nextLaneId++, voiceIds: voices.value.map((v) => v.id), mode, hidden: false }]
    persist()
  }
  /** One lane per voice — EVERY voice (the explicit "spread everything", incl. audiofile/noise). */
  function spreadPerVoiceLanes(): void {
    lanes.value = voices.value.map(laneForVoice)
    persist()
  }
  /**
   * GT3.18 (owner req. 38): show EVERY graph type for EVERY voice — one lane per (voice × mode).
   * Lanes are grouped by voice (all of a voice's modes are contiguous) so the per-voice accent
   * stripe/title (GT-D20) reads as a block.
   */
  function showAllModesPerVoice(): void {
    const next: GTrackLane[] = []
    for (const v of voices.value) {
      for (const mode of GTRACK_MODES) {
        next.push({ id: nextLaneId++, voiceIds: [v.id], mode, hidden: false })
      }
    }
    lanes.value = next
    persist()
  }
  /** Show every voice in the given graph type (applies to all lanes). */
  function setAllLanesMode(mode: GTrackMode): void {
    lanes.value = lanes.value.map((l) => ({ ...l, mode }))
    persist()
  }
  function setAllLanesHidden(hidden: boolean): void {
    lanes.value = lanes.value.map((l) => ({ ...l, hidden }))
    persist()
  }
  const allLanesHidden = computed(() => lanes.value.length > 0 && lanes.value.every((l) => l.hidden))

  // --- GT3.2: vertex drag (one undo unit per drag) + undo/redo ---
  // (dirty / canUndo / canRedo / refreshEditState are declared above the schedule watch.)

  /** Begin a drag transaction for a vertex (no-op if the voice is not editable, e.g. preparse). */
  function beginPointDrag(ref_: GTrackPointRef): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    m.beginEdit()
    return true
  }
  // GT3.10 (GT-D16): point-drag mode is a persisted EDITOR SETTING (owner req. 18): 'clamp' keeps
  // the point between its neighbours; 'crossover' lets it pass them (stable re-sort, drag follows
  // the point under its new index). Default = crossover (the owner's requested behaviour).
  const STORAGE_DRAG_MODE_KEY = 'mindwave-gtrack-point-drag-mode'
  function loadDragMode(): GTrackPointDragMode {
    try {
      return localStorage.getItem(STORAGE_DRAG_MODE_KEY) === 'clamp' ? 'clamp' : 'crossover'
    } catch {
      return 'crossover'
    }
  }
  const pointDragMode = ref<GTrackPointDragMode>(loadDragMode())
  function setPointDragMode(mode: GTrackPointDragMode): void {
    pointDragMode.value = mode
    try { localStorage.setItem(STORAGE_DRAG_MODE_KEY, mode) } catch { /* ignore */ }
  }

  // GT3.12 (GT-D18, owner req. 28): "Autosave" — when on, the point inspector applies every field
  // edit immediately instead of waiting for an explicit Apply. Persisted editor property.
  const STORAGE_POINT_AUTOSAVE_KEY = 'mindwave-gtrack-point-autosave'
  function loadPointAutosave(): boolean {
    try { return localStorage.getItem(STORAGE_POINT_AUTOSAVE_KEY) === '1' } catch { return false }
  }
  const pointAutosave = ref<boolean>(loadPointAutosave())
  function setPointAutosave(v: boolean): void {
    pointAutosave.value = v
    try { localStorage.setItem(STORAGE_POINT_AUTOSAVE_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }

  // GT3.14 (owner req. 24): the active point-mode cursor tool (Select/Add/Delete). One global
  // tool applies across every lane; persisted editor property, same pattern as pointDragMode.
  const STORAGE_POINT_TOOL_KEY = 'mindwave-gtrack-point-tool'
  function loadPointTool(): GTrackPointTool {
    try {
      const v = localStorage.getItem(STORAGE_POINT_TOOL_KEY)
      return v === 'add' || v === 'delete' ? v : 'select'
    } catch {
      return 'select'
    }
  }
  const pointTool = ref<GTrackPointTool>(loadPointTool())
  function setPointTool(toolValue: GTrackPointTool): void {
    pointTool.value = toolValue
    try { localStorage.setItem(STORAGE_POINT_TOOL_KEY, toolValue) } catch { /* ignore */ }
  }
  /**
   * GT3.14: delete a point by direct reference (Delete-tool single click). Does NOT touch the
   * global selection unless it already pointed at this exact vertex — so using the Delete tool
   * doesn't hijack an unrelated point that's currently selected/inspected elsewhere.
   */
  function deletePointAt(laneId: number, ref_: GTrackPointRef): boolean {
    void laneId // kept for API symmetry with GTrackSelection; not needed to locate the point
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => m.removePoint(ref_.voiceId, ref_.pointIndex))
    } catch {
      return false
    }
    const sel = selection.value
    if (sel !== null && sel.voiceId === ref_.voiceId && sel.pointIndex === ref_.pointIndex) {
      selection.value = null
    }
    reindexMultiSelectionAfterRemoval(ref_.voiceId, ref_.pointIndex)
    syncSchedule()
    refreshEditState()
    return true
  }

  /** Live-move the dragged vertex: time per the drag mode (clamp/crossover), value per the lane mode. */
  function dragPoint(ref_: GTrackPointRef, timeSec: number, modeValue: number, mode: GTrackMode): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    const voice = m.schedule.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (voice === undefined || p === undefined) return
    const patch = valuePatchForMode(p, mode, modeValue, voice.mono)
    if (pointDragMode.value === 'crossover') {
      // Cross neighbours: the model re-sorts and hands back the point's new index; keep the
      // selection on the same (moved) point so the lane's drag follows it.
      const newIndex = m.movePointCrossing(ref_.voiceId, ref_.pointIndex, timeSec)
      if (Object.keys(patch).length > 0) m.setPointFields(ref_.voiceId, newIndex, patch)
      const sel = selection.value
      if (sel !== null && sel.voiceId === ref_.voiceId) {
        selection.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: newIndex }
      }
      dropMultiSelectionForVoice(ref_.voiceId) // GT3.15: an arbitrary re-sort can't be reindexed
    } else {
      const clampedTime = clampPointTime(voice.points, ref_.pointIndex, timeSec)
      m.setPointFields(ref_.voiceId, ref_.pointIndex, { timeSec: clampedTime, ...patch })
    }
    syncSchedule()
  }
  function endPointDrag(): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    m.commitEdit()
    syncSchedule()
    refreshEditState()
  }
  function cancelPointDrag(): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    m.cancelEdit()
    syncSchedule()
  }
  // --- GT3.3/GT3.6: point dialog + add/remove operations ---
  function getVoice(voiceId: number): GTrackVoice | undefined {
    return voiceById(voiceId)
  }
  function getPoint(ref_: GTrackPointRef): GTrackPoint | null {
    return voiceById(ref_.voiceId)?.points[ref_.pointIndex] ?? null
  }
  // --- GT3.7 (GT-D9, owner req. 10-11): preparse (generator) voices ---
  function isVoicePreparse(voiceId: number): boolean {
    return voiceById(voiceId)?.preparse ?? false
  }
  /**
   * Owner req. 11: "fix / make editable" — bake the generator's expanded points into concrete,
   * editable points (clears the preparse flag) as one undo unit. Irreversible in the file (the
   * generator node is lost on Save), so the caller must warn the user first (GT-D9 / R6).
   */
  function fixPreparseVoice(voiceId: number): boolean {
    const m = model.value
    if (m === null) return false
    try {
      m.fixPreparseVoice(voiceId)
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /**
   * Apply the point dialog: set every field in ONE undo unit. Time uses crossover semantics
   * (an exact time may legitimately pass neighbours); the selection follows the new index.
   */
  function applyPointEdit(
    ref_: GTrackPointRef,
    patch: { timeSec: number; baseFreq: number; beatFreqHalf: number; volL: number; volR: number },
  ): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => {
        const ni = m.movePointCrossing(ref_.voiceId, ref_.pointIndex, patch.timeSec)
        m.setPointFields(ref_.voiceId, ni, {
          baseFreq: patch.baseFreq,
          beatFreqHalf: patch.beatFreqHalf,
          volL: patch.volL,
          volR: patch.volR,
        })
        const sel = selection.value
        if (sel !== null && sel.voiceId === ref_.voiceId) {
          selection.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: ni }
        }
        dropMultiSelectionForVoice(ref_.voiceId) // GT3.15: crossover re-sort — can't be reindexed
      })
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT3.6: insert an interpolated point at timeSec and select it. False when not possible. */
  function insertPointAt(laneId: number, voiceId: number, timeSec: number): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(voiceId)) return false
    try {
      let idx = -1
      m.edit(() => { idx = m.insertPoint(voiceId, timeSec) })
      selection.value = { laneId, voiceId, pointIndex: idx }
      reindexMultiSelectionAfterInsert(voiceId, idx)
    } catch {
      return false // outside segments / preparse-locked / degenerate voice
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT3.6: remove the currently selected point (Delete key). False when blocked (min 2 points). */
  function removeSelectedPoint(): boolean {
    const sel = selection.value
    const m = model.value
    if (sel === null || m === null || !m.isVoiceEditable(sel.voiceId)) return false
    try {
      m.edit(() => m.removePoint(sel.voiceId, sel.pointIndex))
    } catch {
      return false
    }
    reindexMultiSelectionAfterRemoval(sel.voiceId, sel.pointIndex)
    selection.value = null
    syncSchedule()
    refreshEditState()
    return true
  }

  // --- GT9.3 (owner req. 42, GT-D21): confirmed auto-fixes for lint diagnostics (undoable) ---
  const END_FADE_SEC = 0.1
  /**
   * Fix an 'end-click': append a short fade to zero at the very end. Insert a point 0.1s before the
   * end (interpolated ~= the end level) then drive the final point to silence — one undo unit,
   * total duration preserved. Returns false when the last segment is too short for a clean fade.
   */
  function fixEndClick(voiceId: number): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(voiceId)) return false
    const voice = voiceById(voiceId)
    if (voice === undefined || voice.points.length < 2) return false
    const pts = voice.points
    const lastIdx = pts.length - 1
    const endTime = pts[lastIdx]!.timeSec
    const lastSegDur = endTime - pts[lastIdx - 1]!.timeSec
    if (!(lastSegDur > END_FADE_SEC + 0.01)) return false // degenerate/short tail — manual fix
    try {
      m.edit(() => {
        m.insertPoint(voiceId, endTime - END_FADE_SEC)
        const v = m.schedule.voices.find((x) => x.id === voiceId)
        if (v === undefined) throw new Error('gtrack: voice vanished during fix')
        m.setPointFields(voiceId, v.points.length - 1, { volL: 0, volR: 0 })
      })
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /**
   * Fix a 'loop-click': set the last point's volume to the first point's, so the loop seam
   * (end -> start) has no volume discontinuity. One undo unit.
   */
  function fixLoopClick(voiceId: number): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(voiceId)) return false
    const voice = voiceById(voiceId)
    if (voice === undefined || voice.points.length < 2) return false
    const first = voice.points[0]!
    const lastIdx = voice.points.length - 1
    try {
      m.edit(() => m.setPointFields(voiceId, lastIdx, { volL: first.volL, volR: first.volR }))
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }

  function undoEdit(): void {
    const m = model.value
    if (m === null || m.inTransaction) return // never undo mid-drag (the model would throw)
    if (m.undo()) {
      syncSchedule()
      refreshEditState()
    }
  }
  function redoEdit(): void {
    const m = model.value
    if (m === null || m.inTransaction) return
    if (m.redo()) {
      syncSchedule()
      refreshEditState()
    }
  }

  return {
    isLanePointMode,
    toggleLanePointMode,
    selection,
    selectionForLane,
    selectPoint,
    clearSelection,
    beginPointDrag,
    dragPoint,
    endPointDrag,
    cancelPointDrag,
    undoEdit,
    redoEdit,
    dirty,
    canUndo,
    canRedo,
    pointDragMode,
    setPointDragMode,
    pointAutosave,
    setPointAutosave,
    pointTool,
    setPointTool,
    deletePointAt,
    multiSelection,
    isMultiSelected,
    toggleMultiSelect,
    clearMultiSelection,
    multiSelectionPoints,
    setPointValues,
    setMultiplePointValues,
    removeMultiSelection,
    getVoice,
    getPoint,
    preparseVoiceIds,
    isVoicePreparse,
    fixPreparseVoice,
    fixEndClick,
    fixLoopClick,
    applyPointEdit,
    insertPointAt,
    removeSelectedPoint,
    isVoiceVisible,
    voiceMode,
    setVoiceVisible,
    setVoiceMode,
    mergeAllIntoOneLane,
    spreadPerVoiceLanes,
    showAllModesPerVoice,
    setAllLanesMode,
    setAllLanesHidden,
    allLanesHidden,
    model,
    lanes,
    voices,
    durationSec,
    diagnostics,
    laneHeight,
    setLaneHeight,
    visibleLanes,
    hiddenLanes,
    addLane,
    removeLane,
    setLaneMode,
    setLaneSolo,
    setLaneSoloInline,
    toggleLaneVoice,
    setLaneHidden,
    swapLanes,
    isTonal,
  }
}
