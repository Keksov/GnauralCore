<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="onDialogModel"
    @show="onShow"
  >
    <q-card class="file-open-dialog" @keydown="onKeydown">
      <q-card-section class="file-open-dialog__header row items-center no-wrap">
        <div class="text-h6">{{ t('fsBrowser.title') }}</div>
        <q-space />
        <q-btn flat round dense icon="close" :aria-label="t('fsBrowser.cancel')" @click="close" />
      </q-card-section>

      <q-separator />

      <!-- Not on the local host: the loopback file service is unreachable (FB-D2). -->
      <q-card-section v-if="!store.available" class="file-open-dialog__unavailable">
        <q-banner dense rounded class="bg-orange-1 text-orange-10">
          {{ store.error ?? t('fsBrowser.unavailable') }}
        </q-banner>
      </q-card-section>

      <template v-else>
        <!-- Toolbar: navigation + breadcrumbs + view/type controls. -->
        <q-card-section class="file-open-dialog__toolbar row items-center no-wrap q-gutter-xs">
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
        </q-card-section>

        <!-- Ctrl-S quick regexp filter (FB-D5). -->
        <q-card-section class="file-open-dialog__filter row items-center no-wrap q-pt-none">
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
        </q-card-section>

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
                    <q-icon :name="entryIcon(item)" size="18px" class="file-open-dialog__row-icon" />
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
                  <q-icon :name="entryIcon(item)" size="18px" class="file-open-dialog__row-icon" />
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
                <q-icon :name="entryIcon(item)" :size="iconTileSize" />
                <div class="file-open-dialog__tile-label">{{ item.name }}</div>
              </div>
            </div>
          </div>
        </div>

        <q-separator />

        <q-card-actions class="file-open-dialog__footer row items-center no-wrap">
          <div class="file-open-dialog__selected text-caption ellipsis col">{{ selectedPath ?? store.currentPath ?? '' }}</div>
          <q-btn flat :label="t('fsBrowser.cancel')" @click="close" />
          <q-btn color="primary" :label="t('fsBrowser.open')" :disable="!canOpen" @click="confirmOpen" />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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

const viewOptions = computed(() => [
  { value: 'table', icon: 'table_chart', slot: 'table' },
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

const entryIcon = (entry: FsEntry): string => {
  if (entry.isDir) {
    return 'folder'
  }
  return isSupported(entry) ? 'music_note' : 'insert_drive_file'
}

const numberFormat = new Intl.NumberFormat()
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

void numberFormat // reserved for future numeric columns

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

const onDialogModel = (value: boolean): void => {
  emit('update:modelValue', value)
}

const onShow = (): void => {
  selectedPath.value = null
  void store.init(props.initialPath)
}

// Ctrl-S focuses the quick filter (TC habit), and never triggers the browser's Save dialog.
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    filterInput.value?.focus()
  }
}

// Keyboard navigation over the visible list (FB-D... FB2.6).
const onListKeydown = (event: KeyboardEvent): void => {
  const items = store.visibleEntries
  if (items.length === 0) {
    return
  }
  const currentIndex = items.findIndex((e) => e.path === selectedPath.value)

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
    selectAtIndex(next)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
    selectAtIndex(prev)
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
</script>

<style scoped lang="scss">
.file-open-dialog {
  width: 900px;
  max-width: 95vw;
  height: 80vh;
  display: flex;
  flex-direction: column;

  &__header,
  &__toolbar,
  &__filter,
  &__footer {
    flex: 0 0 auto;
  }

  &__breadcrumbs {
    overflow-x: auto;
    max-width: 40%;
  }

  &__crumb {
    min-height: 24px;
  }

  &__crumb-sep {
    opacity: 0.5;
  }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
  }

  &__sidebar {
    width: 220px;
    flex: 0 0 auto;
    overflow-y: auto;
  }

  &__sidebar-header {
    font-weight: 600;
  }

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
  &__col-ext { flex: 0 0 64px; }
  &__col-size { flex: 0 0 96px; text-align: right; }
  &__col-date { flex: 0 0 140px; }

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
}
</style>
