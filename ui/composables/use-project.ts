// project-store PR1.5 (PR-D5/D7): reactive access to the CURRENT file's project.
//
// The audio store calls openProjectForFile() whenever a file is selected; subsystems then read
// their section once (readProjectSection) and write through writeProjectSection, which debounces
// ~500ms per section and flushes every pending write when the file switches or the page unloads
// (keepalive fetch). Concurrency model is last-write-wins per section (PR-D7): sections are small
// and each is owned by exactly one subsystem.
import { computed, ref } from 'vue'
import type {
  ProjectInfo,
  ProjectUndoLogAppendResponse,
  ProjectUndoLogBranch,
  ProjectUndoLogChainResponse,
  ProjectUndoLogCommitInput,
  ProjectUndoLogCommitType,
  ProjectUndoLogGcPolicy,
} from '@protocol'
import { projectApi } from '../project-api'
import {
  dropAcknowledgedUndoLogCommits,
  mergeUndoLogRefsPatch,
  planKeepaliveUndoLogBatch,
  type UndoLogRefsPatch,
} from './undo-log-sync'

const SECTION_PUT_DEBOUNCE_MS = 500
// PR2.2 (PR-D8): the undo journal used to be heavier than a section (v1 snapshots) — hence a long
// pause. UG3.2c (undo-global-journal): the v3 journal is a KB-scale action log, and every debounced
// millisecond is a window in which an AppCore exit loses the tail (the native window close does not
// reliably fire beforeunload) -> write it almost immediately.
const UNDO_PUT_DEBOUNCE_MS = 250

const currentProject = ref<ProjectInfo | null>(null)
const openError = ref<string | null>(null)
let currentOpen: { readonly path: string; readonly promise: Promise<ProjectInfo | null> } | null = null

// Same-file check across path spellings (case, slash direction). POSIX dev paths contain no
// backslashes, so the transform is a no-op there and plain lowercase comparison remains correct.
const pathKey = (path: string): string => path.replace(/\//g, '\\').toLowerCase()

interface PendingSectionWrite {
  readonly projectId: string
  readonly name: string
  readonly value: unknown
  readonly timer: ReturnType<typeof setTimeout>
}

// key = `${projectId}|${name}` — safe because "|" can never appear in a project id (slug strips it).
const pendingWrites = new Map<string, PendingSectionWrite>()

function sendSection(projectId: string, name: string, value: unknown, keepalive = false): void {
  void projectApi.putSection({ id: projectId, name, value }, undefined, keepalive).catch((error: unknown) => {
    console.warn('[use-project] putSection failed:', error instanceof Error ? error.message : error)
  })
}

// undo-versioned-log VL4.4 (VL-D8) + undo-legacy-removal: the whole-journal v3 transport is
// gone entirely — the undo history flows through the undo-log queue below.

// --- undo-log queue (undo-versioned-log VL4.1, VL-D4) ----------------------------------------
// Commits are batched per project with the same short debounce as the v3 journal had; a batch is
// sent WHOLE and the server acknowledges an (appended + skipped) prefix — re-sending is safe
// because appends are idempotent by cid (S2). Snapshot commits are written eagerly (flush: true)
// so the unload flush normally carries deltas only.

interface PendingUndoLogState {
  commits: ProjectUndoLogCommitInput[]
  gc: ProjectUndoLogGcPolicy | undefined
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  inFlightPromise: Promise<void> | null
}

const pendingUndoLog = new Map<string, PendingUndoLogState>() // key = projectId
const pendingUndoLogRefs = new Map<string, { patch: UndoLogRefsPatch; timer: ReturnType<typeof setTimeout> }>()

let undoLogAppendResultHandler: ((projectId: string, result: ProjectUndoLogAppendResponse) => void) | null = null

/** The lanes layer registers here to track the synced tip and react to a 409 resync (VL4.2). */
export function setUndoLogAppendResultHandler(
  handler: ((projectId: string, result: ProjectUndoLogAppendResponse) => void) | null,
): void {
  undoLogAppendResultHandler = handler
}

function getPendingUndoLog(projectId: string): PendingUndoLogState {
  let state = pendingUndoLog.get(projectId)
  if (state === undefined) {
    state = { commits: [], gc: undefined, timer: null, inFlight: false, inFlightPromise: null }
    pendingUndoLog.set(projectId, state)
  }
  return state
}

async function sendUndoLogBatch(projectId: string): Promise<void> {
  const state = pendingUndoLog.get(projectId)
  if (state === undefined || state.inFlight || state.commits.length === 0) {
    return
  }

  const flight = (async (): Promise<void> => {
    const request = {
      id: projectId,
      commits: state.commits.slice(),
      advanceMain: true,
      ...(state.gc === undefined ? {} : { gc: state.gc }),
    }
    state.inFlight = true
    let result: ProjectUndoLogAppendResponse | null = null
    try {
      result = await projectApi.appendUndoLog(request)
      state.commits = dropAcknowledgedUndoLogCommits(state.commits, result)
      undoLogAppendResultHandler?.(projectId, result)
    } catch (error) {
      // Network failure: keep the batch pending — the next queue call re-schedules, duplicates
      // are skipped server-side.
      console.warn('[use-project] appendUndoLog failed:', error instanceof Error ? error.message : error)
    } finally {
      state.inFlight = false
      state.inFlightPromise = null
    }

    // A cut batch (409) is NOT retried blindly: the handler above owns the resync (VL4.2).
    if (result !== null && result.rejectedFrom === null && state.commits.length > 0) {
      scheduleUndoLogSend(projectId)
    }
  })()
  state.inFlightPromise = flight
  await flight
}

/** Awaitable drain of the pending commits batch, by id — shared by flushProjectUndoLogFor (the
 *  mid-history save path, VL5.2 round 2) and the refs queue below (undo-log-perf investigation
 *  2026-07-22 round 3: the refs PUT must not race the commits POST it points at). */
async function flushPendingUndoLogCommits(projectId: string): Promise<void> {
  const state = pendingUndoLog.get(projectId)
  if (state === undefined) {
    return
  }
  if (state.timer !== null) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (state.inFlightPromise !== null) {
    await state.inFlightPromise.catch(() => undefined)
  }
  await sendUndoLogBatch(projectId)
}

/** Awaitable drain of the pending batch — the mid-history save snapshot must not race the
 *  deltas it chains onto (VL5.2 round 2). */
export async function flushProjectUndoLogFor(path: string): Promise<void> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return
  }
  await flushPendingUndoLogCommits(project.id)
}

function scheduleUndoLogSend(projectId: string): void {
  const state = getPendingUndoLog(projectId)
  if (state.timer !== null) {
    clearTimeout(state.timer)
  }
  state.timer = setTimeout(() => {
    state.timer = null
    void sendUndoLogBatch(projectId)
  }, UNDO_PUT_DEBOUNCE_MS)
}

/** Queue commits for the file's project. flush: true sends immediately (snapshots — they must
 *  not sit in a debounce the unload flush would refuse to carry). gc is sticky per project. */
export function queueProjectUndoLogCommitsFor(
  path: string,
  commits: readonly ProjectUndoLogCommitInput[],
  options: { gc?: ProjectUndoLogGcPolicy; flush?: boolean } = {},
): void {
  void getProjectForPath(path).then((project) => {
    if (project === null) {
      return
    }
    const state = getPendingUndoLog(project.id)
    state.commits.push(...commits)
    if (options.gc !== undefined) {
      state.gc = options.gc
    }
    if (options.flush === true) {
      if (state.timer !== null) {
        clearTimeout(state.timer)
        state.timer = null
      }
      void sendUndoLogBatch(project.id)
    } else {
      scheduleUndoLogSend(project.id)
    }
  })
}

/** Immediate append with the confirmed result — a mid-history save snapshot passes
 *  advanceMain:false so main stays on the line tip and the redo tail keeps living there
 *  (VL5.2 round 2). */
export async function appendProjectUndoLogNowFor(
  path: string,
  commits: readonly ProjectUndoLogCommitInput[],
  options: { advanceMain?: boolean } = {},
): Promise<ProjectUndoLogAppendResponse | null> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return null
  }
  try {
    return await projectApi.appendUndoLog({ id: project.id, commits: [...commits], advanceMain: options.advanceMain !== false })
  } catch (error) {
    console.warn('[use-project] appendUndoLog failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Debounced last-write-wins refs update (head on undo/redo, tags from the panel). */
export function queueProjectUndoLogRefsFor(path: string, patch: UndoLogRefsPatch): void {
  void getProjectForPath(path).then((project) => {
    if (project === null) {
      return
    }
    const existing = pendingUndoLogRefs.get(project.id)
    const merged = mergeUndoLogRefsPatch(existing?.patch ?? {}, patch)
    if (existing !== undefined) {
      clearTimeout(existing.timer)
    }
    pendingUndoLogRefs.set(project.id, {
      patch: merged,
      timer: setTimeout(() => {
        pendingUndoLogRefs.delete(project.id)
        void (async () => {
          // undo-log-perf investigation (2026-07-22 round 3, owner report — rapid edits during the
          // slowdown repro): this timer and the commits batch's own timer are separate debounces
          // reset by the same edit stream, so they fire within the same tick of each other — head
          // could name a cid the commits POST hadn't landed yet, and the server correctly 404'd it
          // ("Unknown commit"), confirmed live. Draining the commits queue first guarantees the cid
          // this patch points at is already persisted before the PUT goes out.
          await flushPendingUndoLogCommits(project.id)
          try {
            await projectApi.putUndoLogRefs({ id: project.id, ...merged })
          } catch (error) {
            console.warn('[use-project] putUndoLogRefs failed:', error instanceof Error ? error.message : error)
          }
        })()
      }, UNDO_PUT_DEBOUNCE_MS),
    })
  })
}

export async function readProjectUndoLogChainFor(
  path: string,
  options: { from?: string; limit?: number; untilType?: ProjectUndoLogCommitType } = {},
): Promise<ProjectUndoLogChainResponse | null> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return null
  }
  try {
    return await projectApi.fetchUndoLogChain(project.id, options)
  } catch (error) {
    console.warn('[use-project] fetchUndoLogChain failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** undo-orphan-branches (OB-D5): flat newest-first summaries of the abandoned branches. */
export async function readProjectUndoLogBranchesFor(path: string): Promise<readonly ProjectUndoLogBranch[] | null> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return null
  }
  try {
    return (await projectApi.fetchUndoLogBranches(project.id)).branches
  } catch (error) {
    console.warn('[use-project] fetchUndoLogBranches failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** undo-orphan-branches (OB-D3): delete a branch tip's exclusive suffix. The server's 409 text
 *  (not a tip / tagged branch) comes back in `error` for the panel notify; null = no project. */
export async function deleteProjectUndoLogBranchFor(
  path: string,
  tip: string,
): Promise<{ deleted: number } | { error: string } | null> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return null
  }
  try {
    const response = await projectApi.deleteUndoLogBranch({ id: project.id, tip })
    return { deleted: response.deleted }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[use-project] deleteUndoLogBranch failed:', message)
    return { error: message }
  }
}

/** Drop everything queued for the file's project (the 409-resync path re-reads the chain). */
export function discardPendingUndoLogFor(path: string): void {
  void getProjectForPath(path).then((project) => {
    if (project === null) {
      return
    }
    const state = pendingUndoLog.get(project.id)
    if (state !== undefined) {
      if (state.timer !== null) {
        clearTimeout(state.timer)
      }
      pendingUndoLog.delete(project.id)
    }
  })
}

export async function clearProjectUndoLogFor(path: string): Promise<boolean> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return false
  }
  const state = pendingUndoLog.get(project.id)
  if (state !== undefined) {
    if (state.timer !== null) {
      clearTimeout(state.timer)
    }
    pendingUndoLog.delete(project.id)
  }
  try {
    await projectApi.clearUndoLog(project.id)
    return true
  } catch (error) {
    console.warn('[use-project] clearUndoLog failed:', error instanceof Error ? error.message : error)
    return false
  }
}

export function flushPendingProjectWrites(): void {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timer)
    sendSection(pending.projectId, pending.name, pending.value, true) // UC-D4: keepalive only on the unload flush
  }
  pendingWrites.clear()

  // undo-log (VL4.1): fire the keepalive-sized PREFIX of each pending batch and keep the queue
  // as-is — if the page survives (file switch), the normal debounce re-sends everything and the
  // server skips the duplicates (S2); if the page dies, the prefix is what survives.
  for (const [projectId, state] of pendingUndoLog) {
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.commits.length === 0) {
      continue
    }
    const batch = planKeepaliveUndoLogBatch(state.commits)
    if (batch.length === 0) {
      continue
    }
    void projectApi.appendUndoLog({ id: projectId, commits: batch, advanceMain: true }, undefined, true).catch(() => undefined)
  }

  for (const [projectId, pending] of pendingUndoLogRefs) {
    clearTimeout(pending.timer)
    pendingUndoLogRefs.delete(projectId)
    void projectApi.putUndoLogRefs({ id: projectId, ...pending.patch }, undefined, true).catch(() => undefined)
  }
}

/** Called from the audio store on file selection: flushes writes belonging to the previous file,
 *  then find-or-creates the project server-side. Never throws — a project failure must not break
 *  file opening; the error is kept in openError for the UI. */
export function openProjectForFile(path: string): Promise<ProjectInfo | null> {
  flushPendingProjectWrites()

  const promise = (async (): Promise<ProjectInfo | null> => {
    try {
      const info = await projectApi.openProject(path)
      currentProject.value = info
      openError.value = null
      return info
    } catch (error) {
      currentProject.value = null
      openError.value = error instanceof Error ? error.message : 'Failed to open the project'
      console.warn('[use-project] openProject failed:', openError.value)
      return null
    }
  })()

  currentOpen = { path, promise }
  return promise
}

/** Project info for a SPECIFIC file path (PR2.1): reuses the current project or the in-flight open
 *  when the path matches, otherwise find-or-creates directly (openProject is idempotent). Lets
 *  per-file subsystems (lanes, undo, view) resolve their project without racing the store's open. */
export async function getProjectForPath(path: string): Promise<ProjectInfo | null> {
  const key = pathKey(path)
  const current = currentProject.value
  if (current !== null && pathKey(current.source.path) === key) {
    return current
  }

  if (currentOpen !== null && pathKey(currentOpen.path) === key) {
    return currentOpen.promise
  }

  try {
    return await projectApi.openProject(path)
  } catch (error) {
    console.warn('[use-project] openProject failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export function closeCurrentProject(): void {
  flushPendingProjectWrites()
  currentProject.value = null
  openError.value = null
}

/** Read a subsystem's section of the current project (null when absent / no project). A pending
 *  debounced write is the freshest value and short-circuits the server round-trip. */
export async function readProjectSection<T>(name: string): Promise<T | null> {
  const project = currentProject.value
  if (project === null) {
    return null
  }

  const pending = pendingWrites.get(`${project.id}|${name}`)
  if (pending !== undefined) {
    return (pending.value ?? null) as T | null
  }

  try {
    const response = await projectApi.fetchSection(project.id, name)
    return (response.value ?? null) as T | null
  } catch (error) {
    console.warn('[use-project] fetchSection failed:', error instanceof Error ? error.message : error)
    return null
  }
}

function queueSectionWrite(projectId: string, name: string, value: unknown): void {
  const key = `${projectId}|${name}`
  const existing = pendingWrites.get(key)
  if (existing !== undefined) {
    clearTimeout(existing.timer)
  }

  pendingWrites.set(key, {
    projectId,
    name,
    value,
    timer: setTimeout(() => {
      pendingWrites.delete(key)
      sendSection(projectId, name, value)
    }, SECTION_PUT_DEBOUNCE_MS),
  })
}

/** Debounced write of a subsystem's section (null removes it). No-op without an open project. */
export function writeProjectSection(name: string, value: unknown): void {
  const project = currentProject.value
  if (project === null) {
    return
  }

  queueSectionWrite(project.id, name, value)
}

/** Path-addressed variants (PR2.1) for subsystems keyed by filePath rather than "the current file". */
export async function readProjectSectionFor<T>(path: string, name: string): Promise<T | null> {
  const project = await getProjectForPath(path)
  if (project === null) {
    return null
  }

  const pending = pendingWrites.get(`${project.id}|${name}`)
  if (pending !== undefined) {
    return (pending.value ?? null) as T | null
  }

  try {
    const response = await projectApi.fetchSection(project.id, name)
    return (response.value ?? null) as T | null
  } catch (error) {
    console.warn('[use-project] fetchSection failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export function writeProjectSectionFor(path: string, name: string, value: unknown): void {
  void getProjectForPath(path).then((project) => {
    if (project !== null) {
      queueSectionWrite(project.id, name, value)
    }
  })
}

// Pending writes must survive a tab close: keepalive fetches issued here still complete.
// UG3.2c: pagehide covers unload paths where beforeunload does not fire (WebView2/AppCore close,
// bfcache navigations) — the flush is idempotent, so both firing is harmless.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingProjectWrites)
  window.addEventListener('pagehide', flushPendingProjectWrites)
}

export function useProject() {
  return {
    currentProject: computed(() => currentProject.value),
    projectOpenError: computed(() => openError.value),
    openProjectForFile,
    closeCurrentProject,
    readProjectSection,
    writeProjectSection,
    flushPendingProjectWrites,
  }
}
