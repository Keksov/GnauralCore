// GT1.1 — editable in-memory model for the new gnaural-track (gtrack) editor.
//
// The server dumps each voice as a list of SEGMENTS (GnauralScheduleEntry: start+end values over
// a duration). The editor works with VERTICES/POINTS instead: a point P_k is a moment in time with
// a set of parameter values, and the segment between P_k and P_{k+1} interpolates linearly. A voice
// with N segments therefore has N+1 points (the segment boundaries). This is the natural model for
// dragging points and editing their parameters (owner's "вершины-точки").
//
// Derived axes (GT-D6) are computed at display time, not stored: Beat freq = 2 * beatFreqHalf,
// Volume = (volL + volR) / 2, Stereo balance from volL/volR. The stored per-point fields are the
// raw ones the dump provides: baseFreq, beatFreqHalf, volL, volR.
//
// This module is pure TypeScript (no Vue) so it is unit-testable; the Vue layer (GT2.x) wraps an
// instance and re-reads `schedule` after each change (every commit/undo/redo returns a fresh
// top-level object reference, so a shallowRef can track it).

import type { GnauralScheduleData, GnauralScheduleEntry, GnauralScheduleVoice } from '@protocol'

/** A single editable vertex-point of a voice's schedule curve. */
export interface GTrackPoint {
  timeSec: number
  baseFreq: number
  beatFreqHalf: number
  volL: number
  volR: number
}

/** The numeric fields of a point that can be edited individually. */
export type GTrackPointField = 'timeSec' | 'baseFreq' | 'beatFreqHalf' | 'volL' | 'volR'

export interface GTrackVoice {
  readonly id: number
  readonly type: string
  readonly typeIndex: number
  description: string
  mono: boolean
  color: string | null
  audioFilePath: string
  points: GTrackPoint[]
  // GT-D9: true when this voice's points came from expanding a generator (<entry type="preparse">)
  // in the source XML. Such points are rendered distinctly and locked from direct editing until
  // fixPreparseVoice() clears the flag ("fix / make editable"). Only non-preparse voices are written
  // back on Save (so an untouched generator voice keeps its generator node in the file).
  preparse: boolean
}

export interface GTrackSchedule {
  title: string
  author: string
  description: string
  totalTimeSec: number
  loopCount: number
  overallVolL: number
  overallVolR: number
  stereoSwap: boolean
  voices: GTrackVoice[]
}

const POINT_FIELDS: readonly GTrackPointField[] = ['timeSec', 'baseFreq', 'beatFreqHalf', 'volL', 'volR']

// ---------------------------------------------------------------------------
// Conversions: dumped segments <-> editable points.
// ---------------------------------------------------------------------------

/** Convert a voice's segment list (from the dump) into the point list used by the editor. */
export function segmentsToPoints(entries: readonly GnauralScheduleEntry[]): GTrackPoint[] {
  if (entries.length === 0) return []
  const points: GTrackPoint[] = entries.map((e) => ({
    timeSec: e.startSec,
    baseFreq: e.baseFreqStart,
    beatFreqHalf: e.beatFreqHalfStart,
    volL: e.volLStart,
    volR: e.volRStart,
  }))
  const last = entries[entries.length - 1]!
  points.push({
    timeSec: last.endSec,
    baseFreq: last.baseFreqEnd,
    beatFreqHalf: last.beatFreqHalfEnd,
    volL: last.volLEnd,
    volR: last.volREnd,
  })
  return points
}

/** Convert an editor point list back into the segment representation (M points -> M-1 segments). */
export function pointsToSegments(points: readonly GTrackPoint[]): GnauralScheduleEntry[] {
  const segments: GnauralScheduleEntry[] = []
  for (let k = 0; k < points.length - 1; k += 1) {
    const a = points[k]!
    const b = points[k + 1]!
    segments.push({
      startSec: a.timeSec,
      endSec: b.timeSec,
      durationSec: b.timeSec - a.timeSec,
      baseFreqStart: a.baseFreq,
      baseFreqEnd: b.baseFreq,
      beatFreqHalfStart: a.beatFreqHalf,
      beatFreqHalfEnd: b.beatFreqHalf,
      volLStart: a.volL,
      volLEnd: b.volL,
      volRStart: a.volR,
      volREnd: b.volR,
    })
  }
  return segments
}

function voiceToEditable(voice: GnauralScheduleVoice, preparseIds: ReadonlySet<number>): GTrackVoice {
  return {
    id: voice.id,
    type: voice.type,
    typeIndex: voice.typeIndex,
    description: voice.description,
    mono: voice.mono,
    color: voice.color,
    audioFilePath: voice.audioFilePath,
    points: segmentsToPoints(voice.entries),
    preparse: preparseIds.has(voice.id),
  }
}

function scheduleToEditable(data: GnauralScheduleData, preparseIds: ReadonlySet<number>): GTrackSchedule {
  return {
    title: data.title,
    author: data.author,
    description: data.description,
    totalTimeSec: data.totalTimeSec,
    loopCount: data.loopCount,
    overallVolL: data.overallVolL,
    overallVolR: data.overallVolR,
    stereoSwap: data.stereoSwap,
    voices: data.voices.map((v) => voiceToEditable(v, preparseIds)),
  }
}

/** Deep clone an editable schedule (points are plain data, so structuredClone is unnecessary). */
export function cloneSchedule(schedule: GTrackSchedule): GTrackSchedule {
  return {
    ...schedule,
    voices: schedule.voices.map((v) => ({
      ...v,
      points: v.points.map((p) => ({ ...p })),
    })),
  }
}

/** Serialize a schedule back to the dumped shape (used for round-trip verification in GT1.2). */
export function editableToSchedule(schedule: GTrackSchedule): GnauralScheduleData {
  const voices: GnauralScheduleVoice[] = schedule.voices.map((v) => {
    const entries = pointsToSegments(v.points)
    const totalDurationSec = v.points.length > 0 ? v.points[v.points.length - 1]!.timeSec : 0
    return {
      id: v.id,
      type: v.type,
      typeIndex: v.typeIndex,
      description: v.description,
      hidden: false,
      muted: false,
      mono: v.mono,
      color: v.color,
      audioFilePath: v.audioFilePath,
      totalDurationSec,
      entryCount: entries.length,
      entries,
    }
  })
  return {
    title: schedule.title,
    author: schedule.author,
    description: schedule.description,
    totalTimeSec: schedule.totalTimeSec,
    loopCount: schedule.loopCount,
    overallVolL: schedule.overallVolL,
    overallVolR: schedule.overallVolR,
    stereoSwap: schedule.stereoSwap,
    voiceCount: voices.length,
    voices,
  }
}

// ---------------------------------------------------------------------------
// Derived-axis helpers (GT-D6).
// ---------------------------------------------------------------------------

export function pointBeatFreq(p: GTrackPoint): number {
  return p.beatFreqHalf * 2
}
export function pointVolume(p: GTrackPoint): number {
  return (p.volL + p.volR) / 2
}
/** Stereo balance in [-1, 1]: -1 = full left, 0 = centred, +1 = full right. */
export function pointBalance(p: GTrackPoint): number {
  const sum = p.volL + p.volR
  if (sum === 0) return 0
  return (p.volR - p.volL) / sum
}

// ---------------------------------------------------------------------------
// The editable model with an undo/redo history and a dirty flag.
// ---------------------------------------------------------------------------

function signature(schedule: GTrackSchedule): string {
  return JSON.stringify(schedule)
}

export class GTrackModel {
  private current: GTrackSchedule
  private readonly undoStack: GTrackSchedule[] = []
  private readonly redoStack: GTrackSchedule[] = []
  private savedSig: string
  private dirtyFlag = false
  // Open-transaction state: the snapshot taken at beginEdit, restored on cancel / pushed on commit.
  private txnBefore: GTrackSchedule | null = null

  public constructor(data: GnauralScheduleData, preparseVoiceIds?: Iterable<number>) {
    this.current = scheduleToEditable(data, new Set(preparseVoiceIds ?? []))
    this.savedSig = signature(this.current)
  }

  /** The current schedule. A fresh top-level reference is produced on every change. */
  public get schedule(): GTrackSchedule {
    return this.current
  }

  public get isDirty(): boolean {
    return this.dirtyFlag
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  public get inTransaction(): boolean {
    return this.txnBefore !== null
  }

  private recomputeDirty(): void {
    this.dirtyFlag = signature(this.current) !== this.savedSig
  }

  private findVoice(voiceId: number): GTrackVoice {
    const voice = this.current.voices.find((v) => v.id === voiceId)
    if (voice === undefined) throw new Error(`gtrack: unknown voice id ${voiceId}`)
    return voice
  }

  /** True when a voice's points may be edited directly (regular, or a fixed former-preparse voice). */
  public isVoiceEditable(voiceId: number): boolean {
    return !this.findVoice(voiceId).preparse
  }

  private assertEditable(voiceId: number): void {
    if (this.findVoice(voiceId).preparse) {
      throw new Error(`gtrack: voice ${voiceId} is preparse-locked; fix it first`)
    }
  }

  // --- Transactions ---------------------------------------------------------
  // A transaction groups a run of edits into a single undo unit. Drag interactions open a
  // transaction on pointerdown, mutate on each move, and commit on pointerup.

  public beginEdit(): void {
    if (this.txnBefore !== null) throw new Error('gtrack: a transaction is already open')
    // Mutations replace objects immutably (never mutate in place), so the current reference is a
    // safe snapshot — no deep clone required.
    this.txnBefore = this.current
  }

  /** Commit the open transaction. If nothing actually changed, it is dropped (no undo entry). */
  public commitEdit(): void {
    if (this.txnBefore === null) throw new Error('gtrack: no open transaction')
    const before = this.txnBefore
    this.txnBefore = null
    if (signature(before) === signature(this.current)) return
    this.undoStack.push(before)
    this.redoStack.length = 0
    this.recomputeDirty()
  }

  /** Abort the open transaction, restoring the pre-transaction state. */
  public cancelEdit(): void {
    if (this.txnBefore === null) throw new Error('gtrack: no open transaction')
    this.current = this.txnBefore
    this.txnBefore = null
  }

  /** Convenience: run a single atomic edit (begin -> mutate -> commit). */
  public edit(mutator: () => void): void {
    this.beginEdit()
    try {
      mutator()
    } catch (error) {
      this.cancelEdit()
      throw error
    }
    this.commitEdit()
  }

  // --- Mutations ------------------------------------------------------------
  // Each mutation replaces the affected voice + point with new objects (structural sharing for the
  // rest), so `schedule` yields a new reference the Vue layer can track. Must be called inside a
  // transaction (beginEdit/commitEdit) or via edit().

  private ensureOpen(): void {
    if (this.txnBefore === null) throw new Error('gtrack: mutation outside a transaction; use edit() or beginEdit()')
  }

  private replaceVoice(voiceId: number, updater: (voice: GTrackVoice) => GTrackVoice): void {
    this.current = {
      ...this.current,
      voices: this.current.voices.map((v) => (v.id === voiceId ? updater(v) : v)),
    }
  }

  private replacePoint(voiceId: number, index: number, updater: (point: GTrackPoint) => GTrackPoint): void {
    this.replaceVoice(voiceId, (voice) => {
      if (index < 0 || index >= voice.points.length) {
        throw new Error(`gtrack: point index ${index} out of range for voice ${voiceId}`)
      }
      const points = voice.points.slice()
      points[index] = updater(points[index]!)
      return { ...voice, points }
    })
  }

  /** Set one numeric field of a point. */
  public setPointField(voiceId: number, index: number, field: GTrackPointField, value: number): void {
    this.ensureOpen()
    this.assertEditable(voiceId)
    if (!Number.isFinite(value)) throw new Error(`gtrack: non-finite value for ${field}`)
    this.replacePoint(voiceId, index, (p) => ({ ...p, [field]: value }))
  }

  /** Set several fields of a point at once (e.g. from the parameters dialog). */
  public setPointFields(voiceId: number, index: number, patch: Partial<Record<GTrackPointField, number>>): void {
    this.ensureOpen()
    this.assertEditable(voiceId)
    for (const field of POINT_FIELDS) {
      const v = patch[field]
      if (v !== undefined && !Number.isFinite(v)) throw new Error(`gtrack: non-finite value for ${field}`)
    }
    this.replacePoint(voiceId, index, (p) => {
      const next = { ...p }
      for (const field of POINT_FIELDS) {
        const v = patch[field]
        if (v !== undefined) next[field] = v
      }
      return next
    })
  }

  /**
   * Move a point (drag): set its time (clamped monotonically between its neighbours) and,
   * optionally, one value field. Returns the applied time after clamping.
   */
  public movePoint(
    voiceId: number,
    index: number,
    timeSec: number,
    valueField?: Exclude<GTrackPointField, 'timeSec'>,
    value?: number,
  ): number {
    this.ensureOpen()
    this.assertEditable(voiceId)
    const voice = this.findVoice(voiceId)
    const clampedTime = clampPointTime(voice.points, index, timeSec)
    this.replacePoint(voiceId, index, (p) => {
      const next = { ...p, timeSec: clampedTime }
      if (valueField !== undefined && value !== undefined) {
        if (!Number.isFinite(value)) throw new Error(`gtrack: non-finite value for ${valueField}`)
        next[valueField] = value
      }
      return next
    })
    return clampedTime
  }

  /**
   * Insert a new point at `timeSec`, which must fall strictly inside an existing segment. Its
   * values are linearly interpolated from that segment (so the curve is unchanged until the point
   * is moved). Returns the index of the inserted point. (GT-D8 / owner req. 9)
   */
  public insertPoint(voiceId: number, timeSec: number): number {
    this.ensureOpen()
    this.assertEditable(voiceId)
    if (!Number.isFinite(timeSec)) throw new Error('gtrack: non-finite insert time')
    const pts = this.findVoice(voiceId).points
    if (pts.length < 2) throw new Error('gtrack: cannot insert into a voice with fewer than 2 points')
    let seg = -1
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (timeSec > pts[i]!.timeSec && timeSec < pts[i + 1]!.timeSec) {
        seg = i
        break
      }
    }
    if (seg < 0) throw new Error(`gtrack: insert time ${timeSec} is not strictly inside a segment`)
    const a = pts[seg]!
    const b = pts[seg + 1]!
    const f = (timeSec - a.timeSec) / (b.timeSec - a.timeSec)
    const lerp = (x: number, y: number): number => x + f * (y - x)
    const inserted: GTrackPoint = {
      timeSec,
      baseFreq: lerp(a.baseFreq, b.baseFreq),
      beatFreqHalf: lerp(a.beatFreqHalf, b.beatFreqHalf),
      volL: lerp(a.volL, b.volL),
      volR: lerp(a.volR, b.volR),
    }
    const index = seg + 1
    this.replaceVoice(voiceId, (v) => {
      const points = v.points.slice()
      points.splice(index, 0, inserted)
      return { ...v, points }
    })
    return index
  }

  /** Remove a point. A voice must keep at least 2 points (>= 1 segment). (GT-D8 / owner req. 9) */
  public removePoint(voiceId: number, index: number): void {
    this.ensureOpen()
    this.assertEditable(voiceId)
    const voice = this.findVoice(voiceId)
    if (voice.points.length <= 2) {
      throw new Error('gtrack: cannot remove; a voice must keep at least 2 points')
    }
    if (index < 0 || index >= voice.points.length) {
      throw new Error(`gtrack: point index ${index} out of range for voice ${voiceId}`)
    }
    this.replaceVoice(voiceId, (v) => {
      const points = v.points.slice()
      points.splice(index, 1)
      return { ...v, points }
    })
  }

  /**
   * Fix a preparse voice: clear its `preparse` flag so its (already-concrete) points become
   * editable and it is written back on Save. Irreversible within the file — the caller should warn
   * the user (GT-D9 / owner req. 11). A no-op on an already-editable voice.
   */
  public fixPreparseVoice(voiceId: number): void {
    if (!this.findVoice(voiceId).preparse) return
    this.edit(() => {
      this.replaceVoice(voiceId, (v) => ({ ...v, preparse: false }))
    })
  }

  // --- Undo / redo ----------------------------------------------------------

  public undo(): boolean {
    if (this.txnBefore !== null) throw new Error('gtrack: cannot undo during an open transaction')
    const previous = this.undoStack.pop()
    if (previous === undefined) return false
    this.redoStack.push(this.current)
    this.current = previous
    this.recomputeDirty()
    return true
  }

  public redo(): boolean {
    if (this.txnBefore !== null) throw new Error('gtrack: cannot redo during an open transaction')
    const next = this.redoStack.pop()
    if (next === undefined) return false
    this.undoStack.push(this.current)
    this.current = next
    this.recomputeDirty()
    return true
  }

  // --- Save bookkeeping -----------------------------------------------------

  /** Mark the current state as the saved baseline (clears the dirty flag). */
  public markSaved(): void {
    this.savedSig = signature(this.current)
    this.dirtyFlag = false
  }

  /** The current schedule serialized back to the dumped shape (for the XML patcher / verification). */
  public toSchedule(): GnauralScheduleData {
    return editableToSchedule(this.current)
  }
}

/**
 * Clamp a point's time so the point sequence stays non-decreasing in time. The point may not move
 * before its previous neighbour nor after its next neighbour (endpoints are still bounded by their
 * single neighbour). Standalone + pure so it can be unit-tested and reused by the drag UI (GT3.2).
 */
export function clampPointTime(points: readonly GTrackPoint[], index: number, timeSec: number): number {
  const lower = index > 0 ? points[index - 1]!.timeSec : Number.NEGATIVE_INFINITY
  const upper = index < points.length - 1 ? points[index + 1]!.timeSec : Number.POSITIVE_INFINITY
  return Math.max(lower, Math.min(upper, timeSec))
}
