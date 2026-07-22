// undo-branch-merge BM2.1 (BM-D5/BM-D8): the PURE three-way merge planner — base (the state at
// the branch's fork parent), ours (the live schedule), theirs (the branch tip state). Point-level
// by id where the id spaces genuinely overlap; whole-voice for legacy branches whose
// reconstruction minted fresh ids. Non-conflicting changes resolve silently; a point (or voice)
// changed differently on both sides goes to the owner's dialog (req 4 — «моя / из ветки»).
// No Vue, no fetch (BM-D8): everything here is bun-tested (M1..M5); the lanes layer only wires
// reconstruction and the one kind='merge' transaction around these plans.
import type { ProjectUndoLogBranch } from '@protocol'
import { pointFieldsEqual, type GTrackPoint, type GTrackSchedule } from './gtrack-model'

export interface MergePointConflict {
  readonly kind: 'point'
  readonly voiceId: number
  readonly voiceName: string
  readonly pointId: string
  /** null = the side deletes (or never had) the point. */
  readonly base: GTrackPoint | null
  readonly ours: GTrackPoint | null
  readonly theirs: GTrackPoint | null
}

export interface MergeVoiceConflict {
  readonly kind: 'voice'
  readonly voiceId: number
  readonly voiceName: string
  readonly oursPoints: readonly GTrackPoint[]
  readonly theirsPoints: readonly GTrackPoint[]
}

export type MergeConflict = MergePointConflict | MergeVoiceConflict

/** The dialog keys its choices («ours» | «theirs») by this. */
export const mergeConflictKey = (aConflict: MergeConflict): string => {
  return aConflict.kind === 'point'
    ? `point:${aConflict.voiceId}:${aConflict.pointId}`
    : `voice:${aConflict.voiceId}`
}

export interface MergeVoicePlan {
  readonly voiceId: number
  /** ours' points with the AUTO (non-conflicting) branch changes applied, time-sorted. */
  readonly autoPoints: readonly GTrackPoint[]
}

export interface BranchMergePlan {
  readonly voices: readonly MergeVoicePlan[]
  readonly conflicts: readonly MergeConflict[]
  /** preparse-locked voices the branch wanted to change — reported, never touched. */
  readonly lockedVoiceIds: readonly number[]
}

export type MergeChoice = 'ours' | 'theirs'

/** The lanes' reconstructed plan — handed to the conflict dialog and back into apply (BM2.2).
 *  oursSig pins the live state the plan was computed against (staleness guard). */
export interface PlannedBranchMerge {
  readonly tip: string
  readonly plan: BranchMergePlan
  readonly oursSig: string
}

/** M5 precondition: a graft-rooted branch has no fork parent — there is no base to merge from. */
export const canMergeBranch = (aBranch: Pick<ProjectUndoLogBranch, 'forkParent'>): 'ok' | 'no-base' => {
  return aBranch.forkParent === null ? 'no-base' : 'ok'
}

const contentEqual = (a: readonly GTrackPoint[], b: readonly GTrackPoint[]): boolean => {
  return a.length === b.length && a.every((p, i) => pointFieldsEqual(p, b[i]!))
}

const sideEqual = (a: GTrackPoint | null, b: GTrackPoint | null): boolean => {
  if (a === null || b === null) return a === b
  return pointFieldsEqual(a, b)
}

const byTime = (a: GTrackPoint, b: GTrackPoint): number => a.timeSec - b.timeSec

/** Three-way plan (BM-D5). Only voices the BRANCH actually changed vs base participate; per
 *  voice the granularity is point-level when base's ids survive in both ours and theirs (a
 *  shared lineage), whole-voice otherwise (M4 legacy). */
export function planBranchMerge(base: GTrackSchedule, ours: GTrackSchedule, theirs: GTrackSchedule): BranchMergePlan {
  const baseById = new Map(base.voices.map((v) => [v.id, v]))
  const theirsById = new Map(theirs.voices.map((v) => [v.id, v]))
  const voices: MergeVoicePlan[] = []
  const conflicts: MergeConflict[] = []
  const lockedVoiceIds: number[] = []

  for (const ov of ours.voices) {
    const bv = baseById.get(ov.id)
    const tv = theirsById.get(ov.id)
    if (bv === undefined || tv === undefined) continue // the voice set never changes (UC-D6)
    if (contentEqual(tv.points, bv.points)) continue // the branch did not touch this voice
    if (ov.preparse) {
      lockedVoiceIds.push(ov.id)
      continue
    }
    const voiceName = ov.description.trim() !== '' ? ov.description : `#${ov.id}`

    // Shared lineage check: base's ids must survive in BOTH sides, else the ids are synthetic
    // (a legacy reconstruction) and only whole-voice comparison is honest.
    const baseIds = new Set(bv.points.map((p) => p.id))
    const idsUsable =
      baseIds.size > 0 &&
      ov.points.some((p) => baseIds.has(p.id)) &&
      tv.points.some((p) => baseIds.has(p.id))

    if (!idsUsable) {
      // M4: whole-voice three-way.
      if (contentEqual(ov.points, bv.points)) {
        voices.push({ voiceId: ov.id, autoPoints: tv.points.map((p) => ({ ...p })) })
      } else if (!contentEqual(ov.points, tv.points)) {
        conflicts.push({ kind: 'voice', voiceId: ov.id, voiceName, oursPoints: ov.points, theirsPoints: tv.points })
        voices.push({ voiceId: ov.id, autoPoints: ov.points.map((p) => ({ ...p })) })
      }
      // both sides arrived at the same content -> nothing to do
      continue
    }

    // Point-level three-way by id.
    const baseP = new Map(bv.points.map((p) => [p.id, p]))
    const oursP = new Map(ov.points.map((p) => [p.id, p]))
    const theirsP = new Map(tv.points.map((p) => [p.id, p]))
    const allIds = new Set<string>([...baseP.keys(), ...oursP.keys(), ...theirsP.keys()])

    const working = new Map(oursP)
    let autoChanges = 0
    const voiceConflicts: MergePointConflict[] = []
    for (const id of allIds) {
      const b = baseP.get(id) ?? null
      const o = oursP.get(id) ?? null
      const t = theirsP.get(id) ?? null
      if (sideEqual(t, b)) continue // the branch did not touch this point
      if (sideEqual(o, b)) {
        // only the branch changed it — take theirs (update, insert or delete)
        if (t === null) working.delete(id)
        else working.set(id, { ...t })
        autoChanges += 1
        continue
      }
      if (sideEqual(o, t)) continue // both made the same change
      voiceConflicts.push({ kind: 'point', voiceId: ov.id, voiceName, pointId: id, base: b, ours: o, theirs: t })
    }
    if (autoChanges === 0 && voiceConflicts.length === 0) continue

    // Assemble: surviving points keep ours' relative order, branch inserts join by time.
    const merged: GTrackPoint[] = []
    for (const p of ov.points) {
      const w = working.get(p.id)
      if (w !== undefined) merged.push(w)
    }
    for (const [id, p] of working) {
      if (!oursP.has(id)) merged.push(p)
    }
    merged.sort(byTime)
    conflicts.push(...voiceConflicts)
    voices.push({ voiceId: ov.id, autoPoints: merged })
  }

  return { voices, conflicts, lockedVoiceIds }
}

/** Apply the owner's dialog choices over the plan. Returns the final per-voice point sets —
 *  ONLY for voices that actually differ from ours (ready for replaceVoicePoints); an empty
 *  result means the merge is a no-op. Missing choices default to «ours» (the safe side). */
export function resolveBranchMerge(
  ours: GTrackSchedule,
  plan: BranchMergePlan,
  choices: ReadonlyMap<string, MergeChoice> = new Map(),
): { voiceId: number; points: GTrackPoint[] }[] {
  const out: { voiceId: number; points: GTrackPoint[] }[] = []
  for (const v of plan.voices) {
    let points = v.autoPoints.map((p) => ({ ...p }))
    for (const c of plan.conflicts) {
      if (c.voiceId !== v.voiceId) continue
      const pick = choices.get(mergeConflictKey(c)) ?? 'ours'
      if (pick !== 'theirs') continue
      if (c.kind === 'voice') {
        points = c.theirsPoints.map((p) => ({ ...p }))
        continue
      }
      const at = points.findIndex((p) => p.id === c.pointId)
      if (c.theirs === null) {
        if (at >= 0) points.splice(at, 1)
      } else if (at >= 0) {
        points[at] = { ...c.theirs }
      } else {
        points.push({ ...c.theirs })
      }
    }
    points.sort(byTime)
    const ov = ours.voices.find((x) => x.id === v.voiceId)
    if (ov !== undefined && contentEqual(points, ov.points)) continue // resolved back to ours
    out.push({ voiceId: v.voiceId, points })
  }
  return out
}
