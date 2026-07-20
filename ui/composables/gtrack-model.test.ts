import { describe, expect, test } from 'bun:test'

import type { GnauralScheduleData, GnauralScheduleEntry } from '@protocol'

import {
  GTrackModel,
  clampPointTime,
  createGTrackHistory,
  editableToSchedule,
  pointBalance,
  pointBeatFreq,
  pointVolume,
  pointsToSegments,
  scheduleContentSignature,
  segmentsToPoints,
  type GTrackPoint,
} from './gtrack-model'

function entry(startSec: number, endSec: number, over: Partial<GnauralScheduleEntry> = {}): GnauralScheduleEntry {
  return {
    startSec,
    endSec,
    durationSec: endSec - startSec,
    baseFreqStart: 200,
    baseFreqEnd: 200,
    beatFreqHalfStart: 5,
    beatFreqHalfEnd: 5,
    volLStart: 1,
    volLEnd: 1,
    volRStart: 1,
    volREnd: 1,
    ...over,
  }
}

function fixture(entries: GnauralScheduleEntry[]): GnauralScheduleData {
  return {
    title: 'T',
    author: 'A',
    description: 'D',
    totalTimeSec: entries.length > 0 ? entries[entries.length - 1]!.endSec : 0,
    loopCount: 1,
    overallVolL: 1,
    overallVolR: 1,
    stereoSwap: false,
    voiceCount: 1,
    voices: [
      {
        id: 7,
        type: 'tone',
        typeIndex: 0,
        description: 'voice',
        hidden: false,
        muted: false,
        mono: false,
        color: '#abcdef',
        audioFilePath: '',
        totalDurationSec: entries.length > 0 ? entries[entries.length - 1]!.endSec : 0,
        entryCount: entries.length,
        entries,
      },
    ],
  }
}

describe('gtrack segments<->points (GT1.1)', () => {
  test('N segments -> N+1 points (boundaries)', () => {
    const points = segmentsToPoints([
      entry(0, 10, { baseFreqStart: 100, baseFreqEnd: 200 }),
      entry(10, 20, { baseFreqStart: 200, baseFreqEnd: 300 }),
    ])
    expect(points.length).toBe(3)
    expect(points.map((p) => p.timeSec)).toEqual([0, 10, 20])
    expect(points.map((p) => p.baseFreq)).toEqual([100, 200, 300])
  })

  test('empty schedule -> no points', () => {
    expect(segmentsToPoints([])).toEqual([])
  })

  test('round-trips segments -> points -> segments on continuous input', () => {
    const segs = [
      entry(0, 10, { baseFreqStart: 100, baseFreqEnd: 200, volLStart: 0.5, volLEnd: 0.8 }),
      entry(10, 25, { baseFreqStart: 200, baseFreqEnd: 150, volLStart: 0.8, volLEnd: 0.2 }),
    ]
    expect(pointsToSegments(segmentsToPoints(segs))).toEqual(segs)
  })
})

describe('gtrack derived axes (GT-D6)', () => {
  const p: GTrackPoint = { timeSec: 0, baseFreq: 200, beatFreqHalf: 5, volL: 0.25, volR: 0.75 }
  test('beat = 2*half, volume = mean, balance from L/R', () => {
    expect(pointBeatFreq(p)).toBe(10)
    expect(pointVolume(p)).toBeCloseTo(0.5, 9)
    expect(pointBalance(p)).toBeCloseTo(0.5, 9) // right-heavy
    expect(pointBalance({ ...p, volL: 1, volR: 1 })).toBe(0) // centred
    expect(pointBalance({ ...p, volL: 0, volR: 0 })).toBe(0) // guard /0
    expect(pointBalance({ ...p, volL: 1, volR: 0 })).toBe(-1) // full left
  })
})

describe('gtrack model construction + serialization', () => {
  test('constructor builds points; toSchedule() round-trips the dump shape', () => {
    const data = fixture([
      entry(0, 10, { baseFreqStart: 100, baseFreqEnd: 200 }),
      entry(10, 20, { baseFreqStart: 200, baseFreqEnd: 300 }),
    ])
    const model = new GTrackModel(data)
    expect(model.schedule.voices[0]!.points.length).toBe(3)
    const back = model.toSchedule()
    expect(back.voices[0]!.entries).toEqual(data.voices[0]!.entries)
    expect(back.voiceCount).toBe(1)
    expect(back.voices[0]!.entryCount).toBe(2)
  })

  test('editableToSchedule preserves voice metadata', () => {
    const data = fixture([entry(0, 5)])
    const out = editableToSchedule(new GTrackModel(data).schedule)
    expect(out.voices[0]!.color).toBe('#abcdef')
    expect(out.voices[0]!.mono).toBe(false)
    expect(out.voices[0]!.totalDurationSec).toBe(5)
  })
})

describe('gtrack model mutations require a transaction', () => {
  test('mutating outside a transaction throws', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    expect(() => model.setPointField(7, 0, 'baseFreq', 123)).toThrow(/transaction/)
  })

  test('edit() wraps begin/commit and applies the change', () => {
    const model = new GTrackModel(fixture([entry(0, 10, { baseFreqStart: 100 })]))
    model.edit(() => model.setPointField(7, 0, 'baseFreq', 440))
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(440)
    expect(model.canUndo).toBe(true)
  })

  test('edit() rolls back on a thrown mutator', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    const before = model.schedule
    expect(() => model.edit(() => { throw new Error('boom') })).toThrow('boom')
    expect(model.schedule).toBe(before)
    expect(model.inTransaction).toBe(false)
  })

  test('each change yields a new top-level reference (for reactivity)', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    const before = model.schedule
    model.edit(() => model.setPointField(7, 0, 'volL', 0.3))
    expect(model.schedule).not.toBe(before)
  })
})

describe('gtrack model setPointFields + movePoint clamping', () => {
  test('setPointFields patches multiple fields; rejects non-finite', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    model.edit(() => model.setPointFields(7, 0, { baseFreq: 300, volR: 0.4 }))
    const p = model.schedule.voices[0]!.points[0]!
    expect(p.baseFreq).toBe(300)
    expect(p.volR).toBe(0.4)
    expect(() => model.edit(() => model.setPointFields(7, 0, { volL: Number.NaN }))).toThrow(/non-finite/)
  })

  test('movePoint clamps time between neighbours and returns applied time', () => {
    const model = new GTrackModel(fixture([
      entry(0, 10),
      entry(10, 20),
    ]))
    // points at t=0,10,20. Move the middle point.
    let applied = 0
    model.edit(() => { applied = model.movePoint(7, 1, 999) })
    expect(applied).toBe(20) // clamped to next neighbour
    expect(model.schedule.voices[0]!.points[1]!.timeSec).toBe(20)
    model.edit(() => { applied = model.movePoint(7, 1, -5) })
    expect(applied).toBe(0) // clamped to previous neighbour (now at t=0)
  })

  test('movePoint can set a value field simultaneously', () => {
    const model = new GTrackModel(fixture([entry(0, 10), entry(10, 20)]))
    model.edit(() => model.movePoint(7, 1, 12, 'baseFreq', 250))
    const p = model.schedule.voices[0]!.points[1]!
    expect(p.timeSec).toBe(12)
    expect(p.baseFreq).toBe(250)
  })

  test('out-of-range point index throws', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    expect(() => model.edit(() => model.setPointField(7, 9, 'baseFreq', 1))).toThrow(/out of range/)
  })
})

describe('gtrack model undo/redo', () => {
  test('undo/redo restore state; redo cleared by a new edit', () => {
    const model = new GTrackModel(fixture([entry(0, 10, { baseFreqStart: 100 })]))
    model.edit(() => model.setPointField(7, 0, 'baseFreq', 200))
    model.edit(() => model.setPointField(7, 0, 'baseFreq', 300))
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(300)

    expect(model.undo()).toBe(true)
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(200)
    expect(model.canRedo).toBe(true)

    expect(model.redo()).toBe(true)
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(300)

    model.undo()
    model.edit(() => model.setPointField(7, 0, 'baseFreq', 999)) // new edit clears redo
    expect(model.canRedo).toBe(false)
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(999)
  })

  test('undo on empty history returns false', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    expect(model.undo()).toBe(false)
    expect(model.redo()).toBe(false)
  })

  test('a no-op transaction leaves no undo entry', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    model.edit(() => { /* touch nothing */ })
    expect(model.canUndo).toBe(false)
  })

  test('cancelEdit restores the pre-transaction state', () => {
    const model = new GTrackModel(fixture([entry(0, 10, { baseFreqStart: 100 })]))
    model.beginEdit()
    model.setPointField(7, 0, 'baseFreq', 500)
    model.cancelEdit()
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(100)
    expect(model.inTransaction).toBe(false)
  })
})

describe('gtrack model dirty tracking', () => {
  test('dirty toggles with edits; undo back to saved clears it; markSaved resets baseline', () => {
    const model = new GTrackModel(fixture([entry(0, 10, { baseFreqStart: 100 })]))
    expect(model.isDirty).toBe(false)

    model.edit(() => model.setPointField(7, 0, 'baseFreq', 200))
    expect(model.isDirty).toBe(true)

    model.undo() // back to the loaded (saved) state
    expect(model.isDirty).toBe(false)

    model.redo()
    expect(model.isDirty).toBe(true)

    model.markSaved()
    expect(model.isDirty).toBe(false)

    model.undo() // now undoing goes to a state different from the new baseline
    expect(model.isDirty).toBe(true)
  })
})

describe('gtrack model insert/remove points (GT1.3 / GT-D8)', () => {
  test('insertPoint adds an interpolated point strictly inside a segment', () => {
    const model = new GTrackModel(fixture([
      entry(0, 10, { baseFreqStart: 100, baseFreqEnd: 200, volLStart: 0, volLEnd: 1, volRStart: 0, volREnd: 1 }),
    ]))
    // points at t=0 (base100,vol0) and t=10 (base200,vol1).
    let idx = -1
    model.edit(() => { idx = model.insertPoint(7, 5) })
    expect(idx).toBe(1)
    const pts = model.schedule.voices[0]!.points
    expect(pts.length).toBe(3)
    expect(pts[1]!.timeSec).toBe(5)
    expect(pts[1]!.baseFreq).toBeCloseTo(150, 9) // halfway
    expect(pts[1]!.volL).toBeCloseTo(0.5, 9)
  })

  test('insertPoint rejects a time not strictly inside a segment', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    expect(() => model.edit(() => model.insertPoint(7, 0))).toThrow(/strictly inside/) // on a boundary
    expect(() => model.edit(() => model.insertPoint(7, 99))).toThrow(/strictly inside/) // outside
  })

  test('removePoint deletes a vertex; GT10.33 allows emptying the voice entirely', () => {
    const model = new GTrackModel(fixture([entry(0, 10), entry(10, 20)])) // 3 points
    model.edit(() => model.removePoint(7, 1))
    expect(model.schedule.voices[0]!.points.map((p) => p.timeSec)).toEqual([0, 20])
    // GT10.33 (owner 2026-07-12): no min-2 floor — a voice may be emptied (Undo is the safety net).
    model.edit(() => model.removePoint(7, 0))
    model.edit(() => model.removePoint(7, 0))
    expect(model.schedule.voices[0]!.points).toEqual([])
    // out-of-range still throws
    expect(() => model.edit(() => model.removePoint(7, 0))).toThrow(/out of range/)
  })

  test('insert then remove round-trips via undo', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    model.edit(() => model.insertPoint(7, 5))
    expect(model.schedule.voices[0]!.points.length).toBe(3)
    model.undo()
    expect(model.schedule.voices[0]!.points.length).toBe(2)
  })
})

describe('gtrack model preparse flag + fix (GT1.3 / GT-D9)', () => {
  test('constructor marks preparse voices; editing them is locked', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]), [7])
    expect(model.schedule.voices[0]!.preparse).toBe(true)
    expect(model.isVoiceEditable(7)).toBe(false)
    expect(() => model.edit(() => model.setPointField(7, 0, 'baseFreq', 1))).toThrow(/preparse-locked/)
    expect(() => model.edit(() => model.insertPoint(7, 5))).toThrow(/preparse-locked/)
    expect(() => model.edit(() => model.movePoint(7, 0, 1))).toThrow(/preparse-locked/)
  })

  test('non-preparse voices are editable by default', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    expect(model.schedule.voices[0]!.preparse).toBe(false)
    expect(model.isVoiceEditable(7)).toBe(true)
  })

  test('fixPreparseVoice unlocks editing, marks dirty, and is undoable', () => {
    const model = new GTrackModel(fixture([entry(0, 10, { baseFreqStart: 100 })]), [7])
    expect(model.isDirty).toBe(false)
    model.fixPreparseVoice(7)
    expect(model.schedule.voices[0]!.preparse).toBe(false)
    expect(model.isVoiceEditable(7)).toBe(true)
    expect(model.isDirty).toBe(true)
    // now editable
    model.edit(() => model.setPointField(7, 0, 'baseFreq', 222))
    expect(model.schedule.voices[0]!.points[0]!.baseFreq).toBe(222)
    // undo the edit, then undo the fix -> locked again
    model.undo()
    model.undo()
    expect(model.schedule.voices[0]!.preparse).toBe(true)
    expect(model.isDirty).toBe(false)
  })

  test('fixPreparseVoice is a no-op on an already-editable voice', () => {
    const model = new GTrackModel(fixture([entry(0, 10)]))
    model.fixPreparseVoice(7)
    expect(model.canUndo).toBe(false)
  })
})

describe('gtrack model movePointCrossing (GT3.10 / GT-D16 crossover)', () => {
  function threePointModel(): GTrackModel {
    return new GTrackModel(fixture([
      entry(0, 10, { baseFreqStart: 100, baseFreqEnd: 200 }),
      entry(10, 20, { baseFreqStart: 200, baseFreqEnd: 300 }),
    ])) // points at t=0 (100), t=10 (200), t=20 (300)
  }

  test('crossing the next neighbour re-homes the point and returns its new index', () => {
    const model = threePointModel()
    let ni = -1
    model.edit(() => { ni = model.movePointCrossing(7, 1, 25) })
    expect(ni).toBe(2)
    const pts = model.schedule.voices[0]!.points
    expect(pts.map((p) => p.timeSec)).toEqual([0, 20, 25])
    expect(pts[2]!.baseFreq).toBe(200) // the moved point kept its values
  })

  test('crossing backwards past the previous neighbour works too', () => {
    const model = threePointModel()
    let ni = -1
    model.edit(() => { ni = model.movePointCrossing(7, 2, 5) })
    expect(ni).toBe(1)
    expect(model.schedule.voices[0]!.points.map((p) => p.timeSec)).toEqual([0, 5, 10])
  })

  test('time floors at 0; a whole drag is ONE undo unit', () => {
    const model = threePointModel()
    model.edit(() => {
      model.movePointCrossing(7, 1, 25) // cross forward
      model.movePointCrossing(7, 2, -5) // and back past everything (floored to 0)
    })
    expect(model.schedule.voices[0]!.points.map((p) => p.timeSec)).toEqual([0, 0, 20])
    model.undo()
    expect(model.schedule.voices[0]!.points.map((p) => p.timeSec)).toEqual([0, 10, 20])
    expect(model.canUndo).toBe(false) // one unit
  })

  test('can update a value field while crossing', () => {
    const model = threePointModel()
    model.edit(() => model.movePointCrossing(7, 0, 15, 'baseFreq', 999))
    const pts = model.schedule.voices[0]!.points
    expect(pts.map((p) => p.timeSec)).toEqual([10, 15, 20])
    expect(pts[1]!.baseFreq).toBe(999)
  })
})

describe('gtrack cross-graph synchronicity invariant (GT-D16, owner req. 17/19)', () => {
  test('every "lane view" of a voice sees the same points (single source)', () => {
    const model = new GTrackModel(fixture([entry(0, 10), entry(10, 20)]))
    // Two independent lookups (as two lanes resolving the same voice id do):
    const laneA = model.schedule.voices.find((v) => v.id === 7)!
    const laneB = model.schedule.voices.find((v) => v.id === 7)!
    expect(laneA).toBe(laneB) // same object — a move/delete in one graph IS in the other

    model.edit(() => model.movePoint(7, 1, 12))
    const afterA = model.schedule.voices.find((v) => v.id === 7)!
    const afterB = model.schedule.voices.find((v) => v.id === 7)!
    expect(afterA.points).toBe(afterB.points)
    expect(afterA.points[1]!.timeSec).toBe(12)

    model.edit(() => model.removePoint(7, 1))
    expect(model.schedule.voices.find((v) => v.id === 7)!.points.length).toBe(2)
  })
})

describe('clampPointTime (standalone, GT3.2 reuse)', () => {
  const pts: GTrackPoint[] = [
    { timeSec: 0, baseFreq: 0, beatFreqHalf: 0, volL: 0, volR: 0 },
    { timeSec: 10, baseFreq: 0, beatFreqHalf: 0, volL: 0, volR: 0 },
    { timeSec: 20, baseFreq: 0, beatFreqHalf: 0, volL: 0, volR: 0 },
  ]
  test('endpoints bounded by one neighbour; middle by both', () => {
    expect(clampPointTime(pts, 0, -5)).toBe(-5) // first point: no lower bound
    expect(clampPointTime(pts, 0, 15)).toBe(10) // cannot pass the next
    expect(clampPointTime(pts, 2, 999)).toBe(999) // last point: no upper bound
    expect(clampPointTime(pts, 1, 3)).toBe(3)
    expect(clampPointTime(pts, 1, 999)).toBe(20)
  })
})

describe('undo journal export/adopt v2 (undo-command-log)', () => {
  function editedModel(): GTrackModel {
    const model = new GTrackModel(fixture([entry(0, 10), entry(10, 20)]))
    model.edit(() => model.movePoint(7, 1, 12))
    model.edit(() => model.movePoint(7, 1, 14))
    return model
  }

  test('journal round-trips onto an identical model and restores undo/redo', () => {
    const source = editedModel()
    source.undo() // move the cursor back one (one redo now available)
    const journal = source.exportUndoJournal()
    expect(journal.version).toBe(2)
    expect(journal.steps.length).toBe(2) // both steps kept
    expect(journal.cursor).toBe(1) // one of them is undone

    // A fresh model in the SAME state as the exported one (same edits, same undo position).
    const target = editedModel()
    target.undo()
    expect(target.adoptUndoJournal(journal)).toBe(true)
    expect(target.canUndo).toBe(true)
    expect(target.canRedo).toBe(true)
    expect(target.undo()).toBe(true)
    expect(JSON.stringify(target.schedule)).toBe(JSON.stringify(new GTrackModel(fixture([entry(0, 10), entry(10, 20)])).schedule))
  })

  test('a journal from a DIFFERENT state is rejected (no-op)', () => {
    const journal = editedModel().exportUndoJournal()
    const fresh = new GTrackModel(fixture([entry(0, 10), entry(10, 20)]))
    expect(fresh.adoptUndoJournal(journal)).toBe(false)
    expect(fresh.canUndo).toBe(false)
  })

  test('maxEntries bounds the exported steps (oldest dropped)', () => {
    const model = new GTrackModel(fixture([entry(0, 10), entry(10, 20)]))
    for (let i = 0; i < 10; i++) {
      model.edit(() => model.movePoint(7, 1, 10 + i * 0.5))
    }
    const journal = model.exportUndoJournal(3)
    expect(journal.steps.length).toBe(3)
    expect(journal.cursor).toBe(3) // all kept steps sit before the cursor (nothing redoable)
  })

  test('a step records only the edited voice, not the whole schedule (UC-D2)', () => {
    const base = fixture([entry(0, 10), entry(10, 20)])
    const v7 = base.voices[0]!
    const model = new GTrackModel({ ...base, voiceCount: 2, voices: [v7, { ...v7, id: 9, description: 'v9' }] })
    model.edit(() => model.movePoint(7, 1, 12)) // edit voice 7 only
    const journal = model.exportUndoJournal()
    expect(journal.steps.length).toBe(1)
    expect(journal.steps[0]!.voices.length).toBe(1) // only the changed voice, not both
    expect(journal.steps[0]!.voices[0]!.voiceId).toBe(7)
  })

  test('isGTrackUndoJournal accepts v2, rejects junk and v1 (UC-D5 migration)', async () => {
    const { isGTrackUndoJournal } = await import('./gtrack-model')
    const journal = editedModel().exportUndoJournal()
    expect(isGTrackUndoJournal(journal)).toBe(true)
    expect(isGTrackUndoJournal(JSON.parse(JSON.stringify(journal)))).toBe(true)
    expect(isGTrackUndoJournal(null)).toBe(false)
    // v1 snapshot journal: no `version` -> rejected -> discarded on load (UC-D5 migration).
    expect(isGTrackUndoJournal({ currentSig: 'x', undo: [], redo: [] })).toBe(false)
    expect(isGTrackUndoJournal({ version: 2, currentSig: 1, cursor: 0, steps: [] })).toBe(false)
    expect(isGTrackUndoJournal({ version: 2, currentSig: 'x', cursor: 0, steps: [{ voices: [{ voiceId: 'no' }] }] })).toBe(false)
  })
})

describe('external history container (undo-global-journal UG2.1, UG-D1)', () => {
  test('scheduleContentSignature matches a fresh model savedSignature/currentSignature', () => {
    const data = fixture([entry(0, 10), entry(10, 20)])
    const model = new GTrackModel(data, [])
    expect(scheduleContentSignature(data, [])).toBe(model.savedSignature)
    expect(model.currentSignature).toBe(model.savedSignature)
    model.edit(() => model.movePoint(7, 1, 12))
    expect(model.currentSignature).not.toBe(model.savedSignature)
    expect(model.savedSignature).toBe(scheduleContentSignature(data, [])) // base unchanged by edits
  })

  test('preparse ids участвуют в сигнатуре (preparse rebuild must not be skipped)', () => {
    const data = fixture([entry(0, 10)])
    expect(scheduleContentSignature(data, [7])).not.toBe(scheduleContentSignature(data, []))
  })

  test('a rebuilt model given the same container keeps undo/redo (post-save rebase)', () => {
    const data = fixture([entry(0, 10), entry(10, 20)])
    const history = createGTrackHistory()
    const m1 = new GTrackModel(data, [], history)
    m1.edit(() => m1.setPointField(7, 1, 'baseFreq', 250))
    expect(m1.canUndo).toBe(true)
    // The save round-trip rebuilds from the dump with the SAME container.
    const dump = editableToSchedule(m1.schedule)
    const m2 = new GTrackModel(dump, [], history)
    expect(m2.canUndo).toBe(true)
    expect(m2.isDirty).toBe(false) // the dump IS the new saved baseline
    expect(m2.undo()).toBe(true)
    expect(m2.schedule.voices[0]!.points[1]!.baseFreq).toBe(200)
    expect(m2.canRedo).toBe(true)
    expect(m2.redo()).toBe(true)
    expect(m2.schedule.voices[0]!.points[1]!.baseFreq).toBe(250)
  })

  test('without a container each model starts with an empty history (old behaviour)', () => {
    const data = fixture([entry(0, 10), entry(10, 20)])
    const m1 = new GTrackModel(data)
    m1.edit(() => m1.movePoint(7, 1, 12))
    const m2 = new GTrackModel(editableToSchedule(m1.schedule))
    expect(m2.canUndo).toBe(false)
  })

  test('constructor clamps a stale cursor in an adopted container', () => {
    const history = createGTrackHistory()
    history.cursor = 5 // corrupt: points past the (empty) step list
    const model = new GTrackModel(fixture([entry(0, 10)]), [], history)
    expect(model.canUndo).toBe(false)
    expect(model.canRedo).toBe(false)
  })
})
