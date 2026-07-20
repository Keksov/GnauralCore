// undo-versioned-log VL4.1: pure planning helpers for the undo-log transport. The debounced
// queue itself lives in use-project.ts (a module singleton wired to unload flushes) — everything
// with actual logic sits here, importable by bun test without Vue or fetch (VL-D7).
import type { ProjectUndoLogAppendResponse, ProjectUndoLogCommitInput } from '@protocol'

/** Refs patch shape shared by the queue and the API (mirrors ProjectUndoLogRefsRequest sans id). */
export interface UndoLogRefsPatch {
  main?: string | null
  head?: string | null
  tags?: Record<string, string | null>
}

/** Browsers refuse keepalive bodies over ~64 KB (UC-D4) — leave headroom for the envelope. */
export const UNDO_LOG_KEEPALIVE_MAX_BYTES = 60_000

const encoder = new TextEncoder()

/** The longest batch PREFIX whose JSON body still fits a keepalive fetch. Snapshot commits are
 *  typically what overflows: the prefix stops before one, its tail is lost on exit — still
 *  strictly better than the whole-body refusal losing everything (and snapshots are written
 *  eagerly outside the debounce anyway, so a flush batch is normally deltas-only). */
export function planKeepaliveUndoLogBatch(
  commits: readonly ProjectUndoLogCommitInput[],
  maxBytes = UNDO_LOG_KEEPALIVE_MAX_BYTES,
): ProjectUndoLogCommitInput[] {
  const prefix: ProjectUndoLogCommitInput[] = []
  let bytes = 200 // envelope allowance: {"id":"…","advanceMain":true,"commits":[…]}

  for (const commit of commits) {
    bytes += encoder.encode(JSON.stringify(commit)).length + 1
    if (bytes > maxBytes) {
      break
    }
    prefix.push(commit)
  }

  return prefix
}

/** Last-write-wins per ref, tag patches merge key-wise — the debounce coalescing rule. */
export function mergeUndoLogRefsPatch(prev: UndoLogRefsPatch, next: UndoLogRefsPatch): UndoLogRefsPatch {
  const merged: UndoLogRefsPatch = {}
  if (next.main !== undefined) {
    merged.main = next.main
  } else if (prev.main !== undefined) {
    merged.main = prev.main
  }
  if (next.head !== undefined) {
    merged.head = next.head
  } else if (prev.head !== undefined) {
    merged.head = prev.head
  }
  if (prev.tags !== undefined || next.tags !== undefined) {
    merged.tags = { ...(prev.tags ?? {}), ...(next.tags ?? {}) }
  }
  return merged
}

/** Drop the acknowledged prefix (appended + skipped, S2/S3) of a sent batch from the pending
 *  queue. `pending` is `sent` plus anything queued while the request was in flight, so the
 *  acknowledged count indexes straight into it. A 409 leaves the rejected tail in place — the
 *  caller must resync against the server chain before retrying. */
export function dropAcknowledgedUndoLogCommits(
  pending: readonly ProjectUndoLogCommitInput[],
  result: Pick<ProjectUndoLogAppendResponse, 'appended' | 'skipped'>,
): ProjectUndoLogCommitInput[] {
  return pending.slice(result.appended + result.skipped)
}
