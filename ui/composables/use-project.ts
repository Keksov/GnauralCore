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
export async function openProjectForFile(path: string): Promise<ProjectInfo | null> {
  flushPendingProjectWrites()

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

/** Debounced write of a subsystem's section (null removes it). No-op without an open project. */
export function writeProjectSection(name: string, value: unknown): void {
  const project = currentProject.value
  if (project === null) {
    return
  }

  const key = `${project.id}|${name}`
  const existing = pendingWrites.get(key)
  if (existing !== undefined) {
    clearTimeout(existing.timer)
  }

  pendingWrites.set(key, {
    projectId: project.id,
    name,
    value,
    timer: setTimeout(() => {
      pendingWrites.delete(key)
      sendSection(project.id, name, value)
    }, SECTION_PUT_DEBOUNCE_MS),
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
