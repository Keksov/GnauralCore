// project-store PR1.5 (PR-D5/D7): reactive access to the CURRENT file's project.
//
// The audio store calls openProjectForFile() whenever a file is selected; subsystems then read
// their section once (readProjectSection) and write through writeProjectSection, which debounces
// ~500ms per section and flushes every pending write when the file switches or the page unloads
// (keepalive fetch). Concurrency model is last-write-wins per section (PR-D7): sections are small
// and each is owned by exactly one subsystem.
import { computed, ref } from 'vue'
import type { ProjectInfo } from '@protocol'
import { projectApi } from '../project-api'

const SECTION_PUT_DEBOUNCE_MS = 500

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

function sendSection(projectId: string, name: string, value: unknown): void {
  void projectApi.putSection({ id: projectId, name, value }).catch((error: unknown) => {
    console.warn('[use-project] putSection failed:', error instanceof Error ? error.message : error)
  })
}

export function flushPendingProjectWrites(): void {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timer)
    sendSection(pending.projectId, pending.name, pending.value)
  }
  pendingWrites.clear()
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
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingProjectWrites)
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
