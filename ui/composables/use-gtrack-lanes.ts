// GT2.2 — lane management for the gtrack editor. Builds a GTrackModel from the current .gnaural
// schedule and manages the set of editor lanes (each shows one or more voices under a display
// mode). Config (which voices, which mode, order, hidden) persists per file. Kept in a composable
// so AudioPage only renders + delegates.

import { computed, ref, watch, type Ref } from 'vue'

import type { GnauralScheduleData } from '@protocol'

import { GTrackModel, type GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, type GTrackMode } from './gtrack-render'

export interface GTrackLane {
  id: number
  voiceIds: number[]
  mode: GTrackMode
  hidden: boolean
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

  const voices = computed<readonly GTrackVoice[]>(() => model.value?.schedule.voices ?? [])
  const durationSec = computed(() => schedule.value?.totalTimeSec ?? 0)

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

  function defaultLanes(): GTrackLane[] {
    const all = voices.value
    const tonalIds = all.filter(isTonal).map((v) => v.id)
    const ids = tonalIds.length > 0 ? tonalIds : all.map((v) => v.id)
    return [{ id: nextLaneId++, voiceIds: ids, mode: 'base', hidden: false }]
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
    const all = voices.value
    const tonalIds = all.filter(isTonal).map((v) => v.id)
    lanes.value = [
      ...lanes.value,
      { id: nextLaneId++, voiceIds: tonalIds.length > 0 ? tonalIds : all.map((v) => v.id), mode: 'base', hidden: false },
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

  return {
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
