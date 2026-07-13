<template>
  <!-- The file-list panel: its own sticky toolbar (nav + view controls + filter funnel), the
       scrollable listing, and a sticky bottom filter — all in the SAME panel as the list
       (FB4-refine 2/3/4). Selection lives in the parent; this emits select/activate. -->
  <div class="fs-entry-list" tabindex="0" @keydown="onKeydown">
    <!-- Sticky top toolbar (FB4-refine 2): stays pinned; only the listing scrolls. -->
    <div class="fs-entry-list__toolbar row items-center q-gutter-xs">
      <!-- "Up" only makes sense in the flat dir listing; the tree navigates by expand/collapse. -->
      <q-btn v-if="!isTree" flat dense round icon="arrow_upward" :disable="store.parentPath === null" :aria-label="t('fsBrowser.up')" @click="store.goUp()">
        <q-tooltip>{{ t('fsBrowser.up') }}</q-tooltip>
      </q-btn>
      <q-btn flat dense round icon="refresh" :aria-label="t('fsBrowser.refresh')" @click="onRefresh">
        <q-tooltip>{{ t('fsBrowser.refresh') }}</q-tooltip>
      </q-btn>

      <div v-if="!isColumn && !isTree" class="fs-entry-list__breadcrumbs row items-center no-wrap col">
        <template v-for="(crumb, index) in store.breadcrumbs" :key="crumb.path">
          <q-icon v-if="index > 0" name="chevron_right" size="16px" class="fs-entry-list__crumb-sep" />
          <q-btn flat dense no-caps size="sm" :label="crumb.label" class="fs-entry-list__crumb" @click="store.openDir(crumb.path)" />
        </template>
      </div>
      <q-space v-else />

      <q-btn-toggle
        :model-value="store.viewMode"
        flat
        dense
        toggle-color="primary"
        :options="viewOptions"
        @update:model-value="(v: FsViewMode) => (store.viewMode = v)"
      >
        <template #view-table><q-icon name="table_chart" /><q-tooltip>{{ t('fsBrowser.viewTable') }}</q-tooltip></template>
        <template #view-list><q-icon name="view_list" /><q-tooltip>{{ t('fsBrowser.viewList') }}</q-tooltip></template>
        <template #view-icons><q-icon name="grid_view" /><q-tooltip>{{ t('fsBrowser.viewIcons') }}</q-tooltip></template>
        <template #view-tree><q-icon name="account_tree" /><q-tooltip>{{ t('fsBrowser.viewTree') }}</q-tooltip></template>
      </q-btn-toggle>
      <q-btn-toggle
        v-if="store.viewMode === 'icons'"
        :model-value="store.iconSize"
        flat
        dense
        toggle-color="primary"
        :options="iconSizeOptions"
        @update:model-value="(v: FsIconSize) => (store.iconSize = v)"
      />
      <!-- Audio toggle: pressed -> only supported audio files; released -> all files. -->
      <q-btn
        flat
        dense
        round
        :color="store.typeFilter === 'supported' ? 'primary' : undefined"
        icon="audiotrack"
        :aria-label="t('fsBrowser.typeSupported')"
        @click="store.typeFilter = store.typeFilter === 'supported' ? 'all' : 'supported'"
      >
        <q-tooltip>{{ store.typeFilter === 'supported' ? t('fsBrowser.typeSupported') : t('fsBrowser.typeAll') }}</q-tooltip>
      </q-btn>
      <q-btn flat dense round :color="store.showHidden ? 'primary' : undefined" icon="visibility" :aria-label="t('fsBrowser.showHidden')" @click="store.showHidden = !store.showHidden">
        <q-tooltip>{{ t('fsBrowser.showHidden') }}</q-tooltip>
      </q-btn>
      <!-- FB4-refine 3: the filter is summoned by this funnel (or Ctrl-S), never always-on. -->
      <q-btn flat dense round :color="store.filterVisible || store.filterText !== '' ? 'primary' : undefined" icon="filter_alt" :aria-label="t('fsBrowser.filterToggle')" @click="store.toggleFilter()">
        <q-tooltip>{{ t('fsBrowser.filterToggle') }}</q-tooltip>
      </q-btn>
    </div>

    <!-- FB4-refine: in the narrow vertical (left/right dock) layout, breadcrumbs get their own row
         right under the button toolbar, so the buttons row is not crowded. -->
    <div v-if="isColumn && !isTree" class="fs-entry-list__crumbbar row items-center no-wrap">
      <template v-for="(crumb, index) in store.breadcrumbs" :key="crumb.path">
        <q-icon v-if="index > 0" name="chevron_right" size="16px" class="fs-entry-list__crumb-sep" />
        <q-btn flat dense no-caps size="sm" :label="crumb.label" class="fs-entry-list__crumb" @click="store.openDir(crumb.path)" />
      </template>
    </div>

    <q-separator />

    <div class="fs-entry-list__content">
      <!-- Tree view (FB5.1, FB-D18): hierarchical + lazy-loaded, independent of the flat dir listing.
           Roots -> lazy dirs -> type-filtered children; the quick filter drives q-tree's own :filter. -->
      <div v-if="store.viewMode === 'tree'" ref="treeWrapRef" class="fs-entry-list__tree">
        <div v-if="treeNodes.length === 0" class="fs-entry-list__center text-grey-6">{{ t('fsBrowser.empty') }}</div>
        <q-tree
          v-else
          ref="treeRef"
          :nodes="treeNodes"
          node-key="path"
          label-key="name"
          children-key="children"
          :selected="selectedPath ?? ''"
          selected-color="primary"
          no-selection-unset
          :filter="store.filterText"
          :filter-method="treeFilterMethod"
          v-model:expanded="treeExpanded"
          @lazy-load="(details) => void onTreeLazyLoad(details)"
        >
          <template #default-header="prop">
            <div
              class="fs-entry-list__tree-node row items-center no-wrap"
              :class="{ 'fs-entry-list__row--muted': !prop.node.isDir && !isSupported(prop.node.ext) }"
              @click="onTreeNodeClick(prop.node)"
              @dblclick="onTreeNodeDblClick(prop.node)"
            >
              <q-icon :name="entryVisual(prop.node.isDir, prop.node.ext).icon" :color="entryVisual(prop.node.isDir, prop.node.ext).color" size="18px" class="fs-entry-list__row-icon" />
              <span class="fs-entry-list__row-name">{{ prop.node.name }}</span>
            </div>
          </template>
        </q-tree>
      </div>

      <template v-else>
      <div v-if="store.loading" class="fs-entry-list__center">
        <q-spinner-hourglass color="primary" size="32px" />
      </div>
      <div v-else-if="store.error" class="fs-entry-list__center text-negative">{{ store.error }}</div>
      <div v-else-if="entries.length === 0" class="fs-entry-list__center text-grey-6">{{ t('fsBrowser.empty') }}</div>

      <!-- Table view — resizable columns (FB4-refine 1). name/ext/size persist; date flex-fills. -->
      <template v-else-if="store.viewMode === 'table'">
        <div class="fs-entry-list__thead row no-wrap">
          <div class="fs-entry-list__th" :style="colStyle('name')" @click="store.setSort('name')">
            {{ t('fsBrowser.colName') }}<q-icon v-if="store.sortKey === 'name'" :name="sortIcon" size="16px" />
            <div class="fs-entry-list__col-resizer" @pointerdown="onColResize($event, 'name')" @click.stop />
          </div>
          <div class="fs-entry-list__th" :style="colStyle('ext')" @click="store.setSort('ext')">
            {{ t('fsBrowser.colExt') }}<q-icon v-if="store.sortKey === 'ext'" :name="sortIcon" size="16px" />
            <div class="fs-entry-list__col-resizer" @pointerdown="onColResize($event, 'ext')" @click.stop />
          </div>
          <div class="fs-entry-list__th" :style="colStyle('size')" @click="store.setSort('size')">
            {{ t('fsBrowser.colSize') }}<q-icon v-if="store.sortKey === 'size'" :name="sortIcon" size="16px" />
            <div class="fs-entry-list__col-resizer" @pointerdown="onColResize($event, 'size')" @click.stop />
          </div>
          <div class="fs-entry-list__th fs-entry-list__col-date" @click="store.setSort('mtime')">
            {{ t('fsBrowser.colDate') }}<q-icon v-if="store.sortKey === 'mtime'" :name="sortIcon" size="16px" />
          </div>
        </div>
        <q-virtual-scroll ref="tableScroll" :items="entries" class="fs-entry-list__scroll" v-slot="{ item }">
          <div
            :key="item.path"
            class="fs-entry-list__row row no-wrap items-center"
            :class="{ 'fs-entry-list__row--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item.ext) }"
            @click="emit('select', item)"
            @dblclick="emit('activate', item)"
          >
            <div class="fs-entry-list__cell fs-entry-list__cell--name row items-center no-wrap" :style="colStyle('name')">
              <q-icon :name="entryVisual(item.isDir, item.ext).icon" :color="entryVisual(item.isDir, item.ext).color" size="18px" class="fs-entry-list__row-icon" />
              <span class="fs-entry-list__row-name">{{ item.name }}</span>
            </div>
            <div class="fs-entry-list__cell" :style="colStyle('ext')">{{ item.isDir ? '' : item.ext }}</div>
            <div class="fs-entry-list__cell fs-entry-list__cell--size" :style="colStyle('size')">{{ item.isDir ? '' : formatSize(item.size) }}</div>
            <div class="fs-entry-list__cell fs-entry-list__col-date">{{ formatDate(item.mtimeMs) }}</div>
          </div>
        </q-virtual-scroll>
      </template>

      <!-- List view (names only). -->
      <template v-else-if="store.viewMode === 'list'">
        <q-virtual-scroll ref="listScroll" :items="entries" class="fs-entry-list__scroll" v-slot="{ item }">
          <div
            :key="item.path"
            class="fs-entry-list__row fs-entry-list__row--list row no-wrap items-center"
            :class="{ 'fs-entry-list__row--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item.ext) }"
            @click="emit('select', item)"
            @dblclick="emit('activate', item)"
          >
            <q-icon :name="entryVisual(item.isDir, item.ext).icon" :color="entryVisual(item.isDir, item.ext).color" size="18px" class="fs-entry-list__row-icon" />
            <span class="fs-entry-list__row-name">{{ item.name }}</span>
          </div>
        </q-virtual-scroll>
      </template>

      <!-- Icon view (sm/md/lg). Not virtualized. -->
      <div v-else class="fs-entry-list__scroll fs-entry-list__icons" :class="`fs-entry-list__icons--${store.iconSize}`">
        <div
          v-for="item in entries"
          :key="item.path"
          class="fs-entry-list__tile column items-center"
          :class="{ 'fs-entry-list__tile--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item.ext) }"
          @click="emit('select', item)"
          @dblclick="emit('activate', item)"
        >
          <q-icon :name="entryVisual(item.isDir, item.ext).icon" :color="entryVisual(item.isDir, item.ext).color" :size="iconTileSize" />
          <div class="fs-entry-list__tile-label">{{ item.name }}</div>
        </div>
      </div>
      </template>
    </div>

    <!-- Sticky bottom filter (FB4-refine 4): shows below the list, never scrolls with it. -->
    <template v-if="store.filterVisible">
      <q-separator />
      <div class="fs-entry-list__filter">
        <q-input
          ref="filterInput"
          :model-value="store.filterText"
          dense
          outlined
          clearable
          autofocus
          :placeholder="t('fsBrowser.filterPlaceholder')"
          @update:model-value="(v: string | number | null) => (store.filterText = v === null ? '' : String(v))"
          @keydown.esc.stop.prevent="store.setFilterVisible(false)"
        >
          <template #prepend>
            <q-icon name="filter_alt" size="18px" />
          </template>
        </q-input>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QInput, QTree, QVirtualScroll } from 'quasar'
import type { FsEntry, FsRoot } from '@protocol'
import { audioFileKindForExt, fsNameMatches, useFsBrowserStore, type FsIconSize, type FsTableColWidths, type FsViewMode } from '../stores/fs-browser'

const props = defineProps<{
  readonly selectedPath: string | null
}>()

const emit = defineEmits<{
  select: [entry: FsEntry]
  activate: [entry: FsEntry]
}>()

const { t } = useI18n()
const store = useFsBrowserStore()

const tableScroll = ref<QVirtualScroll | null>(null)
const listScroll = ref<QVirtualScroll | null>(null)
const filterInput = ref<QInput | null>(null)

const entries = computed<readonly FsEntry[]>(() => store.visibleEntries)
// Narrow vertical layout (left/right dock): breadcrumbs move to their own row under the buttons.
const isColumn = computed<boolean>(() => store.windowMode === 'left' || store.windowMode === 'right')
const isTree = computed<boolean>(() => store.viewMode === 'tree')

// Icon-only view toggle; each option renders via a named slot so it can carry a tooltip.
const viewOptions = [
  { value: 'table', slot: 'view-table' },
  { value: 'list', slot: 'view-list' },
  { value: 'icons', slot: 'view-icons' },
  { value: 'tree', slot: 'view-tree' },
]

// In tree mode Refresh rebuilds the tree from roots; in the flat views it re-lists the current dir.
const onRefresh = (): void => {
  if (store.viewMode === 'tree') {
    resetTree()
  } else {
    void store.refresh()
  }
}
const iconSizeOptions = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
]

const sortIcon = computed(() => (store.sortDir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'))
const iconTileSize = computed(() => (store.iconSize === 'sm' ? '32px' : store.iconSize === 'lg' ? '72px' : '48px'))

// name/ext/size are fixed + resizable; the date column flex-fills the remainder.
const colStyle = (key: keyof FsTableColWidths): Record<string, string> => {
  const w = store.tableColWidths[key]
  return { flex: `0 0 ${w}px`, width: `${w}px` }
}

const isSupported = (ext: string): boolean => audioFileKindForExt(ext) !== null

interface EntryVisual {
  readonly icon: string
  readonly color: string
}
// Shared by the flat rows (FsEntry) and the tree nodes (FsTreeNode) — both carry isDir + ext.
const entryVisual = (isDir: boolean, ext: string): EntryVisual => {
  if (isDir) {
    return { icon: 'folder', color: 'amber-8' }
  }
  switch (audioFileKindForExt(ext)) {
    case 'gnaural':
      return { icon: 'graphic_eq', color: 'purple-5' }
    case 'wav':
      return { icon: 'audiotrack', color: 'light-blue-6' }
    case 'flac':
      return { icon: 'music_note', color: 'teal-5' }
    default:
      return { icon: 'insert_drive_file', color: 'blue-grey-5' }
  }
}

// ---- Tree view (FB5.1, FB-D18) ---------------------------------------------------------------
// A hierarchical q-tree with lazy-loaded children, independent of the flat single-dir listing.
interface FsTreeNode {
  path: string
  name: string
  isDir: boolean
  ext: string
  lazy?: boolean
  children?: FsTreeNode[]
  // The FsEntry this node represents (synthetic for provider roots) — carried so selecting a tree
  // node in any subtree gives the dialog a full entry, not just a path it must re-look-up.
  entry: FsEntry
}

interface TreeLazyDetails {
  node: FsTreeNode
  key: string
  done: (children?: readonly FsTreeNode[]) => void
  fail: () => void
}

const treeNodes = ref<FsTreeNode[]>([])
const treeExpanded = ref<string[]>([])
const treeRef = ref<QTree | null>(null)
const treeWrapRef = ref<HTMLElement | null>(null)

const rootEntry = (root: FsRoot): FsEntry => ({
  name: root.label, path: root.path, isDir: true, isSymlink: false, size: 0, mtimeMs: 0, ext: '', kind: 'dir',
})

const toTreeNode = (entry: FsEntry): FsTreeNode => ({
  path: entry.path,
  name: entry.name,
  isDir: entry.isDir,
  ext: entry.ext,
  ...(entry.isDir ? { lazy: true } : {}),
  entry,
})

const buildTreeRoots = (): FsTreeNode[] =>
  store.roots.map((root) => ({ path: root.path, name: root.label, isDir: true, ext: '', lazy: true, entry: rootEntry(root) }))

const resetTree = (): void => {
  treeNodes.value = buildTreeRoots()
  treeExpanded.value = []
}

// Dirs first, then case-insensitive name — a stable, TC-like order for the tree children.
const treeSort = (a: FsEntry, b: FsEntry): number => {
  if (a.isDir !== b.isDir) {
    return a.isDir ? -1 : 1
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

const loadChildrenNodes = async (path: string): Promise<FsTreeNode[]> => {
  const children = await store.listChildren(path)
  return children
    .filter((child) => child.isDir || store.typeFilter === 'all' || audioFileKindForExt(child.ext) !== null)
    .slice()
    .sort(treeSort)
    .map(toTreeNode)
}

const onTreeLazyLoad = async (details: TreeLazyDetails): Promise<void> => {
  try {
    details.done(await loadChildrenNodes(details.node.path))
  } catch {
    details.fail()
  }
}

const treeFilterMethod = (node: FsTreeNode, filter: string): boolean => fsNameMatches(node.name, filter)

// A single click on a folder opens (expands) / closes it — q-tree's own setExpanded drives the
// lazy load + render reliably; files just get selected.
const onTreeNodeClick = (node: FsTreeNode): void => {
  emit('select', node.entry)
  const tree = treeRef.value
  if (node.isDir && tree !== null) {
    tree.setExpanded(node.path, !tree.isExpanded(node.path))
  }
}

const onTreeNodeDblClick = (node: FsTreeNode): void => {
  if (!node.isDir) {
    emit('activate', node.entry)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

// FB5.1 fix: reveal a directory in the tree (favorite / root click in tree mode, where a flat
// store.openDir has no visible effect). Expand each ancestor via q-tree's native setExpanded so it
// lazy-loads + renders, waiting for each level to materialize before descending; select the target.
const revealPath = async (path: string): Promise<void> => {
  if (store.viewMode !== 'tree') {
    await store.openDir(path)
    return
  }
  if (treeNodes.value.length === 0) {
    resetTree()
  }
  await nextTick()
  const tree = treeRef.value
  if (tree === null) {
    return
  }
  const crumbs = store.pathCrumbs(path)
  for (let i = 0; i < crumbs.length; i += 1) {
    const key = crumbs[i]?.path
    if (key === undefined) {
      break
    }
    // Wait for this node to appear (its parent finished lazy-loading), then expand it.
    // getNodeByKey returns undefined (not null) for a missing key — guard both (== null).
    let node = tree.getNodeByKey(key) as FsTreeNode | null | undefined
    for (let tries = 0; node == null && tries < 80; tries += 1) {
      await sleep(25)
      node = tree.getNodeByKey(key) as FsTreeNode | null | undefined
    }
    if (node == null) {
      return
    }
    if (node.isDir) {
      tree.setExpanded(key, true)
    }
    if (i === crumbs.length - 1) {
      emit('select', node.entry)
      // Scroll the revealed node into view — a deep branch can expand off-screen otherwise.
      await nextTick()
      treeWrapRef.value?.querySelector('.q-tree__node--selected')?.scrollIntoView({ block: 'nearest' })
    }
  }
}

// In tree mode, any flat navigation (a favorite or a Location click calls store.openDir, which sets
// currentPath) is mirrored into the tree by revealing that folder. This keeps the tree in sync
// without a fragile cross-component ref, using the local (proven) q-tree instance.
watch(() => store.currentPath, (path) => {
  if (store.viewMode === 'tree' && path !== null) {
    void revealPath(path)
  }
})

// (Re)build the tree when tree mode is entered, when roots load, or when a filter that changes the
// visible children (hidden/type) flips. Immediate so an already-'tree' mode builds on mount. On
// entering tree mode we also reveal the CURRENT folder (owner req.) — not just the collapsed roots.
watch(
  [() => store.viewMode, () => store.roots, () => store.showHidden, () => store.typeFilter],
  ([mode]) => {
    if (mode === 'tree') {
      resetTree()
      if (store.currentPath !== null) {
        void revealPath(store.currentPath)
      }
    }
  },
  { immediate: true },
)

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
const formatDate = (mtimeMs: number): string => {
  return mtimeMs > 0 ? dateFormat.format(new Date(mtimeMs)) : ''
}

// Focus the filter as soon as it is summoned.
watch(() => store.filterVisible, (visible) => {
  if (visible) {
    void nextTick(() => filterInput.value?.focus())
  }
})

const isEditableTarget = (target: EventTarget | null): boolean => {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

const onKeydown = (event: KeyboardEvent): void => {
  // Never hijack typing in the filter field.
  if (isEditableTarget(event.target)) {
    return
  }
  // The tree view manages its own keyboard traversal (q-tree); the flat-list arrow nav below
  // operates on visibleEntries, which the tree does not render.
  if (store.viewMode === 'tree') {
    return
  }
  const items = entries.value
  if (items.length === 0) {
    return
  }
  const currentIndex = items.findIndex((e) => e.path === props.selectedPath)

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectAtIndex(currentIndex < items.length - 1 ? currentIndex + 1 : 0)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectAtIndex(currentIndex > 0 ? currentIndex - 1 : items.length - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const entry = currentIndex >= 0 ? items[currentIndex] : undefined
    if (entry !== undefined) {
      emit('activate', entry)
    }
  } else if (event.key === 'Backspace') {
    event.preventDefault()
    void store.goUp()
  }
}

const selectAtIndex = (index: number): void => {
  const entry = entries.value[index]
  if (entry === undefined) {
    return
  }
  emit('select', entry)
  tableScroll.value?.scrollTo(index)
  listScroll.value?.scrollTo(index)
}

// Column resize (FB4-refine 1): drag a header's right edge; width persists via the store.
const onColResize = (event: PointerEvent, key: keyof FsTableColWidths): void => {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const startW = store.tableColWidths[key]
  const move = (moveEvent: PointerEvent): void => {
    store.setTableColWidth(key, startW + (moveEvent.clientX - startX))
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<style scoped lang="scss">
.fs-entry-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;

  &__toolbar {
    flex: 0 0 auto;
    padding: 2px 6px;
    flex-wrap: nowrap;
  }

  &__breadcrumbs {
    overflow-x: auto;
    min-width: 0;
  }

  // Dedicated breadcrumb row for the narrow vertical (left/right dock) layout.
  &__crumbbar {
    flex: 0 0 auto;
    padding: 0 6px 2px;
    overflow-x: auto;
  }

  &__crumb { min-height: 24px; }
  &__crumb-sep { opacity: 0.5; }

  &__content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  &__filter {
    flex: 0 0 auto;
    padding: 6px 8px;
  }

  &__center {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  &__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  &__thead {
    flex: 0 0 auto;
    font-weight: 600;
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
  }

  &__th {
    position: relative;
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
  }

  &__col-resizer {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;

    &:hover { background: rgba(25, 118, 210, 0.4); }
  }

  &__col-date { flex: 1 1 auto; min-width: 0; }

  &__cell {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &--size { text-align: right; }
  }

  &__row {
    padding: 2px 0;
    cursor: pointer;

    &:hover { background: rgba(128, 128, 128, 0.12); }
    &--active { background: rgba(25, 118, 210, 0.25); }
    &--muted { opacity: 0.5; }
  }

  &__row--list { padding: 2px 8px; }

  // Tree view (FB5.1): scrollable q-tree with clickable custom node headers.
  &__tree {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px 4px 4px 0;
  }

  &__tree-node {
    flex: 1 1 auto;
    min-width: 0;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;

    &:hover { background: rgba(128, 128, 128, 0.12); }
  }

  &__row-icon { margin-right: 6px; }

  &__row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__icons {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
    padding: 8px;

    &--sm .fs-entry-list__tile { width: 72px; }
    &--md .fs-entry-list__tile { width: 104px; }
    &--lg .fs-entry-list__tile { width: 140px; }
  }

  &__tile {
    padding: 8px 4px;
    cursor: pointer;
    border-radius: 4px;
    text-align: center;

    &:hover { background: rgba(128, 128, 128, 0.12); }
    &--active { background: rgba(25, 118, 210, 0.25); }
  }

  &__tile-label {
    margin-top: 4px;
    font-size: 12px;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
