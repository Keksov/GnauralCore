// undo-branch-merge BM2.1: the merge-planner spec M1..M5 (plus legacy/locked/ordering) as tests —
// req 8: full automated coverage, no owner in the loop.
import { describe, expect, test } from 'bun:test'

import type { GTrackPoint, GTrackSchedule, GTrackVoice } from './gtrack-model'
import {
  canMergeBranch,
  mergeConflictKey,
  planBranchMerge,
  resolveBranchMerge,
  type MergeChoice,
} from './undo-branch-merge'

const pt = (id: string, timeSec: number, baseFreq = 200): GTrackPoint => {
  return { id, timeSec, baseFreq, beatFreqHalf: 5, volL: 1, volR: 1 }
}

const voice = (id: number, points: GTrackPoint[], preparse = false): GTrackVoice => {
  return { id, type: 'tone', typeIndex: 0, description: `voice-${id}`, mono: false, color: null, audioFilePath: '', points, preparse }
}

const schedule = (...voices: GTrackVoice[]): GTrackSchedule => {
  return { title: 'T', author: '', description: '', totalTimeSec: 100, loopCount: 1, overallVolL: 1, overallVolR: 1, stereoSwap: false, voices }
}

const clone = (s: GTrackSchedule): GTrackSchedule => JSON.parse(JSON.stringify(s)) as GTrackSchedule

const choose = (entries: [string, MergeChoice][]): Map<string, MergeChoice> => new Map(entries)

describe('planBranchMerge (M1/M2: point-level three-way)', () => {
  const makeBase = (): GTrackSchedule => schedule(voice(7, [pt('a', 0), pt('b', 10), pt('c', 20)]))

  test('M1: disjoint changes merge silently — ours edit kept, branch edit + insert + delete applied', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points[1]!.baseFreq = 260 // ours edits b

    const theirs = clone(base)
    theirs.voices[0]!.points[2]!.baseFreq = 300 // branch edits c
    theirs.voices[0]!.points.splice(2, 0, pt('d', 15, 280)) // branch inserts d @15
    theirs.voices[0]!.points.splice(0, 1) // branch deletes a

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts).toEqual([])
    expect(plan.lockedVoiceIds).toEqual([])
    const result = resolveBranchMerge(ours, plan)
    expect(result.length).toBe(1)
    expect(result[0]!.points.map((p) => [p.id, p.timeSec, p.baseFreq])).toEqual([
      ['b', 10, 260], // ours' edit survives
      ['d', 15, 280], // branch insert joins at its time
      ['c', 20, 300], // branch edit applied; 'a' deleted by the branch
    ])
  })

  test('a voice the branch never touched is left out entirely (ours deletions stay)', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points.splice(0, 1) // ours deleted a
    const theirs = clone(base) // branch identical to base

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.voices).toEqual([])
    expect(resolveBranchMerge(ours, plan)).toEqual([])
  })

  test('M2: the same point changed differently on both sides is a conflict; choices apply exactly', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points[1]!.baseFreq = 260
    const theirs = clone(base)
    theirs.voices[0]!.points[1]!.baseFreq = 300

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts.length).toBe(1)
    const conflict = plan.conflicts[0]!
    expect(conflict.kind).toBe('point')
    expect(mergeConflictKey(conflict)).toBe('point:7:b')

    // Default (= «моя версия»): nothing changes at all.
    expect(resolveBranchMerge(ours, plan)).toEqual([])
    // «Из ветки»: b takes the branch value.
    const result = resolveBranchMerge(ours, plan, choose([['point:7:b', 'theirs']]))
    expect(result.length).toBe(1)
    expect(result[0]!.points.find((p) => p.id === 'b')!.baseFreq).toBe(300)
  })

  test('M2: both sides making the SAME change is not a conflict and not a change', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points[1]!.baseFreq = 300
    const theirs = clone(base)
    theirs.voices[0]!.points[1]!.baseFreq = 300

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts).toEqual([])
    expect(resolveBranchMerge(ours, plan)).toEqual([])
  })

  test('M2: ours edited vs branch deleted — a conflict; «из ветки» deletes, «моя» keeps the edit', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points[1]!.baseFreq = 260
    const theirs = clone(base)
    theirs.voices[0]!.points.splice(1, 1) // branch deletes b

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts.length).toBe(1)
    expect(resolveBranchMerge(ours, plan)).toEqual([]) // default keeps ours' edit
    const result = resolveBranchMerge(ours, plan, choose([['point:7:b', 'theirs']]))
    expect(result[0]!.points.map((p) => p.id)).toEqual(['a', 'c'])
  })

  test('mixed: one auto change + one conflict in the same voice compose correctly', () => {
    const base = makeBase()
    const ours = clone(base)
    ours.voices[0]!.points[1]!.baseFreq = 260 // ours edits b (conflict side 1)
    const theirs = clone(base)
    theirs.voices[0]!.points[1]!.baseFreq = 300 // branch edits b (conflict side 2)
    theirs.voices[0]!.points[2]!.baseFreq = 400 // branch edits c (auto)

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts.length).toBe(1)
    const defaulted = resolveBranchMerge(ours, plan)
    expect(defaulted[0]!.points.map((p) => p.baseFreq)).toEqual([200, 260, 400]) // c auto, b stays ours
    const taken = resolveBranchMerge(ours, plan, choose([['point:7:b', 'theirs']]))
    expect(taken[0]!.points.map((p) => p.baseFreq)).toEqual([200, 300, 400])
  })
})

describe('planBranchMerge (M4 legacy: no shared ids -> whole voice)', () => {
  test('ours untouched -> the branch voice is taken wholesale', () => {
    const base = schedule(voice(7, [pt('x1', 0), pt('x2', 10)]))
    const ours = clone(base)
    const theirs = schedule(voice(7, [pt('y1', 0), pt('y2', 10, 320)])) // fresh id space (legacy)

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts).toEqual([])
    const result = resolveBranchMerge(ours, plan)
    expect(result.length).toBe(1)
    expect(result[0]!.points.map((p) => p.baseFreq)).toEqual([200, 320])
  })

  test('both changed -> a voice-level conflict; «из ветки» swaps the whole point set', () => {
    const base = schedule(voice(7, [pt('x1', 0), pt('x2', 10)]))
    const ours = clone(base)
    ours.voices[0]!.points[0]!.baseFreq = 250
    const theirs = schedule(voice(7, [pt('y1', 0), pt('y2', 10, 320)]))

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.conflicts.length).toBe(1)
    expect(plan.conflicts[0]!.kind).toBe('voice')
    expect(mergeConflictKey(plan.conflicts[0]!)).toBe('voice:7')
    expect(resolveBranchMerge(ours, plan)).toEqual([]) // default keeps ours
    const result = resolveBranchMerge(ours, plan, choose([['voice:7', 'theirs']]))
    expect(result[0]!.points.map((p) => p.baseFreq)).toEqual([200, 320])
  })
})

describe('planBranchMerge (guards)', () => {
  test('a preparse-locked voice the branch changed is reported, never touched', () => {
    const base = schedule(voice(7, [pt('a', 0), pt('b', 10)], true))
    const ours = clone(base)
    const theirs = clone(base)
    theirs.voices[0]!.points[1]!.baseFreq = 300

    const plan = planBranchMerge(base, ours, theirs)
    expect(plan.lockedVoiceIds).toEqual([7])
    expect(plan.voices).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  test('M5 precondition: a graft-rooted branch (forkParent=null) cannot be merged', () => {
    expect(canMergeBranch({ forkParent: null })).toBe('no-base')
    expect(canMergeBranch({ forkParent: 'cid-1' })).toBe('ok')
  })
})
