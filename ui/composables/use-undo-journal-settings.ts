// UG4.1 (undo-global-journal, req 5): the undo-journal auto-clean settings — editor-level, stored
// in localStorage like the other editor preferences (point autosave, drag mode). Defaults are ALL
// off: «по умолчанию — хранить всегда» (the same numbers feed the server undo-log GC policy).
// Module-singleton refs, so the settings dialog and the lanes persist hook share one state without
// plumbing; a `watch` persists every change.
import { ref, watch } from 'vue'

export interface UndoJournalSettings {
  /** Keep at most N operations in the persisted journal (0 = unlimited). */
  readonly maxSteps: number
  /** Drop persisted operations older than N days (0 = keep forever). */
  readonly maxAgeDays: number
  /** Keep the persisted journal under N KB, dropping the oldest operations (0 = unlimited). */
  readonly maxSizeKb: number
  /** Wipe the stored journal instead of persisting it («очищать при закрытии проекта»). */
  readonly clearOnClose: boolean
}

const STORAGE_KEY = 'mindwave-undo-journal-settings'

const DEFAULTS: UndoJournalSettings = { maxSteps: 0, maxAgeDays: 0, maxSizeKb: 0, clearOnClose: false }

function load(): UndoJournalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<UndoJournalSettings>
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
    return {
      maxSteps: num(parsed.maxSteps),
      maxAgeDays: num(parsed.maxAgeDays),
      maxSizeKb: num(parsed.maxSizeKb),
      clearOnClose: parsed.clearOnClose === true,
    }
  } catch {
    return DEFAULTS
  }
}

const settings = ref<UndoJournalSettings>(load())

watch(settings, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* quota/priv mode — the setting just stays session-local */
  }
})

export function useUndoJournalSettings(): { settings: typeof settings } {
  return { settings }
}
