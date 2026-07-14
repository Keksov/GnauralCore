// file-browser (FB2.x): the dialog's brain. Manages provider discovery, navigation, the entry
// listing, persisted view/sort/filter/favorites preferences, the Ctrl-S-style regexp filter, and
// the supported-type filter. Setup-style Pinia store (matches stores/audio.ts); prefs persist to
// localStorage per field (matches BodyMonitorCore preferences.ts).
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AudioFileKind, FsEntry, FsEntryKind, FsInfoResponse, FsRoot } from '@protocol'
import { fsBrowserApi } from '../fs-browser-api'

export type FsViewMode = 'table' | 'list' | 'icons' | 'tree'
export type FsIconSize = 'sm' | 'md' | 'lg'
export type FsSortKey = 'name' | 'ext' | 'size' | 'mtime'
export type FsSortDir = 'asc' | 'desc'
export type FsTypeFilter = 'supported' | 'all'
// PW1.2: the window model (mode/floatRect/dockSize/open, FB4.2/FB4.3/FB5.2) moved out of this
// store into the universal panel state — see stores/file-open-panel.ts (@panel, PW-D3).

// FB4-refine 1: persisted table column widths (name/ext/size are resizable; date flex-fills).
export interface FsTableColWidths {
  name: number
  ext: number
  size: number
}

export interface FsFavorite {
  readonly providerId: string
  readonly path: string
  readonly label: string
  readonly kind: FsEntryKind
}

// Editor-supported extensions (FB-D9). Mirrors the server's getAudioFileKind
// (GnauralCore/server/audio-file-utils.ts) — keep in sync.
const SUPPORTED_EXTS = new Map<string, AudioFileKind>([
  ['gnaural', 'gnaural'],
  ['wav', 'wav'],
  ['flac', 'flac'],
])

export const audioFileKindForExt = (ext: string): AudioFileKind | null => {
  return SUPPORTED_EXTS.get(ext.toLowerCase()) ?? null
}

const DEFAULT_PROVIDER = 'local'
const STORAGE_PREFIX = 'mindwave-fs-browser-'
const KEY_VIEW = `${STORAGE_PREFIX}view`
const KEY_ICON = `${STORAGE_PREFIX}icon-size`
const KEY_SORT_KEY = `${STORAGE_PREFIX}sort-key`
const KEY_SORT_DIR = `${STORAGE_PREFIX}sort-dir`
const KEY_HIDDEN = `${STORAGE_PREFIX}show-hidden`
const KEY_TYPE = `${STORAGE_PREFIX}type-filter`
const KEY_FAVORITES = `${STORAGE_PREFIX}favorites`
const KEY_COLS = `${STORAGE_PREFIX}cols`
// FB5.3 (owner req. 19): the last-visited folder — restored on init so a page refresh reopens the
// dialog in the same directory it was in.
const KEY_LAST_DIR = `${STORAGE_PREFIX}last-dir`

const DEFAULT_COLS: FsTableColWidths = { name: 260, ext: 60, size: 92 }

const readString = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

const readBool = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1' || raw === 'true'
  } catch {
    return fallback
  }
}

const readCols = (): FsTableColWidths => {
  try {
    const raw = localStorage.getItem(KEY_COLS)
    if (raw === null) {
      return { ...DEFAULT_COLS }
    }
    const parsed = JSON.parse(raw) as Partial<FsTableColWidths>
    return {
      name: typeof parsed.name === 'number' ? parsed.name : DEFAULT_COLS.name,
      ext: typeof parsed.ext === 'number' ? parsed.ext : DEFAULT_COLS.ext,
      size: typeof parsed.size === 'number' ? parsed.size : DEFAULT_COLS.size,
    }
  } catch {
    return { ...DEFAULT_COLS }
  }
}

const readFavorites = (): FsFavorite[] => {
  try {
    const raw = localStorage.getItem(KEY_FAVORITES)
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item): FsFavorite[] => {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as FsFavorite).path === 'string' &&
        typeof (item as FsFavorite).label === 'string' &&
        ((item as FsFavorite).kind === 'dir' || (item as FsFavorite).kind === 'file')
      ) {
        const fav = item as FsFavorite
        return [{
          providerId: typeof fav.providerId === 'string' ? fav.providerId : DEFAULT_PROVIDER,
          path: fav.path,
          label: fav.label,
          kind: fav.kind,
        }]
      }
      return []
    })
  } catch {
    return []
  }
}

const persist = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore quota / privacy-mode failures — persistence is best-effort.
  }
}

// Build a name matcher for the Ctrl-S quick filter (FB-D5): regexp (case-insensitive) by default;
// an invalid pattern falls back to a literal case-insensitive substring match. Empty = match all.
const buildMatcher = (pattern: string): ((name: string) => boolean) => {
  const trimmed = pattern.trim()
  if (trimmed === '') {
    return () => true
  }
  try {
    const re = new RegExp(trimmed, 'i')
    return (name: string) => re.test(name)
  } catch {
    const needle = trimmed.toLowerCase()
    return (name: string) => name.toLowerCase().includes(needle)
  }
}

// FB5.1 (FB-D18): the tree view's q-tree :filter-method reuses the same regexp-then-substring
// semantics as the flat list's quick filter.
export const fsNameMatches = (name: string, pattern: string): boolean => buildMatcher(pattern)(name)

export const useFsBrowserStore = defineStore('fs-browser', () => {
  const info = ref<FsInfoResponse | null>(null)
  const providerId = ref<string>(DEFAULT_PROVIDER)
  const roots = ref<FsRoot[]>([])
  const currentPath = ref<string | null>(null)
  const parentPath = ref<string | null>(null)
  const entries = ref<FsEntry[]>([])
  const loading = ref<boolean>(false)
  const error = ref<string | null>(null)
  const filterText = ref<string>('')
  // FB4-refine 3: the filter is hidden until summoned by the funnel icon / Ctrl-S (session state).
  const filterVisible = ref<boolean>(false)
  // FB5.1: an explicit "reveal this folder in the tree" request. The nonce makes the object change
  // on every call so the tree's watcher fires even when the same path is requested twice.
  const revealSignal = ref<{ readonly path: string; readonly nonce: number } | null>(null)
  let revealNonce = 0

  // Persisted preferences.
  const viewMode = ref<FsViewMode>(readString(KEY_VIEW, ['table', 'list', 'icons', 'tree'], 'table'))
  const iconSize = ref<FsIconSize>(readString(KEY_ICON, ['sm', 'md', 'lg'], 'md'))
  const sortKey = ref<FsSortKey>(readString(KEY_SORT_KEY, ['name', 'ext', 'size', 'mtime'], 'name'))
  const sortDir = ref<FsSortDir>(readString(KEY_SORT_DIR, ['asc', 'desc'], 'asc'))
  const showHidden = ref<boolean>(readBool(KEY_HIDDEN, false))
  const typeFilter = ref<FsTypeFilter>(readString(KEY_TYPE, ['supported', 'all'], 'supported'))
  const favorites = ref<FsFavorite[]>(readFavorites())

  const tableColWidths = ref<FsTableColWidths>(readCols())

  watch(viewMode, (v) => persist(KEY_VIEW, v))
  watch(iconSize, (v) => persist(KEY_ICON, v))
  watch(sortKey, (v) => persist(KEY_SORT_KEY, v))
  watch(sortDir, (v) => persist(KEY_SORT_DIR, v))
  watch(showHidden, (v) => persist(KEY_HIDDEN, v ? '1' : '0'))
  watch(typeFilter, (v) => persist(KEY_TYPE, v))
  watch(favorites, (v) => persist(KEY_FAVORITES, JSON.stringify(v)), { deep: true })
  watch(tableColWidths, (v) => persist(KEY_COLS, JSON.stringify(v)), { deep: true })
  // Re-list when hidden-file visibility flips (server-side filter).
  watch(showHidden, () => {
    if (currentPath.value !== null) {
      void openDir(currentPath.value)
    }
  })

  const available = computed<boolean>(() => info.value?.available === true)
  const baseUrl = computed<string | null>(() => info.value?.url ?? null)
  const providers = computed<readonly string[]>(() => info.value?.providers ?? [])

  const supported = (entry: FsEntry): boolean => entry.isDir || audioFileKindForExt(entry.ext) !== null

  const compareEntries = (a: FsEntry, b: FsEntry): number => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1 // dirs first, regardless of sort direction
    }
    const dir = sortDir.value === 'asc' ? 1 : -1
    let cmp = 0
    switch (sortKey.value) {
      case 'size':
        cmp = a.size - b.size
        break
      case 'mtime':
        cmp = a.mtimeMs - b.mtimeMs
        break
      case 'ext':
        cmp = a.ext.localeCompare(b.ext, undefined, { sensitivity: 'base' })
        break
      case 'name':
        cmp = 0
        break
    }
    if (cmp === 0) {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    return cmp * dir
  }

  // Directories are always shown for navigation; the type filter only ever hides files (FB-D9).
  const visibleEntries = computed<FsEntry[]>(() => {
    const matcher = buildMatcher(filterText.value)
    const typeAllowsFiles = typeFilter.value === 'all'
    return entries.value
      .filter((entry) => {
        if (!matcher(entry.name)) {
          return false
        }
        if (entry.isDir) {
          return true
        }
        return typeAllowsFiles || supported(entry)
      })
      .slice()
      .sort(compareEntries)
  })

  interface Breadcrumb {
    readonly label: string
    readonly path: string
  }

  // Split an absolute path into cumulative-path crumbs (root -> ... -> leaf). Works for both
  // C:\a\b and /a/b. Reused by the breadcrumbs bar and by the tree view's reveal-a-folder logic
  // (FB5.1) to build the ancestor chain it must expand.
  const pathCrumbs = (path: string): Breadcrumb[] => {
    const isWindows = /^[A-Za-z]:[\\/]/.test(path)
    const sep = isWindows ? '\\' : '/'
    const normalized = path.replace(/[\\/]+$/, '')
    const parts = normalized.split(/[\\/]+/).filter((p) => p !== '')
    const crumbs: Breadcrumb[] = []
    if (isWindows) {
      const drive = parts.shift() ?? ''
      crumbs.push({ label: `${drive}\\`, path: `${drive}\\` })
      let acc = `${drive}\\`
      for (const part of parts) {
        acc = acc.endsWith('\\') ? `${acc}${part}` : `${acc}${sep}${part}`
        crumbs.push({ label: part, path: acc })
      }
    } else {
      crumbs.push({ label: '/', path: '/' })
      let acc = ''
      for (const part of parts) {
        acc = `${acc}/${part}`
        crumbs.push({ label: part, path: acc })
      }
    }
    return crumbs
  }

  const breadcrumbs = computed<Breadcrumb[]>(() =>
    currentPath.value === null ? [] : pathCrumbs(currentPath.value),
  )

  let openToken = 0

  // Returns true when the directory listed successfully (used by init's start-dir fallback chain).
  async function openDir(path: string): Promise<boolean> {
    const base = baseUrl.value
    if (base === null) {
      return false
    }
    const token = ++openToken
    loading.value = true
    error.value = null
    try {
      const result = await fsBrowserApi.listDir(base, providerId.value, path, { showHidden: showHidden.value })
      if (token !== openToken) {
        return false
      }
      currentPath.value = result.path
      parentPath.value = result.parent
      entries.value = [...result.entries]
      rememberDir(result.path) // FB5.3: the current folder is restored after a page refresh.
      return true
    } catch (err) {
      if (token !== openToken) {
        return false
      }
      error.value = err instanceof Error ? err.message : 'Failed to list directory'
      entries.value = []
      return false
    } finally {
      if (token === openToken) {
        loading.value = false
      }
    }
  }

  // FB5.1 (FB-D18): list a directory's entries WITHOUT touching currentPath — the tree view's
  // lazy-load calls this to materialize a node's children. Errors surface as an empty child set.
  async function listChildren(path: string): Promise<FsEntry[]> {
    const base = baseUrl.value
    if (base === null) {
      return []
    }
    const result = await fsBrowserApi.listDir(base, providerId.value, path, { showHidden: showHidden.value })
    return [...result.entries]
  }

  // FB5.3: persist the last-visited folder (best-effort). Called on every successful openDir and on
  // every tree reveal/browse, so init can restore it across a refresh.
  const rememberDir = (path: string): void => {
    persist(KEY_LAST_DIR, path)
  }

  const readLastDir = (): string | null => {
    try {
      const raw = localStorage.getItem(KEY_LAST_DIR)
      return raw !== null && raw !== '' ? raw : null
    } catch {
      return null
    }
  }

  // FB5.1: ask the tree view (FsEntryList) to reveal + select a folder. Used by favorites/roots in
  // tree mode, where a flat openDir has no visible effect. The nonce forces a fresh signal object.
  const requestReveal = (path: string): void => {
    rememberDir(path) // FB5.3: tree navigation (favorites/roots/reveal) also updates the remembered folder.
    revealNonce += 1
    revealSignal.value = { path, nonce: revealNonce }
  }

  async function loadRoots(): Promise<void> {
    const base = baseUrl.value
    if (base === null) {
      return
    }
    try {
      const result = await fsBrowserApi.listRoots(base, providerId.value)
      roots.value = [...result.roots]
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to list roots'
      roots.value = []
    }
  }

  // Discover the loopback server, load roots, and open an initial directory (a favorite dir, else
  // the first root). Safe to call every time the dialog opens.
  async function init(initialPath?: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      info.value = await fsBrowserApi.fetchInfo()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reach the file service'
      info.value = null
    }
    if (!available.value) {
      loading.value = false
      return
    }
    if (providers.value.length > 0 && !providers.value.includes(providerId.value)) {
      providerId.value = providers.value[0] ?? DEFAULT_PROVIDER
    }
    await loadRoots()
    // FB5.3 (FB-D20): start-dir priority — the remembered last folder wins (a refresh must reopen
    // where the user was), then the caller's initialPath (presetsRoot default seed), then the first
    // favorite dir, then the first root. Each is tried in order; a stale/removed folder that fails to
    // list falls through to the next candidate so the dialog never opens onto an error.
    const candidates: string[] = []
    const pushCandidate = (path: string | undefined | null): void => {
      if (typeof path === 'string' && path !== '' && !candidates.includes(path)) {
        candidates.push(path)
      }
    }
    pushCandidate(readLastDir())
    pushCandidate(initialPath)
    pushCandidate(favorites.value.find((f) => f.kind === 'dir' && f.providerId === providerId.value)?.path)
    pushCandidate(roots.value[0]?.path)

    let opened = false
    for (const dir of candidates) {
      if (await openDir(dir)) {
        opened = true
        break
      }
    }
    if (!opened) {
      loading.value = false
    }
  }

  const goUp = async (): Promise<void> => {
    if (parentPath.value !== null) {
      await openDir(parentPath.value)
    }
  }

  const refresh = async (): Promise<void> => {
    if (currentPath.value !== null) {
      await openDir(currentPath.value)
    }
  }

  const setSort = (key: FsSortKey): void => {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey.value = key
      sortDir.value = 'asc'
    }
  }

  const isFavorite = (path: string): boolean => {
    return favorites.value.some((f) => f.providerId === providerId.value && f.path === path)
  }

  const addFavorite = (fav: Omit<FsFavorite, 'providerId'> & { providerId?: string }): void => {
    const providerKey = fav.providerId ?? providerId.value
    if (favorites.value.some((f) => f.providerId === providerKey && f.path === fav.path)) {
      return
    }
    favorites.value = [...favorites.value, { providerId: providerKey, path: fav.path, label: fav.label, kind: fav.kind }]
  }

  const removeFavorite = (path: string, provider?: string): void => {
    const providerKey = provider ?? providerId.value
    favorites.value = favorites.value.filter((f) => !(f.providerId === providerKey && f.path === path))
  }

  const setFilterVisible = (visible: boolean): void => {
    filterVisible.value = visible
    if (!visible) {
      filterText.value = ''
    }
  }

  const toggleFilter = (): void => {
    setFilterVisible(!filterVisible.value)
  }

  const setTableColWidth = (key: keyof FsTableColWidths, px: number): void => {
    tableColWidths.value = { ...tableColWidths.value, [key]: Math.max(40, Math.min(px, 800)) }
  }

  return {
    // state
    info,
    providerId,
    roots,
    currentPath,
    parentPath,
    entries,
    loading,
    error,
    filterText,
    filterVisible,
    revealSignal,
    tableColWidths,
    viewMode,
    iconSize,
    sortKey,
    sortDir,
    showHidden,
    typeFilter,
    favorites,
    // getters
    available,
    baseUrl,
    providers,
    visibleEntries,
    breadcrumbs,
    // actions
    pathCrumbs,
    init,
    openDir,
    listChildren,
    rememberDir,
    requestReveal,
    loadRoots,
    goUp,
    refresh,
    setSort,
    isFavorite,
    addFavorite,
    removeFavorite,
    setFilterVisible,
    toggleFilter,
    setTableColWidth,
  }
})
