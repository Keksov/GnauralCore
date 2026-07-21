// undo-versioned-log VL4.2: chain <-> history-window mapping (see undo-log-adoption.ts).
import { describe, expect, test } from 'bun:test'

import type { ProjectUndoLogCommit } from '@protocol'
import type { GTrackUndoStep } from './gtrack-model'
import { commitToStep, planUndoLogAdoption, stepToCommitInput } from './undo-log-adoption'

const step = (id: string, atMs = 1): GTrackUndoStep => {
  return { id, kind: 'point-edit', label: 'voice', atMs, voices: [] }
}

let seq = 0
const deltaCommit = (cid: string, parent: string | null): ProjectUndoLogCommit => {
  seq += 1
  return { cid, parent, type: 'delta', atMs: seq, payload: { kind: 'point-edit', label: 'voice', voices: [] }, seq }
}

const snapshotCommit = (cid: string, parent: string | null, sig: string): ProjectUndoLogCommit => {
  seq += 1
  return { cid, parent, type: 'snapshot', atMs: seq, payload: { sig, schedule: { fake: true } }, seq }
}

describe('step <-> commit round-trip', () => {
  test('stepToCommitInput and commitToStep invert each other', () => {
    const s = step('abc', 42)
    const commit = { ...stepToCommitInput(s, 'p'), seq: 7 } as ProjectUndoLogCommit
    expect(commitToStep(commit)).toEqual(s)
  })

  test('foreign payloads map to null', () => {
    const bad = { cid: 'x', parent: null, type: 'delta', atMs: 1, payload: { nope: 1 }, seq: 1 } as ProjectUndoLogCommit
    expect(commitToStep(bad)).toBeNull()
    const meta = { cid: 'm', parent: null, type: 'meta', atMs: 1, payload: null, seq: 2 } as ProjectUndoLogCommit
    expect(commitToStep(meta)).toBeNull()
  })
})

describe('planUndoLogAdoption', () => {
  test('anchor mid-chain: deltas below become undo, deltas above become redo', () => {
    // oldest-first: S0(root) -> d1 -> d2 -> S1(saved) -> d3 (unsaved tail); head fetch is newest-first
    const chain = [
      snapshotCommit('s0', null, 'sig-old'),
      deltaCommit('d1', 's0'),
      deltaCommit('d2', 'd1'),
      snapshotCommit('s1', 'd2', 'sig-file'),
      deltaCommit('d3', 's1'),
    ].reverse()

    const plan = planUndoLogAdoption(chain, 'sig-file')
    expect(plan).not.toBeNull()
    expect(plan!.journal.cursor).toBe(2)
    expect(plan!.journal.steps.map((s) => s.id)).toEqual(['d1', 'd2', 'd3'])
    expect(plan!.anchorCid).toBe('s1')
    // positions: 0 -> s0 (override of the root position), 1 -> d1, 2 -> s1 (override over d2!), 3 -> d3
    expect(plan!.positionCids).toEqual(['s0', 'd1', 's1', 'd3'])
  })

  test('no matching snapshot -> null (external edit; the log stays)', () => {
    const chain = [snapshotCommit('s0', null, 'other'), deltaCommit('d1', 's0')].reverse()
    expect(planUndoLogAdoption(chain, 'sig-file')).toBeNull()
  })

  test('a graft/fetch boundary leaves position 0 with the parent cid of the oldest commit', () => {
    const chain = [deltaCommit('d5', 'cut-away'), snapshotCommit('s2', 'd5', 'sig-file')].reverse()
    const plan = planUndoLogAdoption(chain, 'sig-file')
    expect(plan!.positionCids).toEqual(['cut-away', 's2'])
    expect(plan!.journal.cursor).toBe(1)
  })

  test('a foreign delta payload refuses the adoption entirely', () => {
    const foreign = { cid: 'z', parent: null, type: 'delta', atMs: 1, payload: 42, seq: 90 } as ProjectUndoLogCommit
    const chain = [foreign, snapshotCommit('s1', 'z', 'sig-file')].reverse()
    expect(planUndoLogAdoption(chain, 'sig-file')).toBeNull()
  })

  test('a SIDE anchor (mid-history save) anchors the cursor at its parent position (VL5.2 round 2)', () => {
    // main line: S0 -> d1 -> d2 -> d3 (main=d3); the save happened at position 1, its snapshot
    // hangs off d1 and is only reachable via head.
    const mainChain = [
      snapshotCommit('s0', null, 'sig-old'),
      deltaCommit('d1', 's0'),
      deltaCommit('d2', 'd1'),
      deltaCommit('d3', 'd2'),
    ].reverse()
    const side = snapshotCommit('sMid', 'd1', 'sig-file')

    expect(planUndoLogAdoption(mainChain, 'sig-file')).toBeNull() // not on the main chain
    const plan = planUndoLogAdoption(mainChain, 'sig-file', [side, deltaCommit('d1', 's0')])
    expect(plan).not.toBeNull()
    expect(plan!.anchorCid).toBe('sMid')
    expect(plan!.journal.cursor).toBe(1)
    expect(plan!.journal.steps.map((s) => s.id)).toEqual(['d1', 'd2', 'd3']) // redo tail preserved
    // the side snapshot re-labels its position: a future delta after an undo chains onto it
    expect(plan!.positionCids).toEqual(['s0', 'sMid', 'd2', 'd3'])
  })

  test('a side snapshot whose parent is outside the window does not anchor', () => {
    const mainChain = [snapshotCommit('s0', null, 'sig-old'), deltaCommit('d1', 's0')].reverse()
    const stray = snapshotCommit('sX', 'elsewhere', 'sig-file')
    expect(planUndoLogAdoption(mainChain, 'sig-file', [stray])).toBeNull()
  })
})
