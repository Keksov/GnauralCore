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
 *  baseSig/baseCursor semantics generalized to the log. Returns null when no snapshot matches
 *  (external edit): the history window stays empty, the LOG stays intact (VL-D5). */
export function planUndoLogAdoption(
  commitsNewestFirst: readonly ProjectUndoLogCommit[],
  currentSig: string,
): UndoLogAdoptionPlan | null {
  const anchor = commitsNewestFirst.find((commit) => snapshotSig(commit) === currentSig)
  if (anchor === undefined) {
    return null
  }

  const window = [...commitsNewestFirst].reverse() // oldest-first
  const steps: GTrackUndoStep[] = []
  const positionCids: (string | null)[] = [window[0]?.parent ?? null]
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
    if (commit.cid === anchor.cid) {
      cursor = position
    }
  }

  if (cursor < 0) {
    return null
  }

  return {
    journal: { version: 3, currentSig, cursor, steps },
    positionCids,
    anchorCid: anchor.cid,
  }
}

export interface UndoLogMigrationPlan {
  readonly commits: ProjectUndoLogCommitInput[]
  readonly positionCids: (string | null)[]
  readonly snapshotCid: string
}

/** Turn an adopted legacy v3 journal into the initial chain of an EMPTY log (S14):
 *  [deltas below cursor] -> snapshot(file state) -> [redo tail] -> meta imported-v3.
 *  The first commit is the root (the log is empty by precondition). */
export function planV3Migration(
  journal: GTrackUndoJournal,
  snapshotSchedule: unknown,
  nowMs: number,
): UndoLogMigrationPlan {
  const commits: ProjectUndoLogCommitInput[] = []
  const positionCids: (string | null)[] = [null]
  let parent: string | null = null

  const below = journal.steps.slice(0, journal.cursor)
  const above = journal.steps.slice(journal.cursor)

  for (const step of below) {
    commits.push(stepToCommitInput(step, parent))
    parent = step.id
    positionCids.push(step.id)
  }

  const snapshotCid = `s${nowMs.toString(36)}-v3`
  commits.push({
    cid: snapshotCid,
    parent,
    type: 'snapshot',
    atMs: below.length > 0 ? below[below.length - 1]!.atMs : nowMs,
    payload: { sig: journal.currentSig, schedule: snapshotSchedule } satisfies UndoLogSnapshotPayload,
  })
  parent = snapshotCid
  positionCids[journal.cursor] = snapshotCid

  for (const step of above) {
    commits.push(stepToCommitInput(step, parent))
    parent = step.id
    positionCids.push(step.id)
  }

  const metaCid = `m${nowMs.toString(36)}-v3`
  commits.push({
    cid: metaCid,
    parent,
    type: 'meta',
    atMs: nowMs,
    payload: { action: 'imported-v3', steps: journal.steps.length },
  })
  positionCids[positionCids.length - 1] = metaCid

  return { commits, positionCids, snapshotCid }
}
