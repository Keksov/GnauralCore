// MR3.1 (menu-redesign): pure MRU (most-recently-used) list logic for menu commands. Kept
// framework-free so it is unit-tested directly; the reactive/localStorage wrapper is use-menu-mru.ts.
export const MENU_MRU_STORAGE_KEY = 'mindwave-menu-mru'
export const MENU_MRU_MAX = 5

// Prepend `id`, drop any earlier duplicate, and cap the list length (most-recent-first).
export function pushMru(current: readonly string[], id: string, max: number = MENU_MRU_MAX): string[] {
  return [id, ...current.filter((existing) => existing !== id)].slice(0, max)
}

// Parse a persisted MRU blob defensively: unknown/corrupt input -> []. De-dups (order-preserving)
// and caps, so a hand-edited or legacy value can never poison the menu.
export function parseStoredMru(raw: string | null, max: number = MENU_MRU_MAX): string[] {
  if (raw === null) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    const seen = new Set<string>()
    const unique: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && !seen.has(item)) {
        seen.add(item)
        unique.push(item)
      }
    }
    return unique.slice(0, max)
  } catch {
    return []
  }
}
