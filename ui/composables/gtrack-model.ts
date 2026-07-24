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
import { perfLogVerbose, perfNow, scheduleSize } from './perf-log'

/** A single editable vertex-point of a voice's schedule curve. */
export interface GTrackPoint {
  /** undo-branch-merge BM-D2: stable identity for point-level deltas and three-way merges.
   *  Session-entropy ids (like step ids) — unique across forks and restarts. Never serialized
   *  into the .gnaural file; carried by log snapshots via optional entry fields (pointId /
   *  endPointId) and excluded from every signature (BM-D3). */
  id: string
  timeSec: number
  baseFreq: number
  beatFreqHalf: number
  volL: number
  volR: number
}

// BM-D2: session-unique point-id source (the same idiom as step ids below).
let pointSeq = 0
export function newPointId(): string {
  return `q${Date.now().toString(36)}-${(pointSeq++).toString(36)}`
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

/** Convert a voice's segment list (from the dump) into the point list used by the editor.
 *  BM-D2: point ids come from the optional entry fields when present (a log snapshot written by
 *  toScheduleWithIds) and are generated fresh otherwise (a plain file parse). */
export function segmentsToPoints(entries: readonly GnauralScheduleEntry[]): GTrackPoint[] {
  if (entries.length === 0) return []
  const points: GTrackPoint[] = entries.map((e) => ({
    id: e.pointId ?? newPointId(),
    timeSec: e.startSec,
    baseFreq: e.baseFreqStart,
    beatFreqHalf: e.beatFreqHalfStart,
    volL: e.volLStart,
    volR: e.volRStart,
  }))
  const last = entries[entries.length - 1]!
  points.push({
    id: last.endPointId ?? newPointId(),
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

/** BM-D2: the id-carrying twin of pointsToSegments — used ONLY for log snapshot payloads, never
 *  for the file/XML/audio paths (P5: those stay byte-identical to the id-less world). */
export function pointsToSegmentsWithIds(points: readonly GTrackPoint[]): GnauralScheduleEntry[] {
  const segments = pointsToSegments(points)
  for (let k = 0; k < segments.length; k += 1) {
    segments[k] = { ...segments[k]!, pointId: points[k]!.id }
  }
  if (segments.length > 0) {
    segments[segments.length - 1] = { ...segments[segments.length - 1]!, endPointId: points[points.length - 1]!.id }
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

/** Serialize a schedule back to the dumped shape (used for round-trip verification in GT1.2).
 *  BM-D2/P5: id-free — the file/XML/audio serialization is byte-identical to the pre-id world.
 *  Pass withPointIds ONLY when building a log snapshot payload (identity survives the restart). */
export function editableToSchedule(schedule: GTrackSchedule, withPointIds = false): GnauralScheduleData {
  const voices: GnauralScheduleVoice[] = schedule.voices.map((v) => {
    const entries = withPointIds ? pointsToSegmentsWithIds(v.points) : pointsToSegments(v.points)
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

/** BM-D3 (id-invariance): signatures are computed over an id-less projection whose JSON is
 *  byte-identical to the pre-id serialization — existing snapshot anchors and file-derived
 *  signatures keep converging. The explicit 5-field rebuild also pins the key order. */
function signature(schedule: GTrackSchedule, tag = 'signature'): string {
  const start = perfNow()
  const result = JSON.stringify({
    ...schedule,
    voices: schedule.voices.map((v) => ({
      ...v,
      points: v.points.map((p) => ({
        timeSec: p.timeSec,
        baseFreq: p.baseFreq,
        beatFreqHalf: p.beatFreqHalf,
        volL: p.volL,
        volR: p.volR,
      })),
    })),
  })
  perfLogVerbose(`signature[${tag}]`, start, scheduleSize(schedule))
  return result
}

/** UC-D1/UC-D2 (undo-command-log): one undo STEP = the changed-voice deltas of a transaction. The
 *  editor never adds/removes voices (only their points change), so a step maps voiceId -> the voice
 *  before and after; undo swaps in `before`, redo swaps in `after`. */
export interface GTrackVoiceDelta {
  readonly voiceId: number
  readonly before: GTrackVoice
  readonly after: GTrackVoice
}

/** undo-branch-merge BM-D4: the point-level delta — ONLY the points that changed. null side =
 *  insertion/removal; the indexes pin the exact array position on each side, so replay
 *  reconstructs byte-exact order even across crossover re-sorts (unchanged points keep their
 *  relative order and fill the remaining slots). */
export interface GTrackPointDelta {
  readonly id: string
  readonly before: GTrackPoint | null
  readonly beforeIndex: number | null
  readonly after: GTrackPoint | null
  readonly afterIndex: number | null
}

export interface GTrackVoicePointsDelta {
  readonly voiceId: number
  /** The voice name at commit time — the panel label without carrying the whole voice. */
  readonly description: string
  readonly points: readonly GTrackPointDelta[]
}

/** A step's per-voice delta: the compact point form (new commits) or the legacy whole-voice
 *  before/after (steps read back from old log payloads — readable forever, BM-D4). Steps whose
 *  change is NOT point-level (e.g. the fix-preparse flag) also use the legacy form. */
export type GTrackStepVoiceDelta = GTrackVoiceDelta | GTrackVoicePointsDelta

export const isPointsDelta = (delta: GTrackStepVoiceDelta): delta is GTrackVoicePointsDelta => {
  return 'points' in delta
}
/** UG2.2 (undo-global-journal, UG-D2): a step is a COMMIT — voice deltas plus metadata for the
 *  operations panel (kind + label) and a stable id + timestamp as the groundwork for a future
 *  git-like version model (the linear log is the "main branch" special case). */
export interface GTrackUndoStep {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly atMs: number
  readonly voices: readonly GTrackStepVoiceDelta[]
}

/** project-store PR2.2 (PR-D8) + UC-D3/UC-D5 + UG-D3: the persistable undo history, v3 — a compact
 *  action log (steps of voice-deltas + commit metadata) + a cursor. currentSig pins the state the
 *  log chains to, so a journal is only ever adopted onto the exact schedule it was exported from.
 *  v1 (snapshot) and v2 (no step metadata) journals are rejected by isGTrackUndoJournal ->
 *  discarded on load (UG-D3: history is best-effort per file, no converter). */
export interface GTrackUndoJournal {
  readonly version: 3
  readonly currentSig: string
  /** UG3.2c (req 4): the signature of the SAVED state the log chains through + its position in
   *  `steps`. Present only while that position is inside the exported window. Lets a restart adopt
   *  the journal even when the session ended with unsaved edits (currentSig then matches nothing on
   *  disk): the model adopts at baseCursor and the lost unsaved tail becomes REDO. */
  readonly baseSig?: string
  readonly baseCursor?: number
  readonly cursor: number
  readonly steps: readonly GTrackUndoStep[]
}

/** UG2.1 (undo-global-journal, UG-D1): the undo action log + cursor as a standalone container. It is
 *  owned by the lanes layer and passed into every GTrackModel built for the same file, so a model
 *  rebuild (save round-trip, schedule re-emit) no longer drops the history. Mutated in place by the
 *  owning model. */
export interface GTrackHistory {
  steps: GTrackUndoStep[]
  cursor: number
}

export function createGTrackHistory(): GTrackHistory {
  return { steps: [], cursor: 0 }
}

// UG2.2: session-unique step-id suffix (ids arriving from an adopted journal are kept as-is).
let stepSeq = 0

/** Value equality of the 5 point fields (ids excluded) — shared with the merge planner (BM2.1). */
export const pointFieldsEqual = (a: GTrackPoint, b: GTrackPoint): boolean => {
  return a.timeSec === b.timeSec && a.baseFreq === b.baseFreq && a.beatFreqHalf === b.beatFreqHalf &&
    a.volL === b.volL && a.volR === b.volR
}

/** BM-D4: diff two point lists by id into the compact delta form. */
function diffVoicePoints(before: readonly GTrackPoint[], after: readonly GTrackPoint[]): GTrackPointDelta[] {
  const afterById = new Map(after.map((p, i) => [p.id, { p, i }]))
  const out: GTrackPointDelta[] = []
  before.forEach((bp, bi) => {
    const a = afterById.get(bp.id)
    if (a === undefined) {
      out.push({ id: bp.id, before: bp, beforeIndex: bi, after: null, afterIndex: null })
    } else if (!pointFieldsEqual(bp, a.p)) {
      out.push({ id: bp.id, before: bp, beforeIndex: bi, after: a.p, afterIndex: a.i })
    }
  })
  const beforeIds = new Set(before.map((p) => p.id))
  after.forEach((ap, ai) => {
    if (!beforeIds.has(ap.id)) {
      out.push({ id: ap.id, before: null, beforeIndex: null, after: ap, afterIndex: ai })
    }
  })
  return out
}

/** BM-D4: apply one side of a point delta to a point list. Delta'd ids are pulled out, the
 *  unchanged points keep their relative order, and the target-side points are spliced back at
 *  their recorded indexes — reconstructing the exact target array. */
function applyPointsDeltaSide(points: readonly GTrackPoint[], deltas: readonly GTrackPointDelta[], side: 'before' | 'after'): GTrackPoint[] {
  const touched = new Set(deltas.map((d) => d.id))
  const result = points.filter((p) => !touched.has(p.id))
  const placed = deltas
    .map((d) => ({ point: side === 'before' ? d.before : d.after, index: side === 'before' ? d.beforeIndex : d.afterIndex }))
    .filter((x): x is { point: GTrackPoint; index: number } => x.point !== null && x.index !== null)
    .sort((a, b) => a.index - b.index)
  for (const { point, index } of placed) {
    result.splice(Math.max(0, Math.min(index, result.length)), 0, { ...point })
  }
  return result
}

/** UG2.1: signature of raw dump content as the editor would model it — directly comparable with a
 *  model's savedSignature/currentSignature (the same scheduleToEditable path). */
export function scheduleContentSignature(data: GnauralScheduleData, preparseIds: Iterable<number>): string {
  return signature(scheduleToEditable(data, new Set(preparseIds)), 'scheduleContentSignature')
}

/** UG3.2b (undo-global-journal, req 12): a human-oriented diff of one step — WHICH points changed
 *  and HOW (was/became), for the operations-panel hover tooltip. Pure and bounded. Same-length
 *  point lists are paired by index (field edits, clamp moves); a length change is resolved as
 *  added/removed points via a time-multiset diff (stable enough for display under crossover). */
export interface GTrackStepFieldChange {
  readonly field: GTrackPointField
  readonly before: number
  readonly after: number
}

export interface GTrackStepPointChange {
  readonly voiceId: number
  readonly change: 'changed' | 'added' | 'removed'
  /** Point index (in `after` for changed/added, in `before` for removed). */
  readonly index: number
  /** The point shown (the after-state for changed/added, the removed point for 'removed'). */
  readonly point: GTrackPoint
  /** Field-level was/became — non-empty only for 'changed'. */
  readonly fields: readonly GTrackStepFieldChange[]
}

export function describeStepChanges(step: GTrackUndoStep, maxChanges = 8): GTrackStepPointChange[] {
  const out: GTrackStepPointChange[] = []
  for (const d of step.voices) {
    if (out.length >= maxChanges) break
    // BM-D4: the point form IS the diff — exact by id, no positional guessing.
    if (isPointsDelta(d)) {
      for (const pd of d.points) {
        if (out.length >= maxChanges) break
        if (pd.before !== null && pd.after !== null) {
          const fields: GTrackStepFieldChange[] = []
          for (const f of POINT_FIELDS) {
            if (pd.before[f] !== pd.after[f]) fields.push({ field: f, before: pd.before[f], after: pd.after[f] })
          }
          if (fields.length > 0) out.push({ voiceId: d.voiceId, change: 'changed', index: pd.afterIndex ?? 0, point: pd.after, fields })
        } else if (pd.after !== null) {
          out.push({ voiceId: d.voiceId, change: 'added', index: pd.afterIndex ?? 0, point: pd.after, fields: [] })
        } else if (pd.before !== null) {
          out.push({ voiceId: d.voiceId, change: 'removed', index: pd.beforeIndex ?? 0, point: pd.before, fields: [] })
        }
      }
      continue
    }
    const b = d.before.points
    const a = d.after.points
    if (b.length === a.length) {
      for (let i = 0; i < a.length && out.length < maxChanges; i += 1) {
        const fields: GTrackStepFieldChange[] = []
        for (const f of POINT_FIELDS) {
          if (b[i]![f] !== a[i]![f]) fields.push({ field: f, before: b[i]![f], after: a[i]![f] })
        }
        if (fields.length > 0) out.push({ voiceId: d.voiceId, change: 'changed', index: i, point: a[i]!, fields })
      }
      continue
    }
    // A length change: report the surplus side. Times present in the shorter list are matched away
    // as a multiset; what remains in the longer list is what was added (or removed).
    const grew = a.length > b.length
    const longer = grew ? a : b
    const shorter = grew ? b : a
    const remaining = new Map<number, number>()
    for (const p of shorter) remaining.set(p.timeSec, (remaining.get(p.timeSec) ?? 0) + 1)
    for (let i = 0; i < longer.length && out.length < maxChanges; i += 1) {
      const t = longer[i]!.timeSec
      const n = remaining.get(t) ?? 0
      if (n > 0) {
        remaining.set(t, n - 1)
        continue
      }
      out.push({ voiceId: d.voiceId, change: grew ? 'added' : 'removed', index: i, point: longer[i]!, fields: [] })
    }
  }
  return out
}

/** MSR-D7 (owner 2026-07-24, req 4): the TOTAL number of points a step changed/added/removed, using
 *  the exact same counting rules as describeStepChanges but WITHOUT allocating the per-point objects
 *  or applying its display cap — so the journal can label a multi-point step "N points" instead of
 *  listing (and truncating) them. */
export function describeStepChangeCount(step: GTrackUndoStep): number {
  let n = 0
  for (const d of step.voices) {
    if (isPointsDelta(d)) {
      for (const pd of d.points) {
        if (pd.before !== null && pd.after !== null) {
          if (POINT_FIELDS.some((f) => pd.before![f] !== pd.after![f])) n += 1
        } else if (pd.after !== null || pd.before !== null) {
          n += 1
        }
      }
      continue
    }
    const b = d.before.points
    const a = d.after.points
    if (b.length === a.length) {
      for (let i = 0; i < a.length; i += 1) {
        if (POINT_FIELDS.some((f) => b[i]![f] !== a[i]![f])) n += 1
      }
      continue
    }
    n += Math.abs(a.length - b.length)
  }
  return n
}

/** UG4.1 (req 5): bound a journal by age and byte size by dropping the OLDEST steps (steps are
 *  chronological, so trimming from the front keeps the chain contiguous). cursor/baseCursor shift
 *  accordingly; the base marker is dropped once its position leaves the window. Pure — `nowMs`
 *  comes from the caller. */
export function trimUndoJournal(
  journal: GTrackUndoJournal,
  opts: { readonly maxAgeMs?: number; readonly maxBytes?: number; readonly nowMs: number },
): GTrackUndoJournal {
  let drop = 0
  const steps = journal.steps
  if (opts.maxAgeMs !== undefined && opts.maxAgeMs > 0) {
    const cutoff = opts.nowMs - opts.maxAgeMs
    while (drop < steps.length && steps[drop]!.atMs < cutoff) drop += 1
  }
  const build = (k: number): GTrackUndoJournal => {
    const baseCursor = journal.baseCursor !== undefined ? journal.baseCursor - k : undefined
    const baseKept = baseCursor !== undefined && baseCursor >= 0 && journal.baseSig !== undefined
    return {
      version: 3,
      currentSig: journal.currentSig,
      ...(baseKept ? { baseSig: journal.baseSig, baseCursor } : {}),
      cursor: Math.max(0, journal.cursor - k),
      steps: steps.slice(k),
    }
  }
  let out = drop > 0 ? build(drop) : journal
  if (opts.maxBytes !== undefined && opts.maxBytes > 0) {
    while (out.steps.length > 0 && JSON.stringify(out).length > opts.maxBytes) {
      drop += 1
      out = build(drop)
    }
  }
  return out
}

/** BM-D4 (compat): steps arriving from old log payloads carry id-less points — assign fresh ids
 *  so the in-memory invariant «every point has an id» holds. Ids differ per step (the same
 *  conceptual point gets a new id in each old step), which is exactly the legacy situation the
 *  merge treats voice-level (BM-D5); undo/redo swap whole voices and are unaffected. */
function ensureVoicePointIds(voice: GTrackVoice): GTrackVoice {
  if (voice.points.every((p) => typeof p.id === 'string' && p.id !== '')) return voice
  return {
    ...voice,
    points: voice.points.map((p) => (typeof p.id === 'string' && p.id !== '' ? p : { ...p, id: newPointId() })),
  }
}

function normalizeStepPointIds(step: GTrackUndoStep): GTrackUndoStep {
  const clean = step.voices.every((d) => isPointsDelta(d)
    || (d.before.points.every((p) => typeof p.id === 'string' && p.id !== '')
      && d.after.points.every((p) => typeof p.id === 'string' && p.id !== '')))
  if (clean) return step
  return {
    ...step,
    voices: step.voices.map((d) => (isPointsDelta(d) ? d : {
      voiceId: d.voiceId,
      before: ensureVoicePointIds(d.before),
      after: ensureVoicePointIds(d.after),
    })),
  }
}

export function isGTrackUndoJournal(value: unknown): value is GTrackUndoJournal {
  if (value === null || typeof value !== 'object') return false
  const c = value as { version?: unknown; currentSig?: unknown; baseSig?: unknown; baseCursor?: unknown; cursor?: unknown; steps?: unknown }
  if (c.version !== 3 || typeof c.currentSig !== 'string' || typeof c.cursor !== 'number') return false
  if (c.baseSig !== undefined && typeof c.baseSig !== 'string') return false
  if (c.baseCursor !== undefined && typeof c.baseCursor !== 'number') return false
  const isVoiceLike = (v: unknown): boolean =>
    v !== null && typeof v === 'object' && typeof (v as GTrackVoice).id === 'number' && Array.isArray((v as GTrackVoice).points)
  return Array.isArray(c.steps) && c.steps.every((s) =>
    s !== null && typeof s === 'object'
    && typeof (s as GTrackUndoStep).id === 'string'
    && typeof (s as GTrackUndoStep).kind === 'string'
    && typeof (s as GTrackUndoStep).label === 'string'
    && typeof (s as GTrackUndoStep).atMs === 'number'
    && Array.isArray((s as GTrackUndoStep).voices)
    && (s as GTrackUndoStep).voices.every((d) => {
      if (d === null || typeof d !== 'object' || typeof (d as GTrackVoiceDelta).voiceId !== 'number') return false
      // BM-D4: the compact point form is journal-legal alongside the legacy whole-voice form.
      if ('points' in d) {
        const pd = d as GTrackVoicePointsDelta
        return typeof pd.description === 'string' && Array.isArray(pd.points) && pd.points.every((p) =>
          p !== null && typeof p === 'object' && typeof p.id === 'string'
          && (p.before === null || (typeof p.before === 'object' && p.before !== null))
          && (p.after === null || (typeof p.after === 'object' && p.after !== null)))
      }
      return isVoiceLike((d as GTrackVoiceDelta).before) && isVoiceLike((d as GTrackVoiceDelta).after)
    }))
}

export class GTrackModel {
  private current: GTrackSchedule
  // UC-D1: the undo history is a linear action log + a cursor (not two snapshot stacks). steps[0..cursor)
  // are undoable, steps[cursor..] redoable; a new commit truncates the redo tail and appends.
  // UG2.1 (UG-D1): the log lives in an EXTERNAL container owned by the caller — passing the same
  // container into a rebuilt model carries the history across the rebuild.
  private readonly history: GTrackHistory
  private savedSig: string
  // UG3.2c: the history position whose state equals the saved baseline (-1 = that state is no
  // longer in the log, e.g. an edit truncated it away). Exported as baseCursor for restart adoption.
  private savedCursor = 0
  private dirtyFlag = false
  // Open-transaction state: the snapshot taken at beginEdit, restored on cancel / pushed on commit.
  private txnBefore: GTrackSchedule | null = null
  // UG2.2 (UG-D2): the operation kind declared at beginEdit, recorded on the committed step.
  private txnKind = 'edit'

  public constructor(data: GnauralScheduleData, preparseVoiceIds?: Iterable<number>, history?: GTrackHistory) {
    this.current = scheduleToEditable(data, new Set(preparseVoiceIds ?? []))
    this.savedSig = signature(this.current, 'ctor')
    this.history = history ?? createGTrackHistory()
    // A carried-over container is trusted (same file, same session); only the cursor is clamped.
    this.history.cursor = Math.max(0, Math.min(this.history.cursor, this.history.steps.length))
    // The build data IS the saved baseline, and the (possibly carried) cursor points at it.
    this.savedCursor = this.history.cursor
  }

  /** The current schedule. A fresh top-level reference is produced on every change. */
  public get schedule(): GTrackSchedule {
    return this.current
  }

  public get isDirty(): boolean {
    return this.dirtyFlag
  }

  public get canUndo(): boolean {
    return this.history.cursor > 0
  }

  public get canRedo(): boolean {
    return this.history.cursor < this.history.steps.length
  }

  /** UG3.1: the full in-memory action log + cursor, read-only — the operations panel renders it. */
  public get historySteps(): readonly GTrackUndoStep[] {
    return this.history.steps
  }

  public get historyCursor(): number {
    return this.history.cursor
  }

  /** UG2.1: signature of the saved baseline this model was built from (or last markSaved). Used by
   *  the lanes content guard to recognize a re-emit of the unchanged file. */
  public get savedSignature(): string {
    return this.savedSig
  }

  /** UG2.1: signature of the current (possibly edited) state. */
  public get currentSignature(): string {
    return signature(this.current, 'currentSignature')
  }

  public get inTransaction(): boolean {
    return this.txnBefore !== null
  }

  private recomputeDirty(): void {
    this.dirtyFlag = signature(this.current, 'recomputeDirty') !== this.savedSig
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

  public beginEdit(kind = 'edit'): void {
    if (this.txnBefore !== null) throw new Error('gtrack: a transaction is already open')
    // Mutations replace objects immutably (never mutate in place), so the current reference is a
    // safe snapshot — no deep clone required.
    this.txnBefore = this.current
    this.txnKind = kind
  }

  /** Commit the open transaction. If nothing actually changed, it is dropped (no undo entry). The step
   *  records only the voices whose reference changed (structural sharing -> exactly the edited voices,
   *  usually one), each as before/after. UG2.2 (UG-D2): the step is stamped as a commit — stable id,
   *  the kind declared at beginEdit, a label from the changed voices' names, and a timestamp. */
  public commitEdit(): void {
    if (this.txnBefore === null) throw new Error('gtrack: no open transaction')
    const perfStart = perfNow()
    const before = this.txnBefore
    this.txnBefore = null
    if (signature(before, 'commitEdit:before') === signature(this.current, 'commitEdit:after')) {
      perfLogVerbose(`commitEdit[${this.txnKind}] (no-op)`, perfStart, scheduleSize(this.current))
      return
    }
    const afterById = new Map(this.current.voices.map((v) => [v.id, v]))
    const deltas: GTrackStepVoiceDelta[] = []
    for (const bv of before.voices) {
      const av = afterById.get(bv.id)
      if (av === undefined || av === bv) continue
      // BM-D4: point-only changes commit as compact point deltas; a non-point change (the
      // fix-preparse flag — the one voice-level mutation) keeps the legacy whole-voice form.
      const nonPointChange =
        bv.preparse !== av.preparse || bv.description !== av.description || bv.mono !== av.mono ||
        bv.color !== av.color || bv.audioFilePath !== av.audioFilePath
      if (nonPointChange) {
        deltas.push({ voiceId: bv.id, before: bv, after: av })
      } else {
        const points = diffVoicePoints(bv.points, av.points)
        if (points.length > 0) deltas.push({ voiceId: bv.id, description: av.description, points })
      }
    }
    if (deltas.length === 0) {
      perfLogVerbose(`commitEdit[${this.txnKind}] (metadata-only, no delta)`, perfStart, scheduleSize(this.current))
      return // signatures differed only in schedule metadata? nothing per-voice
    }
    const atMs = Date.now()
    this.history.steps.length = this.history.cursor // drop the redo tail
    // UG3.2c: if the saved state's position was inside the dropped tail, it left the log.
    if (this.savedCursor > this.history.cursor) this.savedCursor = -1
    this.history.steps.push({
      id: `${atMs.toString(36)}-${(stepSeq++).toString(36)}`,
      kind: this.txnKind,
      label: deltas
        .map((d) => {
          const name = isPointsDelta(d) ? d.description : d.after.description
          return name.trim() !== '' ? name : `#${d.voiceId}`
        })
        .join(', '),
      atMs,
      voices: deltas,
    })
    this.history.cursor = this.history.steps.length
    this.recomputeDirty()
    perfLogVerbose(`commitEdit[${this.txnKind}]`, perfStart, { ...scheduleSize(this.current), deltaVoices: deltas.length })
  }

  /** Abort the open transaction, restoring the pre-transaction state. */
  public cancelEdit(): void {
    if (this.txnBefore === null) throw new Error('gtrack: no open transaction')
    this.current = this.txnBefore
    this.txnBefore = null
  }

  /** Convenience: run a single atomic edit (begin -> mutate -> commit). */
  public edit(mutator: () => void, kind = 'edit'): void {
    this.beginEdit(kind)
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

  /** VL5.1 (undo-versioned-log): swap a voice's whole point set — the checkout primitive. The
   *  panel reconstructs a historical state from a log snapshot + deltas and applies it through a
   *  normal transaction (kind 'checkout'), so the rollback itself is one undoable step. */
  public replaceVoicePoints(voiceId: number, points: readonly GTrackPoint[]): void {
    this.ensureOpen()
    this.assertEditable(voiceId)
    if (points.length < 2) throw new Error('gtrack: a voice needs at least 2 points')
    for (const p of points) {
      if (
        !Number.isFinite(p.timeSec) || !Number.isFinite(p.baseFreq) || !Number.isFinite(p.beatFreqHalf) ||
        !Number.isFinite(p.volL) || !Number.isFinite(p.volR)
      ) {
        throw new Error('gtrack: non-finite point value in replaceVoicePoints')
      }
    }
    this.replaceVoice(voiceId, (voice) => ({ ...voice, points: points.map((p) => ({ ...p })) }))
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
   * GT3.10 (GT-D16 'crossover'): move a point WITHOUT neighbour clamping. The point may cross its
   * neighbours; points are stably re-sorted by time and the moved point's NEW index is returned so
   * the drag can keep following it. Time is floored at 0.
   */
  public movePointCrossing(
    voiceId: number,
    index: number,
    timeSec: number,
    valueField?: Exclude<GTrackPointField, 'timeSec'>,
    value?: number,
  ): number {
    this.ensureOpen()
    this.assertEditable(voiceId)
    if (!Number.isFinite(timeSec)) throw new Error('gtrack: non-finite move time')
    let newIndex = index
    this.replaceVoice(voiceId, (voice) => {
      if (index < 0 || index >= voice.points.length) {
        throw new Error(`gtrack: point index ${index} out of range for voice ${voiceId}`)
      }
      const moved: GTrackPoint = { ...voice.points[index]!, timeSec: Math.max(0, timeSec) }
      if (valueField !== undefined && value !== undefined) {
        if (!Number.isFinite(value)) throw new Error(`gtrack: non-finite value for ${valueField}`)
        moved[valueField] = value
      }
      const points = voice.points.slice()
      points[index] = moved
      points.sort((a, b) => a.timeSec - b.timeSec) // stable — equal times keep their order
      newIndex = points.indexOf(moved)
      return { ...voice, points }
    })
    return newIndex
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
      id: newPointId(), // BM-D2/P1: a fresh identity; delete+undo restores the ORIGINAL id instead
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

  /**
   * Remove a point. GT10.33 (owner 2026-07-12): a voice may be emptied entirely — the editor no
   * longer floors at 2 points; the user's safety net is Undo (the inspector stays open on the last
   * delete). Note insertPoint still needs >= 2 points to interpolate, so an emptied voice can only
   * be restored via Undo.
   */
  public removePoint(voiceId: number, index: number): void {
    this.ensureOpen()
    this.assertEditable(voiceId)
    const voice = this.findVoice(voiceId)
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
    }, 'fix-preparse')
  }

  // --- Undo / redo ----------------------------------------------------------

  public undo(): boolean {
    if (this.txnBefore !== null) throw new Error('gtrack: cannot undo during an open transaction')
    if (this.history.cursor === 0) return false
    this.history.cursor -= 1
    this.applyDelta(this.history.steps[this.history.cursor]!, 'before')
    this.recomputeDirty()
    return true
  }

  public redo(): boolean {
    if (this.txnBefore !== null) throw new Error('gtrack: cannot redo during an open transaction')
    if (this.history.cursor >= this.history.steps.length) return false
    this.applyDelta(this.history.steps[this.history.cursor]!, 'after')
    this.history.cursor += 1
    this.recomputeDirty()
    return true
  }

  /** Swap a step's voices into `current` (undo -> before, redo -> after), producing a fresh top-level
   *  reference so the Vue layer re-reads. */
  private applyDelta(step: GTrackUndoStep, side: 'before' | 'after'): void {
    if (step.voices.length === 0) return
    const byVoice = new Map(step.voices.map((d) => [d.voiceId, d]))
    this.current = {
      ...this.current,
      voices: this.current.voices.map((v) => {
        const delta = byVoice.get(v.id)
        if (delta === undefined) return v
        // Legacy whole-voice form: swap the recorded side in. Point form: rebuild the point list.
        if (!isPointsDelta(delta)) return side === 'before' ? delta.before : delta.after
        return { ...v, points: applyPointsDeltaSide(v.points, delta.points, side) }
      }),
    }
  }

  /** UG3.2 (req 7/8): forget history WITHOUT touching the current state. 'all' clears everything;
   *  'before' drops the steps OLDER than cursor position `cursorPos` (bounded by the current cursor
   *  — applied steps only); 'redo-tail' drops the undone steps past the cursor (req 8: after a
   *  rollback the user may discard the rolled-back future). */
  public clearHistory(mode: 'all' | 'before' | 'redo-tail', cursorPos = 0): void {
    if (mode === 'all') {
      // UG3.2c: the saved position survives only if it IS the current position (both become 0).
      this.savedCursor = this.savedCursor === this.history.cursor ? 0 : -1
      this.history.steps.length = 0
      this.history.cursor = 0
    } else if (mode === 'before') {
      const k = Math.max(0, Math.min(Math.floor(cursorPos), this.history.cursor))
      this.history.steps.splice(0, k)
      this.history.cursor -= k
      this.savedCursor = this.savedCursor >= k ? this.savedCursor - k : -1
    } else {
      if (this.savedCursor > this.history.cursor) this.savedCursor = -1
      this.history.steps.length = this.history.cursor
    }
  }

  // --- Undo journal persistence (project-store PR2.2, PR-D8) -----------------

  /** Bounded export of the action log for the project's undo.json (v2). Keeps up to `maxEntries` undo
   *  steps (before the cursor) and `maxEntries` redo steps (after it); the exported cursor is the
   *  number of kept undo steps. */
  public exportUndoJournal(maxEntries = 50): GTrackUndoJournal {
    const perfStart = perfNow()
    const undoKeep = Math.min(this.history.cursor, maxEntries)
    const redoKeep = Math.min(this.history.steps.length - this.history.cursor, maxEntries)
    const start = this.history.cursor - undoKeep
    // UG3.2c: publish the saved state's position when it falls inside the exported window, so a
    // restart can adopt through the saved file even if this session ends with unsaved edits.
    const baseCursor = this.savedCursor - start
    const baseInWindow = this.savedCursor >= 0 && baseCursor >= 0 && baseCursor <= undoKeep + redoKeep
    const journal: GTrackUndoJournal = {
      version: 3,
      currentSig: signature(this.current, 'exportUndoJournal'),
      ...(baseInWindow ? { baseSig: this.savedSig, baseCursor } : {}),
      cursor: undoKeep,
      steps: this.history.steps.slice(start, this.history.cursor + redoKeep),
    }
    perfLogVerbose('exportUndoJournal', perfStart, { steps: journal.steps.length })
    return journal
  }

  /** Adopt a persisted journal — only a v3 journal (UC-D5/UG-D3: v1 snapshot and v2 metadata-less
   *  journals are rejected -> discarded) that chains to the CURRENT state (same signature), i.e. the
   *  file content matches what the journal was exported against. Returns false (no-op) otherwise.
   *  UG1.1 (undo-global-journal): a refusal is no longer silent — the console gets the reason, so the
   *  owner's repro shows WHY a rebuilt model lost its history (version vs signature divergence). */
  public adoptUndoJournal(journal: GTrackUndoJournal): boolean {
    if (this.txnBefore !== null) return false
    if (journal.version !== 3) {
      console.warn(`[undo-diag] adopt refused: journal version ${journal.version} (want 3; older journals are discarded per UG-D3)`)
      return false
    }
    const sig = signature(this.current, 'adoptUndoJournal')
    if (journal.currentSig === sig) {
      this.history.steps.length = 0
      this.history.steps.push(...journal.steps.map(normalizeStepPointIds))
      this.history.cursor = Math.max(0, Math.min(journal.cursor, this.history.steps.length))
      this.savedCursor = this.history.cursor // adoption happens on a freshly-built (saved) model
      return true
    }
    // UG3.2c (req 4): the exported state was never saved (the session ended with unsaved edits), but
    // the log still chains through the SAVED state — adopt onto it. Steps below baseCursor stay
    // undoable; the lost unsaved tail becomes the REDO tail (Ctrl+Y re-applies it).
    if (typeof journal.baseSig === 'string' && typeof journal.baseCursor === 'number' && journal.baseSig === sig) {
      this.history.steps.length = 0
      this.history.steps.push(...journal.steps.map(normalizeStepPointIds))
      this.history.cursor = Math.max(0, Math.min(journal.baseCursor, this.history.steps.length))
      this.savedCursor = this.history.cursor
      console.info(
        `[undo-diag] journal adopted via the saved base: cursor ${this.history.cursor}/${this.history.steps.length}`
        + ' — the unsaved tail from the previous session is redoable',
      )
      return true
    }
    let i = 0
    const js = journal.currentSig
    while (i < js.length && i < sig.length && js[i] === sig[i]) i += 1
    console.warn(
      `[undo-diag] adopt refused: signature mismatch (journal ${js.length} ch, model ${sig.length} ch, first diff at ${i}: `
      + `…${js.slice(Math.max(0, i - 60), i + 60)}… vs …${sig.slice(Math.max(0, i - 60), i + 60)}…)`,
    )
    return false
  }

  // --- Save bookkeeping -----------------------------------------------------

  /** Mark the current state as the saved baseline (clears the dirty flag). */
  public markSaved(): void {
    this.savedSig = signature(this.current, 'markSaved')
    this.savedCursor = this.history.cursor // UG3.2c: the saved state now lives at this position
    this.dirtyFlag = false
  }

  /** The current schedule serialized back to the dumped shape (for the XML patcher / verification). */
  public toSchedule(): GnauralScheduleData {
    return editableToSchedule(this.current)
  }

  /** BM-D2: the snapshot-payload serialization — same shape plus the optional point-id fields, so
   *  an adoption from this snapshot continues the SAME point identities across a restart. */
  public toScheduleWithIds(): GnauralScheduleData {
    const perfStart = perfNow()
    const result = editableToSchedule(this.current, true)
    perfLogVerbose('toScheduleWithIds', perfStart, scheduleSize(this.current))
    return result
  }

  /** BM-D2/BM1.3: positionally copy point ids from a previous model's schedule after a rebuild
   *  that carried the history over (the post-save rebase: same structure, float-drift values).
   *  Voices/points are matched by voice id + position; a count mismatch leaves the voice alone.
   *  Pure bookkeeping — ids are signature-invisible. */
  public adoptPointIdsFrom(previous: GTrackSchedule): void {
    if (this.txnBefore !== null) return
    const perfStart = perfNow()
    const prevById = new Map(previous.voices.map((v) => [v.id, v]))
    this.current = {
      ...this.current,
      voices: this.current.voices.map((v) => {
        const ref = prevById.get(v.id)
        if (ref === undefined || ref.points.length !== v.points.length) return v
        let changed = false
        const points = v.points.map((p, i) => {
          const id = ref.points[i]!.id
          if (typeof id !== 'string' || id === '' || id === p.id) return p
          changed = true
          return { ...p, id }
        })
        return changed ? { ...v, points } : v
      }),
    }
    perfLogVerbose('adoptPointIdsFrom', perfStart, scheduleSize(this.current))
  }

  /** BM-D2/BM1.3: adopt the point ids carried by an id-annotated reference schedule (the adoption
   *  anchor snapshot). The model was built from the FILE (fresh ids); the log's deltas reference
   *  the anchor's ids — rebasing aligns the id spaces so point-form deltas apply exactly. Gated on
   *  content equality (same signature); positional, pure bookkeeping: no history step, no dirty
   *  change. Returns false when the reference does not match or carries no ids. */
  public rebasePointIds(reference: GnauralScheduleData): boolean {
    if (this.txnBefore !== null) return false
    const perfStart = perfNow()
    const preparseIds = this.current.voices.filter((v) => v.preparse).map((v) => v.id)
    if (scheduleContentSignature(reference, preparseIds) !== signature(this.current, 'rebasePointIds')) {
      perfLogVerbose('rebasePointIds (sig mismatch)', perfStart, scheduleSize(this.current))
      return false
    }

    const refById = new Map(reference.voices.map((v) => [v.id, v]))
    let rebased = false
    const voices = this.current.voices.map((v) => {
      const ref = refById.get(v.id)
      if (ref === undefined || ref.entries.length === 0) return v
      const refIds: (string | undefined)[] = ref.entries.map((e) => e.pointId)
      refIds.push(ref.entries[ref.entries.length - 1]!.endPointId)
      if (refIds.length !== v.points.length || refIds.every((id) => id === undefined)) return v
      let voiceChanged = false
      const points = v.points.map((p, i) => {
        const id = refIds[i]
        if (id === undefined || id === p.id) return p
        voiceChanged = true
        return { ...p, id }
      })
      if (!voiceChanged) return v
      rebased = true
      return { ...v, points }
    })
    if (rebased) {
      this.current = { ...this.current, voices }
    }
    perfLogVerbose('rebasePointIds', perfStart, { ...scheduleSize(this.current), rebased: String(rebased) })
    return true
  }
}

/** BM1.3: normalize a log snapshot's schedule payload. Save/baseline snapshots store the dumped
 *  shape (voices with `entries`); old periodic snapshots (pre-BM) stored the EDITABLE shape
 *  (voices with `points`) — the model constructor only accepts the former, so checkout through
 *  such an anchor used to fail silently. Returns null for anything else. */
export function normalizeScheduleData(input: unknown): GnauralScheduleData | null {
  if (input === null || typeof input !== 'object') return null
  const voices = (input as { voices?: unknown }).voices
  if (!Array.isArray(voices)) return null
  if (voices.every((v) => Array.isArray((v as GnauralScheduleVoice).entries))) {
    return input as GnauralScheduleData
  }
  if (voices.every((v) => Array.isArray((v as GTrackVoice).points))) {
    return editableToSchedule(input as GTrackSchedule)
  }
  return null
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
