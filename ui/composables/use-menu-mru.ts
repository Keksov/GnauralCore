// MR3.1 (menu-redesign): reactive + persisted wrapper around the pure MRU logic. A module-level
// singleton ref so every «Меню» instance shares one list (mirrors use-overall-graphs' pattern).
import { readonly, ref, type Ref } from 'vue'
import { MENU_MRU_STORAGE_KEY, parseStoredMru, pushMru } from './menu-mru'

let sharedIds: Ref<string[]> | null = null

function readStorage(): string[] {
  try {
    return parseStoredMru(localStorage.getItem(MENU_MRU_STORAGE_KEY))
  } catch {
    return []
  }
}

function writeStorage(ids: readonly string[]): void {
  try {
    localStorage.setItem(MENU_MRU_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable (private mode / quota) — the MRU just stays in-memory this session.
  }
}

export function useMenuMru() {
  if (sharedIds === null) {
    sharedIds = ref<string[]>(readStorage())
  }
  const ids = sharedIds

  function record(id: string): void {
    const next = pushMru(ids.value, id)
    ids.value = next
    writeStorage(next)
  }

  return { ids: readonly(ids), record }
}
