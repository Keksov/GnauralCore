import { watch as fsWatch, type FSWatcher } from "node:fs"

interface WatchEntry {
  watcher: FSWatcher
  refCount: number
  debounceTimer: ReturnType<typeof setTimeout> | null
}

export function createScheduleWatcher(onChanged: (filePath: string) => void): {
  watch(filePath: string): void
  unwatch(filePath: string): void
  dispose(): void
} {
  const entries = new Map<string, WatchEntry>()

  const logWatchError = (filePath: string, aStage: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[schedule-watcher] ${aStage} for ${filePath}: ${message}`)
  }

  function watch(filePath: string): void {
    const existing = entries.get(filePath)
    if (existing !== undefined) {
      existing.refCount++
      return
    }

    let watcher: FSWatcher
    try {
      watcher = fsWatch(filePath, { persistent: false }, (eventType) => {
        if (eventType !== "change" && eventType !== "rename") {
          return
        }

        const entry = entries.get(filePath)
        if (entry === undefined) {
          return
        }

        if (entry.debounceTimer !== null) {
          clearTimeout(entry.debounceTimer)
        }

        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null
          onChanged(filePath)
        }, 300)
      })
    } catch (error) {
      logWatchError(filePath, "watch creation failed", error)
      return
    }

    watcher.on("error", (error) => {
      logWatchError(filePath, "watch runtime error", error)
    })

    entries.set(filePath, { watcher, refCount: 1, debounceTimer: null })
  }

  function unwatch(filePath: string): void {
    const entry = entries.get(filePath)
    if (entry === undefined) {
      return
    }

    entry.refCount--
    if (entry.refCount > 0) {
      return
    }

    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }

    try {
      entry.watcher.close()
    } catch {
      // Ignore close errors
    }

    entries.delete(filePath)
  }

  function dispose(): void {
    for (const [, entry] of entries) {
      if (entry.debounceTimer !== null) {
        clearTimeout(entry.debounceTimer)
        entry.debounceTimer = null
      }

      try {
        entry.watcher.close()
      } catch {
        // Ignore close errors
      }
    }

    entries.clear()
  }

  return { watch, unwatch, dispose }
}
