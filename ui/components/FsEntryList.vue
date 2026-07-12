<template>
  <!-- FB4.3-refine: the file listing extracted so it can be reused in both the two-pane layout and
       the single-column accordion (left/right dock). Purely presentational — selection lives in the
       parent; this emits select/activate/sort/nav-up. -->
  <div class="fs-entry-list" tabindex="0" @keydown="onKeydown">
    <div v-if="loading" class="fs-entry-list__center">
      <q-spinner-hourglass color="primary" size="32px" />
    </div>
    <div v-else-if="error" class="fs-entry-list__center text-negative">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="fs-entry-list__center text-grey-6">{{ t('fsBrowser.empty') }}</div>

    <!-- Table view (Total Commander style). -->
    <template v-else-if="viewMode === 'table'">
      <div class="fs-entry-list__thead row no-wrap">
        <div class="fs-entry-list__th fs-entry-list__col-name" @click="emit('sort', 'name')">
          {{ t('fsBrowser.colName') }}<q-icon v-if="sortKey === 'name'" :name="sortIcon" size="16px" />
        </div>
        <div class="fs-entry-list__th fs-entry-list__col-ext" @click="emit('sort', 'ext')">
          {{ t('fsBrowser.colExt') }}<q-icon v-if="sortKey === 'ext'" :name="sortIcon" size="16px" />
        </div>
        <div class="fs-entry-list__th fs-entry-list__col-size" @click="emit('sort', 'size')">
          {{ t('fsBrowser.colSize') }}<q-icon v-if="sortKey === 'size'" :name="sortIcon" size="16px" />
        </div>
        <div class="fs-entry-list__th fs-entry-list__col-date" @click="emit('sort', 'mtime')">
          {{ t('fsBrowser.colDate') }}<q-icon v-if="sortKey === 'mtime'" :name="sortIcon" size="16px" />
        </div>
      </div>
      <q-virtual-scroll ref="tableScroll" :items="entries" class="fs-entry-list__scroll" v-slot="{ item }">
        <div
          :key="item.path"
          class="fs-entry-list__row row no-wrap items-center"
          :class="{ 'fs-entry-list__row--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item) }"
          @click="emit('select', item)"
          @dblclick="emit('activate', item)"
        >
          <div class="fs-entry-list__col-name row items-center no-wrap">
            <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" size="18px" class="fs-entry-list__row-icon" />
            <span class="fs-entry-list__row-name">{{ item.name }}</span>
          </div>
          <div class="fs-entry-list__col-ext">{{ item.isDir ? '' : item.ext }}</div>
          <div class="fs-entry-list__col-size">{{ item.isDir ? '' : formatSize(item.size) }}</div>
          <div class="fs-entry-list__col-date">{{ formatDate(item.mtimeMs) }}</div>
        </div>
      </q-virtual-scroll>
    </template>

    <!-- List view (names only). -->
    <template v-else-if="viewMode === 'list'">
      <q-virtual-scroll ref="listScroll" :items="entries" class="fs-entry-list__scroll" v-slot="{ item }">
        <div
          :key="item.path"
          class="fs-entry-list__row fs-entry-list__row--list row no-wrap items-center"
          :class="{ 'fs-entry-list__row--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item) }"
          @click="emit('select', item)"
          @dblclick="emit('activate', item)"
        >
          <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" size="18px" class="fs-entry-list__row-icon" />
          <span class="fs-entry-list__row-name">{{ item.name }}</span>
        </div>
      </q-virtual-scroll>
    </template>

    <!-- Icon view (sm/md/lg). Not virtualized. -->
    <div v-else class="fs-entry-list__scroll fs-entry-list__icons" :class="`fs-entry-list__icons--${iconSize}`">
      <div
        v-for="item in entries"
        :key="item.path"
        class="fs-entry-list__tile column items-center"
        :class="{ 'fs-entry-list__tile--active': item.path === selectedPath, 'fs-entry-list__row--muted': !item.isDir && !isSupported(item) }"
        @click="emit('select', item)"
        @dblclick="emit('activate', item)"
      >
        <q-icon :name="entryVisual(item).icon" :color="entryVisual(item).color" :size="iconTileSize" />
        <div class="fs-entry-list__tile-label">{{ item.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QVirtualScroll } from 'quasar'
import type { FsEntry } from '@protocol'
import { audioFileKindForExt, type FsIconSize, type FsSortDir, type FsSortKey, type FsViewMode } from '../stores/fs-browser'

const props = defineProps<{
  readonly entries: readonly FsEntry[]
  readonly loading: boolean
  readonly error: string | null
  readonly viewMode: FsViewMode
  readonly iconSize: FsIconSize
  readonly sortKey: FsSortKey
  readonly sortDir: FsSortDir
  readonly selectedPath: string | null
}>()

const emit = defineEmits<{
  select: [entry: FsEntry]
  activate: [entry: FsEntry]
  sort: [key: FsSortKey]
  'nav-up': []
}>()

const { t } = useI18n()

const tableScroll = ref<QVirtualScroll | null>(null)
const listScroll = ref<QVirtualScroll | null>(null)

const sortIcon = computed(() => (props.sortDir === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down'))
const iconTileSize = computed(() => (props.iconSize === 'sm' ? '32px' : props.iconSize === 'lg' ? '72px' : '48px'))

const isSupported = (entry: FsEntry): boolean => audioFileKindForExt(entry.ext) !== null

// FB4.4 (FB-D14): a distinct icon + colour per file kind.
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

const onKeydown = (event: KeyboardEvent): void => {
  const items = props.entries
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
    emit('nav-up')
  }
}

const selectAtIndex = (index: number): void => {
  const entry = props.entries[index]
  if (entry === undefined) {
    return
  }
  emit('select', entry)
  tableScroll.value?.scrollTo(index)
  listScroll.value?.scrollTo(index)
}
</script>

<style scoped lang="scss">
.fs-entry-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;

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
