<template>
  <!-- FB4.2/FB4.3 (FB-D13): a floating (draggable) or edge-docked panel, not a modal. AudioPage
       teleports it to <body> when floating and hosts it as a flex child when docked. -->
  <div
    v-if="modelValue"
    class="file-open-dialog"
    :class="modeClass"
    :style="rootStyle"
    tabindex="0"
    @keydown="onKeydown"
  >
    <div class="file-open-dialog__titlebar row items-center no-wrap">
      <div
        class="file-open-dialog__drag row items-center no-wrap col"
        :class="{ 'file-open-dialog__drag--active': isFloating }"
        @pointerdown="onTitlePointerDown"
      >
        <q-icon name="folder_open" size="18px" class="q-mr-sm" />
        <span class="file-open-dialog__title">{{ t('fsBrowser.title') }}</span>
      </div>

      <div class="file-open-dialog__dock-buttons row items-center no-wrap">
        <q-btn flat dense round size="sm" icon="picture_in_picture_alt" :color="isFloating ? 'primary' : undefined" @click="store.setWindowMode('floating')">
          <q-tooltip>{{ t('fsBrowser.dockFloat') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round size="sm" icon="border_left" :color="store.windowMode === 'left' ? 'primary' : undefined" @click="store.setWindowMode('left')">
          <q-tooltip>{{ t('fsBrowser.dockLeft') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round size="sm" icon="border_right" :color="store.windowMode === 'right' ? 'primary' : undefined" @click="store.setWindowMode('right')">
          <q-tooltip>{{ t('fsBrowser.dockRight') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round size="sm" icon="border_top" :color="store.windowMode === 'top' ? 'primary' : undefined" @click="store.setWindowMode('top')">
          <q-tooltip>{{ t('fsBrowser.dockTop') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round size="sm" icon="border_bottom" :color="store.windowMode === 'bottom' ? 'primary' : undefined" @click="store.setWindowMode('bottom')">
          <q-tooltip>{{ t('fsBrowser.dockBottom') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.cancel')" @click="close" />
      </div>
    </div>

    <q-separator />

    <!-- Not on the local host: the loopback file service is unreachable (FB-D2). -->
    <div v-if="!store.available" class="file-open-dialog__unavailable">
      <q-banner dense rounded class="bg-orange-1 text-orange-10">
        {{ store.error ?? t('fsBrowser.unavailable') }}
      </q-banner>
    </div>

    <template v-else>
      <!-- Toolbar: navigation + breadcrumbs + view/type controls. -->
      <div class="file-open-dialog__toolbar row items-center no-wrap q-gutter-xs">
        <q-btn flat dense round icon="arrow_upward" :disable="store.parentPath === null" :aria-label="t('fsBrowser.up')" @click="store.goUp()" />
        <q-btn flat dense round icon="refresh" :aria-label="t('fsBrowser.refresh')" @click="store.refresh()" />

        <div class="file-open-dialog__breadcrumbs row items-center no-wrap">
          <template v-for="(crumb, index) in store.breadcrumbs" :key="crumb.path">
            <q-icon v-if="index > 0" name="chevron_right" size="16px" class="file-open-dialog__crumb-sep" />
            <q-btn flat dense no-caps size="sm" :label="crumb.label" class="file-open-dialog__crumb" @click="store.openDir(crumb.path)" />
          </template>
        </div>

        <q-space />

        <q-btn-toggle
          :model-value="store.viewMode"
          flat
          dense
          toggle-color="primary"
          :options="viewOptions"
          @update:model-value="(v: FsViewMode) => (store.viewMode = v)"
        />
        <q-btn-toggle
          v-if="store.viewMode === 'icons'"
          :model-value="store.iconSize"
          flat
          dense
          toggle-color="primary"
          :options="iconSizeOptions"
          @update:model-value="(v: FsIconSize) => (store.iconSize = v)"
        />

        <q-btn-dropdown flat dense no-caps :label="store.typeFilter === 'supported' ? t('fsBrowser.typeSupported') : t('fsBrowser.typeAll')">
          <q-list dense>
            <q-item clickable v-close-popup @click="store.typeFilter = 'supported'">
              <q-item-section>{{ t('fsBrowser.typeSupported') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="store.typeFilter = 'all'">
              <q-item-section>{{ t('fsBrowser.typeAll') }}</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>

        <q-btn
          flat
          dense
          round
          :color="store.showHidden ? 'primary' : undefined"
          icon="visibility"
          :aria-label="t('fsBrowser.showHidden')"
          @click="store.showHidden = !store.showHidden"
        >
          <q-tooltip>{{ t('fsBrowser.showHidden') }}</q-tooltip>
        </q-btn>
      </div>

      <!-- Ctrl-S quick regexp filter (FB-D5). -->
      <div class="file-open-dialog__filter row items-center no-wrap">
        <q-input
          ref="filterInput"
          :model-value="store.filterText"
          dense
          outlined
          clearable
          class="col"
          :placeholder="t('fsBrowser.filterPlaceholder')"
          @update:model-value="(v: string | number | null) => (store.filterText = v === null ? '' : String(v))"
          @keydown.esc.stop.prevent="store.filterText = ''"
        >
          <template #prepend>
            <q-icon name="filter_alt" size="18px" />
          </template>
        </q-input>
      </div>

      <q-separator />

      <div class="file-open-dialog__body row no-wrap">
        <!-- Sidebar: roots + favorites (FB-D3 / FB-D10). -->
        <div class="file-open-dialog__sidebar">
          <q-list dense>
            <q-item-label header class="file-open-dialog__sidebar-header">{{ t('fsBrowser.roots') }}</q-item-label>
            <q-item
              v-for="root in store.roots"
              :key="root.id"
              clickable
              dense
              @click="store.openDir(root.path)"
            >
              <q-item-section avatar>
                <q-icon :name="rootIcon(root.kind)" size="20px" />
              </q-item-section>
              <q-item-section>{{ root.label }}</q-item-section>
            </q-item>

            <q-separator spaced />
            <q-item-label header class="file-open-dialog__sidebar-header row items-center no-wrap">
              <span>{{ t('fsBrowser.favorites') }}</span>
              <q-space />
              <q-btn flat dense round size="sm" icon="star" :aria-label="t('fsBrowser.addFavorite')" @click="addCurrentToFavorites">
                <q-tooltip>{{ t('fsBrowser.addFavorite') }}</q-tooltip>
              </q-btn>
            </q-item-label>
            <q-item v-if="store.favorites.length === 0" dense>
              <q-item-section class="text-grey-6 text-caption">{{ t('fsBrowser.noFavorites') }}</q-item-section>
            </q-item>
            <q-item
              v-for="fav in store.favorites"
              :key="fav.providerId + '::' + fav.path"
              clickable
              dense
              @click="activateFavorite(fav)"
            >
              <q-item-section avatar>
                <q-icon :name="fav.kind === 'dir' ? 'folder' : 'insert_drive_file'" size="18px" />
              </q-item-section>
              <q-item-section class="file-open-dialog__fav-label">{{ fav.label }}</q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.removeFavorite')" @click.stop="store.removeFavorite(fav.path, fav.providerId)" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <q-separator vertical />

        <!-- Main listing. -->
        <div class="file-open-dialog__main col" tabindex="0" @keydown="onListKeydown">
          <div v-if="store.loading" class="file-open-dialog__center">
            <q-spinner-hourglass color="primary" size="32px" />
          </div>
          <div v-else-if="store.error" class="file-open-dialog__center text-negative">{{ store.error }}</div>
          <div v-else-if="store.visibleEntries.length === 0" class="file-open-dialog__center text-grey-6">{{ t('fsBrowser.empty') }}</div>

          <!-- Table view (Total Commander style), FB-D4. -->
          <template v-else-if="store.viewMode === 'table'">
            <div class="file-open-dialog__thead row no-wrap">
              <div class="file-open-dialog__th file-open-dialog__col-name" @click="store.setSort('name')">
                {{ t('fsBrowser.colName') }}<q-icon v-if="store.sortKey === 'name'" :name="sortIcon" size="16px" />
              </div>
              <div class="file-open-dialog__th file-open-dialog__col-ext" @click="store.setSort('ext')">
                {{ t('fsBrowser.colExt') }}<q-icon v-if="store.sortKey === 'ext'" :name="sortIcon" size="16px" />
              </div>
              <div class="file-open-dialog__th file-open-dialog__col-size" @click="store.setSort('size')">
                {{ t('fsBrowser.colSize') }}<q-icon v-if="store.sortKey === 'size'" :name="sortIcon" size="16px" />
              </div>
              <div class="file-open-dialog__th file-open-dialog__col-date" @click="store.setSort('mtime')">
                {{ t('fsBrowser.colDate') }}<q-icon v-if="store.sortKey === 'mtime'" :name="sortIcon" size="16px" />
              </div>
            </div>
            <q-virtual-scroll
              ref="tableScroll"
              :items="store.visibleEntries"
              class="file-open-dialog__scroll"
              v-slot="{ item }"
            >
              <div
                :key="item.path"
                class="file-open-dialog__row row no-wrap items-center"
                :class="{ 'file-open-dialog__row--active': item.path === selectedPath, 'file-open-dialog__row--muted': !item.isDir && !isSupported(item) }"
                @click="select(item)"
                @dblclick="activate(item)"
              >
                <div class="file-open-dialog__col-name row items-center no-wrap">
                  <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" size="18px" class="file-open-dialog__row-icon" />
                  <span class="file-open-dialog__row-name">{{ item.name }}</span>
                </div>
                <div class="file-open-dialog__col-ext">{{ item.isDir ? '' : item.ext }}</div>
                <div class="file-open-dialog__col-size">{{ item.isDir ? '' : formatSize(item.size) }}</div>
                <div class="file-open-dialog__col-date">{{ formatDate(item.mtimeMs) }}</div>
              </div>
            </q-virtual-scroll>
          </template>

          <!-- List view (names only), FB-D4. -->
          <template v-else-if="store.viewMode === 'list'">
            <q-virtual-scroll
              ref="listScroll"
              :items="store.visibleEntries"
              class="file-open-dialog__scroll"
              v-slot="{ item }"
            >
              <div
                :key="item.path"
                class="file-open-dialog__row file-open-dialog__row--list row no-wrap items-center"
                :class="{ 'file-open-dialog__row--active': item.path === selectedPath, 'file-open-dialog__row--muted': !item.isDir && !isSupported(item) }"
                @click="select(item)"
                @dblclick="activate(item)"
              >
                <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" size="18px" class="file-open-dialog__row-icon" />
                <span class="file-open-dialog__row-name">{{ item.name }}</span>
              </div>
            </q-virtual-scroll>
          </template>

          <!-- Icon view (sizes sm/md/lg), FB-D4. Grid is not virtualized. -->
          <div v-else class="file-open-dialog__scroll file-open-dialog__icons" :class="`file-open-dialog__icons--${store.iconSize}`">
            <div
              v-for="item in store.visibleEntries"
              :key="item.path"
              class="file-open-dialog__tile column items-center"
              :class="{ 'file-open-dialog__tile--active': item.path === selectedPath, 'file-open-dialog__row--muted': !item.isDir && !isSupported(item) }"
              @click="select(item)"
              @dblclick="activate(item)"
            >
              <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" :size="iconTileSize" />
              <div class="file-open-dialog__tile-label">{{ item.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <q-separator />

      <div class="file-open-dialog__footer row items-center no-wrap">
        <div class="file-open-dialog__selected text-caption ellipsis col">{{ selectedPath ?? store.currentPath ?? '' }}</div>
        <q-btn flat :label="t('fsBrowser.cancel')" @click="close" />
        <q-btn color="primary" :label="t('fsBrowser.open')" :disable="!canOpen" @click="confirmOpen" />
      </div>
    </template>

    <!-- Resizers: a corner grip when floating, an edge grip when docked. -->
    <div v-if="isFloating" class="file-open-dialog__float-resizer" @pointerdown="onFloatResizePointerDown" />
    <div
      v-else
      class="file-open-dialog__dock-resizer"
      :class="`file-open-dialog__dock-resizer--${store.windowMode}`"
      @pointerdown="onDockResizePointerDown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QInput, QVirtualScroll } from 'quasar'
import type { AudioFileKind, FsEntry, FsRootKind } from '@protocol'
import { audioFileKindForExt, useFsBrowserStore, type FsFavorite, type FsIconSize, type FsViewMode } from '../stores/fs-browser'

const props = defineProps<{
  readonly modelValue: boolean
  readonly initialPath?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: [path: string, fileKind: AudioFileKind]
}>()

const { t } = useI18n()
const store = useFsBrowserStore()

const selectedPath = ref<string | null>(null)
const filterInput = ref<QInput | null>(null)
const tableScroll = ref<QVirtualScroll | null>(null)
const listScroll = ref<QVirtualScroll | null>(null)

const isFloating = computed<boolean>(() => store.windowMode === 'floating')
const modeClass = computed<string>(() =>
  isFloating.value ? 'file-open-dialog--floating' : `file-open-dialog--dock-${store.windowMode}`,
)
const rootStyle = computed<CSSProperties>(() => {
  if (isFloating.value) {
    const r = store.floatRect
    return { position: 'fixed', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: 3000 }
  }
  if (store.windowMode === 'left' || store.windowMode === 'right') {
    return { width: `${store.dockSize}px` }
  }
  return { height: `${store.dockSize}px` }
})

const viewOptions = computed(() => [
  { value: 'table', icon: 'table_chart' },
  { value: 'list', icon: 'view_list' },
  { value: 'icons', icon: 'grid_view' },
])
const iconSizeOptions = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
]

const sortIcon = computed(() => (store.sortDir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'))
const iconTileSize = computed(() => (store.iconSize === 'sm' ? '32px' : store.iconSize === 'lg' ? '72px' : '48px'))

const selectedEntry = computed<FsEntry | null>(() => {
  return store.visibleEntries.find((e) => e.path === selectedPath.value) ?? null
})

const canOpen = computed<boolean>(() => {
  const entry = selectedEntry.value
  return entry !== null && !entry.isDir && audioFileKindForExt(entry.ext) !== null
})

const isSupported = (entry: FsEntry): boolean => audioFileKindForExt(entry.ext) !== null

const rootIcon = (kind: FsRootKind): string => {
  switch (kind) {
    case 'drive': return 'storage'
    case 'home': return 'home'
    case 'known': return 'folder_special'
    case 'volume': return 'usb'
    case 'root': return 'dns'
  }
}

// FB4.4 (FB-D14): a distinct icon + colour per file kind, applied across all three views.
interface EntryVisual {
  readonly icon: string
  readonly color: string
}
const entryVisual = (entry: FsEntry): EntryVisual => {
  if (entry.isDir) {
    return { icon: 'folder', color: 'amber-8' }
  }
  switch (audioFileKindForExt(entry.ext)) {
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

const select = (entry: FsEntry): void => {
  selectedPath.value = entry.path
}

const activate = (entry: FsEntry): void => {
  if (entry.isDir) {
    selectedPath.value = null
    void store.openDir(entry.path)
    return
  }
  const kind = audioFileKindForExt(entry.ext)
  if (kind !== null) {
    emit('open', entry.path, kind)
    close()
  }
}

const confirmOpen = (): void => {
  const entry = selectedEntry.value
  if (entry !== null) {
    activate(entry)
  }
}

const addCurrentToFavorites = (): void => {
  const entry = selectedEntry.value
  if (entry !== null) {
    store.addFavorite({ path: entry.path, label: entry.name, kind: entry.isDir ? 'dir' : 'file' })
    return
  }
  if (store.currentPath !== null) {
    const label = store.breadcrumbs.at(-1)?.label ?? store.currentPath
    store.addFavorite({ path: store.currentPath, label, kind: 'dir' })
  }
}

const activateFavorite = (fav: FsFavorite): void => {
  if (fav.kind === 'dir') {
    void store.openDir(fav.path)
    return
  }
  const kind = audioFileKindForExt(fav.path.split('.').pop() ?? '')
  if (kind !== null) {
    emit('open', fav.path, kind)
    close()
  }
}

const close = (): void => {
  emit('update:modelValue', false)
}

// Init (discover the loopback server + open a start dir) whenever the panel becomes visible.
const initBrowser = (): void => {
  selectedPath.value = null
  void store.init(props.initialPath)
}
watch(() => props.modelValue, (open) => {
  if (open) {
    initBrowser()
  }
})
onMounted(() => {
  if (props.modelValue) {
    initBrowser()
  }
})

// Ctrl-S focuses the quick filter (TC habit), and never triggers the browser's Save dialog.
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    filterInput.value?.focus()
  }
}

// Keyboard navigation over the visible list (FB2.6).
const onListKeydown = (event: KeyboardEvent): void => {
  const items = store.visibleEntries
  if (items.length === 0) {
    return
  }
  const currentIndex = items.findIndex((e) => e.path === selectedPath.value)

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectAtIndex(currentIndex < items.length - 1 ? currentIndex + 1 : 0)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectAtIndex(currentIndex > 0 ? currentIndex - 1 : items.length - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const entry = currentIndex >= 0 ? items[currentIndex] : null
    if (entry !== undefined && entry !== null) {
      activate(entry)
    }
  } else if (event.key === 'Backspace') {
    event.preventDefault()
    void store.goUp()
  }
}

const selectAtIndex = (index: number): void => {
  const entry = store.visibleEntries[index]
  if (entry === undefined) {
    return
  }
  selectedPath.value = entry.path
  tableScroll.value?.scrollTo(index)
  listScroll.value?.scrollTo(index)
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

// Generic pointer-drag: wire window listeners until pointerup. onMove gets the live event.
const beginDrag = (onMove: (event: PointerEvent) => void): void => {
  const move = (event: PointerEvent): void => onMove(event)
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// FB4.2: drag the floating window by its title bar.
const onTitlePointerDown = (event: PointerEvent): void => {
  if (!isFloating.value) {
    return
  }
  event.preventDefault()
  const startX = event.clientX
  const startY = event.clientY
  const origin = { ...store.floatRect }
  beginDrag((moveEvent) => {
    store.setFloatRect({
      x: clamp(origin.x + (moveEvent.clientX - startX), 0, window.innerWidth - 80),
      y: clamp(origin.y + (moveEvent.clientY - startY), 0, window.innerHeight - 40),
    })
  })
}

// FB4.2: resize the floating window from its bottom-right grip.
const onFloatResizePointerDown = (event: PointerEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const startY = event.clientY
  const origin = { ...store.floatRect }
  beginDrag((moveEvent) => {
    store.setFloatRect({
      w: Math.max(460, origin.w + (moveEvent.clientX - startX)),
      h: Math.max(320, origin.h + (moveEvent.clientY - startY)),
    })
  })
}

// FB4.3: resize a docked panel by dragging its inner edge. The delta sign depends on the dock side.
const onDockResizePointerDown = (event: PointerEvent): void => {
  event.preventDefault()
  event.stopPropagation()
  const mode = store.windowMode
  const startX = event.clientX
  const startY = event.clientY
  const startSize = store.dockSize
  beginDrag((moveEvent) => {
    let delta = 0
    if (mode === 'left') delta = moveEvent.clientX - startX
    else if (mode === 'right') delta = startX - moveEvent.clientX
    else if (mode === 'top') delta = moveEvent.clientY - startY
    else if (mode === 'bottom') delta = startY - moveEvent.clientY
    store.setDockSize(startSize + delta)
  })
}
</script>

<style scoped lang="scss">
.file-open-dialog {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--q-dark-page, #fff);
  box-sizing: border-box;

  // Floating: a shadowed, rounded window; geometry comes from rootStyle.
  &--floating {
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  // Docked: fills the dock slot; a divider on the inner-facing edge.
  &--dock-left,
  &--dock-right,
  &--dock-top,
  &--dock-bottom {
    height: 100%;
    position: relative;
  }
  &--dock-left { order: 0; flex: 0 0 auto; border-right: 1px solid rgba(128, 128, 128, 0.35); }
  &--dock-right { order: 2; flex: 0 0 auto; border-left: 1px solid rgba(128, 128, 128, 0.35); }
  &--dock-top { order: 0; flex: 0 0 auto; width: 100%; border-bottom: 1px solid rgba(128, 128, 128, 0.35); }
  &--dock-bottom { order: 2; flex: 0 0 auto; width: 100%; border-top: 1px solid rgba(128, 128, 128, 0.35); }

  &__titlebar {
    flex: 0 0 auto;
    padding: 2px 4px 2px 8px;
    background: rgba(128, 128, 128, 0.1);
    user-select: none;
  }

  &__drag {
    min-width: 0;
    padding: 4px 0;
    &--active { cursor: move; }
  }

  &__title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__unavailable { padding: 12px; }

  &__toolbar,
  &__filter,
  &__footer {
    flex: 0 0 auto;
  }

  &__toolbar { padding: 4px 8px; }
  &__filter { padding: 0 8px 4px; }
  &__footer { padding: 6px 8px; gap: 8px; }

  &__breadcrumbs {
    overflow-x: auto;
    max-width: 40%;
  }

  &__crumb { min-height: 24px; }
  &__crumb-sep { opacity: 0.5; }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
  }

  &__sidebar {
    width: 200px;
    flex: 0 0 auto;
    overflow-y: auto;
  }

  &__sidebar-header { font-weight: 600; }

  &__fav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  &__center {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
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
    padding: 4px 8px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  &__col-name { flex: 1 1 auto; min-width: 0; }
  &__col-ext { flex: 0 0 56px; }
  &__col-size { flex: 0 0 88px; text-align: right; }
  &__col-date { flex: 0 0 132px; }

  &__row {
    padding: 2px 8px;
    cursor: pointer;

    &:hover { background: rgba(128, 128, 128, 0.12); }
    &--active { background: rgba(25, 118, 210, 0.25); }
    &--muted { opacity: 0.5; }
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

    &--sm .file-open-dialog__tile { width: 72px; }
    &--md .file-open-dialog__tile { width: 104px; }
    &--lg .file-open-dialog__tile { width: 140px; }
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

  &__selected {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // Resizers.
  &__float-resizer {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
  }

  &__dock-resizer {
    position: absolute;
    z-index: 5;
    &--left { top: 0; bottom: 0; right: 0; width: 6px; cursor: col-resize; }
    &--right { top: 0; bottom: 0; left: 0; width: 6px; cursor: col-resize; }
    &--top { left: 0; right: 0; bottom: 0; height: 6px; cursor: row-resize; }
    &--bottom { left: 0; right: 0; top: 0; height: 6px; cursor: row-resize; }
  }
}
</style>
