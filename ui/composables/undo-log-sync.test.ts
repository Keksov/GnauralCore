// undo-versioned-log VL4.1: the pure transport-planning helpers (see undo-log-sync.ts).
import { describe, expect, test } from 'bun:test'

import type { ProjectUndoLogCommitInput } from '@protocol'
import {
  dropAcknowledgedUndoLogCommits,
  mergeUndoLogRefsPatch,
  planKeepaliveUndoLogBatch,
} from './undo-log-sync'

const delta = (cid: string, parent: string | null, size = 10): ProjectUndoLogCommitInput => {
  return { cid, parent, type: 'delta', atMs: 1, payload: { blob: 'x'.repeat(size) } }
}

describe('planKeepaliveUndoLogBatch', () => {
  test('returns everything when it fits', () => {
    const commits = [delta('a', null), delta('b', 'a'), delta('c', 'b')]
    expect(planKeepaliveUndoLogBatch(commits)).toEqual(commits)
  })

  test('stops the prefix before the commit that would overflow (a snapshot mid-batch)', () => {
    const commits = [delta('a', null, 50), delta('big', 'a', 5_000), delta('c', 'big', 50)]
    const prefix = planKeepaliveUndoLogBatch(commits, 1_000)
    // the oversized commit AND its dependants are cut — the prefix stays a valid chain
    expect(prefix.map((c) => c.cid)).toEqual(['a'])
  })

  test('an empty prefix when even the first commit does not fit', () => {
    expect(planKeepaliveUndoLogBatch([delta('huge', null, 100_000)], 1_000)).toEqual([])
  })

  test('unicode payloads are measured in utf-8 bytes, not code units', () => {
    const cyrillic = { cid: 'ю', parent: null, type: 'delta', atMs: 1, payload: { text: 'ю'.repeat(300) } } as const
    // 300 cyrillic chars = 600 utf-8 bytes; a 700-byte budget (minus the 200-byte envelope
    // allowance) must reject it even though the string LENGTH would fit.
    expect(planKeepaliveUndoLogBatch([cyrillic], 700)).toEqual([])
  })
})

describe('mergeUndoLogRefsPatch', () => {
  test('later refs win, absent fields fall through', () => {
    expect(mergeUndoLogRefsPatch({ main: 'a', head: 'b' }, { head: 'c' })).toEqual({ main: 'a', head: 'c' })
    expect(mergeUndoLogRefsPatch({}, { head: null })).toEqual({ head: null })
  })

  test('tag patches merge key-wise, deletions (null) survive the merge', () => {
    const merged = mergeUndoLogRefsPatch({ tags: { pin: 'a', wip: 'b' } }, { tags: { wip: null, v1: 'c' } })
    expect(merged).toEqual({ tags: { pin: 'a', wip: null, v1: 'c' } })
  })
})

describe('dropAcknowledgedUndoLogCommits', () => {
  test('removes the acknowledged prefix including skipped duplicates', () => {
    const pending = [delta('a', null), delta('b', 'a'), delta('c', 'b')]
    expect(dropAcknowledgedUndoLogCommits(pending, { appended: 1, skipped: 1 }).map((c) => c.cid)).toEqual(['c'])
  })

  test('commits queued while the request was in flight stay pending', () => {
    const sentPlusNew = [delta('a', null), delta('b', 'a'), delta('new', 'b')]
    expect(dropAcknowledgedUndoLogCommits(sentPlusNew, { appended: 2, skipped: 0 }).map((c) => c.cid)).toEqual(['new'])
  })

  test('a fully rejected batch keeps everything (the caller resyncs)', () => {
    const pending = [delta('x', 'ghost')]
    expect(dropAcknowledgedUndoLogCommits(pending, { appended: 0, skipped: 0 })).toEqual(pending)
  })
})
