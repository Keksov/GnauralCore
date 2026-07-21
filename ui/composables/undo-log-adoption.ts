// undo-versioned-log VL4.2: pure mapping between the server commit chain and the in-memory
// GTrackHistory window. Everything with logic lives here (bun-testable, no Vue/fetch — VL-D7);
// the lanes singleton only wires these plans to the transport queue.
//
// Vocabulary: a POSITION is a state between steps (0..steps.length). positionCids[i] is the cid
// of the TOPMOST commit representing position i on the server chain — a delta advances the
// position, a snapshot/meta commit re-labels the current one (the state is unchanged, but the
// next child must chain onto the newer commit).
import type { ProjectUndoLogCommit, ProjectUndoLogCommitInput } from '@protocol'
import type { GTrackUndoJournal, GTrackUndoStep } from './gtrack-model'

export interface UndoLogDeltaPayload {
  readonly kind: string
  readonly label: string
  readonly voices: GTrackUndoStep['voices']
}

export interface UndoLogSnapshotPayload {
  readonly sig: string
  readonly schedule: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

/** A history step becomes a delta commit: envelope carries {cid=id, atMs}, payload the rest. */
export function stepToCommitInput(step: GTrackUndoStep, parent: string | null): ProjectUndoLogCommitInput {
  return {
    cid: step.id,
    parent,
    type: 'delta',
    atMs: step.atMs,
    payload: { kind: step.kind, label: step.label, voices: step.voices } satisfies UndoLogDeltaPayload,
  }
}

/** Best-effort inverse of stepToCommitInput; null when the payload is not a delta of ours. */
export function commitToStep(commit: ProjectUndoLogCommit): GTrackUndoStep | null {
  if (commit.type !== 'delta' || !isRecord(commit.payload)) {
    return null
  }
  const { kind, label, voices } = commit.payload
  if (typeof kind !== 'string' || typeof label !== 'string' || !Array.isArray(voices)) {
    return null
  }
  return { id: commit.cid, kind, label, atMs: commit.atMs, voices: voices as GTrackUndoStep['voices'] }
}

export function snapshotSig(commit: ProjectUndoLogCommit): string | null {
  if (commit.type !== 'snapshot' || !isRecord(commit.payload) || typeof commit.payload.sig !== 'string') {
    return null
  }
  return commit.payload.sig
}

export interface UndoLogAdoptionPlan {
  /** Synthetic v3 journal — model.adoptUndoJournal applies it with its usual signature gate. */
  readonly journal: GTrackUndoJournal
  /** length = journal.steps.length + 1; entries may be null below a graft/fetch boundary. */
  readonly positionCids: (string | null)[]
  readonly anchorCid: string
}

/** Map a fetched chain (newest-first, as GET returns it) onto a history window anchored at the
 *  snapshot whose sig matches the freshly-loaded file. Deltas below the anchor become undo
 *  steps, deltas above it (the unsaved tail of the previous session) become redo — the v3
 *  baseSig/baseCursor semantics generalized to the log.
 *
 *  A save at a MID-history position writes its snapshot as a SIDE commit off the line (VL5.2
 *  round 2: advancing main onto it would orphan the redo tail) — such an anchor is not on the
 *  main chain and arrives via `sideCommitsNewestFirst` (the head-chain fetch): it matches when
 *  its parent lies on the main window, and it anchors the cursor at that parent's position.
 *
 *  Returns null when no snapshot matches anywhere (external edit): the history window stays
 *  empty, the LOG stays intact (VL-D5). */
export function planUndoLogAdoption(
  commitsNewestFirst: readonly ProjectUndoLogCommit[],
  currentSig: string,
  sideCommitsNewestFirst: readonly ProjectUndoLogCommit[] = [],
): UndoLogAdoptionPlan | null {
  const onChainAnchor = commitsNewestFirst.find((commit) => snapshotSig(commit) === currentSig)

  const window = [...commitsNewestFirst].reverse() // oldest-first
  const steps: GTrackUndoStep[] = []
  const positionCids: (string | null)[] = [window[0]?.parent ?? null]
  const positionByCid = new Map<string, number>()
  let position = 0
  let cursor = -1

  for (const commit of window) {
    if (commit.type === 'delta') {
      const step = commitToStep(commit)
      if (step === null) {
        // A foreign delta payload poisons the position mapping — refuse the whole adoption
        // rather than guess (the log itself is untouched).
        return null
      }
      steps.push(step)
      position += 1
      positionCids[position] = commit.cid
    } else {
      // snapshot/meta: same state, newer chain tip for this position.
      positionCids[position] = commit.cid
    }
    positionByCid.set(commit.cid, position)
    if (onChainAnchor !== undefined && commit.cid === onChainAnchor.cid) {
      cursor = position
    }
  }

  if (onChainAnchor !== undefined && cursor >= 0) {
    return {
      journal: { version: 3, currentSig, cursor, steps },
      positionCids,
      anchorCid: onChainAnchor.cid,
    }
  }

  const windowCids = new Set(window.map((commit) => commit.cid))
  for (const candidate of sideCommitsNewestFirst) {
    if (snapshotSig(candidate) !== currentSig || windowCids.has(candidate.cid)) {
      continue
    }
    const anchorPosition = candidate.parent === null ? (window.length === 0 ? 0 : null) : positionByCid.get(candidate.parent) ?? null
    if (anchorPosition === null) {
      continue
    }
    // The side snapshot becomes the top commit of its position (future deltas after an undo
    // chain onto it — the same shape the live session writes).
    positionCids[anchorPosition] = candidate.cid
    return {
      journal: { version: 3, currentSig, cursor: anchorPosition, steps },
      positionCids,
      anchorCid: candidate.cid,
    }
  }

  return null
}
