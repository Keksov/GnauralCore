// GT2.2 — lane management for the gtrack editor. Builds a GTrackModel from the current .gnaural
// schedule and manages the set of editor lanes (each shows one or more voices under a display
// mode). Config (which voices, which mode, order, hidden) persists per file. Kept in a composable
// so AudioPage only renders + delegates.

import { computed, ref, shallowRef, watch, type Ref } from 'vue'

import type { GnauralScheduleData } from '@protocol'

import { GTrackModel, clampPointTime, type GTrackSchedule, type GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, valuePatchForMode, type GTrackMode } from './gtrack-render'

export interface GTrackLane {
  id: number
  voiceIds: number[]
  mode: GTrackMode
  hidden: boolean
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

export interface ResolvedGTrackLane {
  readonly id: number
  readonly mode: GTrackMode
  readonly voiceIds: readonly number[]
  readonly voices: readonly GTrackVoice[]
}

interface StoredLane {
  id: number
  voiceIds: number[]
  mode: string
  hidden: boolean
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
    }
  }

  // --- persistence ---
  function persist(): void {
    const key = filePath.value
    if (key === null) return
    try {
      const all = loadAllStored()
      all[key] = lanes.value.map((l) => ({ id: l.id, voiceIds: l.voiceIds.slice(), mode: l.mode, hidden: l.hidden }))
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

  function defaultLanes(): GTrackLane[] {
    return voices.value.map((v) => ({
      id: nextLaneId++,
      voiceIds: [v.id],
      mode: (isTonal(v) ? 'base' : 'volume') as GTrackMode,
      hidden: false,
    }))
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
        }))
        nextLaneId = Math.max(nextLaneId, ...restored.map((l) => l.id + 1))
      }
    }
    lanes.value = restored !== null ? restored : defaultLanes()
  }

  // Rebuild the model + lane config whenever the schedule (file) changes.
  watch(
    schedule,
    (data) => {
      model.value = data === null ? null : new GTrackModel(data)
      selection.value = null
      syncSchedule()
      if (model.value === null) {
        lanes.value = []
        return
      }
      restoreOrDefault()
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

  // --- GT3.2: vertex drag (one undo unit per drag) + undo/redo ---
  const dirty = ref(false)
  const canUndo = ref(false)
  const canRedo = ref(false)
  function refreshEditState(): void {
    const m = model.value
    dirty.value = m?.isDirty ?? false
    canUndo.value = m?.canUndo ?? false
    canRedo.value = m?.canRedo ?? false
  }

  /** Begin a drag transaction for a vertex (no-op if the voice is not editable, e.g. preparse). */
  function beginPointDrag(ref_: GTrackPointRef): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    m.beginEdit()
    return true
  }
  /** Live-move the dragged vertex: clamp time between neighbours, map the mode-value to fields. */
  function dragPoint(ref_: GTrackPointRef, timeSec: number, modeValue: number, mode: GTrackMode): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    const voice = m.schedule.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (voice === undefined || p === undefined) return
    const clampedTime = clampPointTime(voice.points, ref_.pointIndex, timeSec)
    const patch = valuePatchForMode(p, mode, modeValue, voice.mono)
    m.setPointFields(ref_.voiceId, ref_.pointIndex, { timeSec: clampedTime, ...patch })
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
    model,
    lanes,
    voices,
    durationSec,
    laneHeight,
    setLaneHeight,
    visibleLanes,
    hiddenLanes,
    addLane,
    removeLane,
    setLaneMode,
    toggleLaneVoice,
    setLaneHidden,
    swapLanes,
    isTonal,
  }
}
