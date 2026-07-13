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

      <!-- FB4.3-refine 1: all dock modes collapsed under one icon + menu to cut visual noise. -->
      <q-btn flat dense round size="sm" :icon="modeIcon" class="file-open-dialog__dock-menu-btn">
        <q-tooltip>{{ t('fsBrowser.dockMenu') }}</q-tooltip>
        <q-menu auto-close>
          <q-list dense style="min-width: 160px">
            <q-item
              v-for="opt in dockOptions"
              :key="opt.mode"
              clickable
              :active="store.windowMode === opt.mode"
              @click="store.setWindowMode(opt.mode)"
            >
              <q-item-section avatar><q-icon :name="opt.icon" /></q-item-section>
              <q-item-section>{{ t(opt.label) }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
      <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.cancel')" @click="close" />
    </div>

    <q-separator />

    <!-- Not on the local host: the loopback file service is unreachable (FB-D2). -->
    <div v-if="!store.available" class="file-open-dialog__unavailable">
      <q-banner dense rounded class="bg-orange-1 text-orange-10">
        {{ store.error ?? t('fsBrowser.unavailable') }}
      </q-banner>
    </div>

    <template v-else>
      <!-- FB4.3-refine 2: left/right dock -> single-column accordion (File list / Locations /
           Favorites); every other mode keeps the two-pane sidebar + list. The nav toolbar + view
           controls + filter now live INSIDE the file-list panel (FsEntryList), FB4-refine 2/3/4. -->
      <div v-if="isColumn" class="file-open-dialog__body file-open-dialog__body--column">
        <q-expansion-item
          default-opened
          dense
          :label="t('fsBrowser.sectionFiles')"
          class="file-open-dialog__acc file-open-dialog__acc--grow"
        >
          <FsEntryList
            ref="fsEntryListRef"
            :selected-path="selectedPath"
            @select="select"
            @activate="activate"
          />
        </q-expansion-item>

        <q-expansion-item dense :label="t('fsBrowser.roots')" class="file-open-dialog__acc">
          <div class="file-open-dialog__acc-body">
            <q-list dense>
              <q-item v-for="root in store.roots" :key="root.id" clickable dense @click="navigateToDir(root.path)">
                <q-item-section avatar><q-icon :name="rootIcon(root.kind)" size="20px" /></q-item-section>
                <q-item-section>{{ root.label }}</q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>

        <q-expansion-item dense class="file-open-dialog__acc">
          <template #header>
            <q-item-section>{{ t('fsBrowser.favorites') }}</q-item-section>
            <q-item-section side>
              <q-btn flat dense round size="sm" icon="star" :aria-label="t('fsBrowser.addFavorite')" @click.stop="addCurrentToFavorites">
                <q-tooltip>{{ t('fsBrowser.addFavorite') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </template>
          <div class="file-open-dialog__acc-body">
            <q-list dense>
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
                <q-item-section avatar><q-icon :name="fav.kind === 'dir' ? 'folder' : 'insert_drive_file'" size="18px" /></q-item-section>
                <q-item-section class="file-open-dialog__fav-label">{{ fav.label }}</q-item-section>
                <q-item-section side>
                  <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.removeFavorite')" @click.stop="store.removeFavorite(fav.path, fav.providerId)" />
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>
      </div>

      <div v-else class="file-open-dialog__body row no-wrap">
        <div class="file-open-dialog__sidebar">
          <q-list dense>
            <q-item-label header class="file-open-dialog__sidebar-header">{{ t('fsBrowser.roots') }}</q-item-label>
            <q-item v-for="root in store.roots" :key="root.id" clickable dense @click="navigateToDir(root.path)">
              <q-item-section avatar><q-icon :name="rootIcon(root.kind)" size="20px" /></q-item-section>
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
              <q-item-section avatar><q-icon :name="fav.kind === 'dir' ? 'folder' : 'insert_drive_file'" size="18px" /></q-item-section>
              <q-item-section class="file-open-dialog__fav-label">{{ fav.label }}</q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.removeFavorite')" @click.stop="store.removeFavorite(fav.path, fav.providerId)" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <q-separator vertical />

        <FsEntryList
          ref="fsEntryListRef"
          :selected-path="selectedPath"
          @select="select"
          @activate="activate"
        />
      </div>

      <q-separator />

      <div class="file-open-dialog__footer row items-center no-wrap">
        <q-space />
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
import type { AudioFileKind, FsEntry, FsRootKind } from '@protocol'
import { audioFileKindForExt, useFsBrowserStore, type FsFavorite, type FsWindowMode } from '../stores/fs-browser'
import FsEntryList from './FsEntryList.vue'

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
// FB5.1: the tree view can select a file outside the current dir, so the entry may not be in
// store.visibleEntries — remember the emitted entry directly (flat views still fall back to lookup).
const selectedEntryRef = ref<FsEntry | null>(null)

// FB5.1 fix: navigating to a folder must reveal it IN the tree when tree mode is active (a flat
// store.openDir has no visible effect there); FsEntryList owns the tree state and exposes revealPath.
interface FsEntryListExposed {
  revealPath: (path: string) => Promise<void>
}
const fsEntryListRef = ref<FsEntryListExposed | null>(null)

const navigateToDir = (path: string): void => {
  if (fsEntryListRef.value !== null) {
    void fsEntryListRef.value.revealPath(path)
  } else {
    void store.openDir(path)
  }
}

const isFloating = computed<boolean>(() => store.windowMode === 'floating')
const isColumn = computed<boolean>(() => store.windowMode === 'left' || store.windowMode === 'right')
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

interface DockOption {
  readonly mode: FsWindowMode
  readonly icon: string
  readonly label: string
}
const dockOptions: readonly DockOption[] = [
  { mode: 'floating', icon: 'picture_in_picture_alt', label: 'fsBrowser.dockFloat' },
  { mode: 'left', icon: 'border_left', label: 'fsBrowser.dockLeft' },
  { mode: 'right', icon: 'border_right', label: 'fsBrowser.dockRight' },
  { mode: 'top', icon: 'border_top', label: 'fsBrowser.dockTop' },
  { mode: 'bottom', icon: 'border_bottom', label: 'fsBrowser.dockBottom' },
]
const modeIcon = computed<string>(() => dockOptions.find((o) => o.mode === store.windowMode)?.icon ?? 'picture_in_picture_alt')

const selectedEntry = computed<FsEntry | null>(() => {
  if (selectedEntryRef.value !== null && selectedEntryRef.value.path === selectedPath.value) {
    return selectedEntryRef.value
  }
  return store.visibleEntries.find((e) => e.path === selectedPath.value) ?? null
})

const canOpen = computed<boolean>(() => {
  const entry = selectedEntry.value
  return entry !== null && !entry.isDir && audioFileKindForExt(entry.ext) !== null
})

const rootIcon = (kind: FsRootKind): string => {
  switch (kind) {
    case 'drive': return 'storage'
    case 'home': return 'home'
    case 'known': return 'folder_special'
    case 'volume': return 'usb'
    case 'root': return 'dns'
  }
}

const select = (entry: FsEntry): void => {
  selectedPath.value = entry.path
  selectedEntryRef.value = entry
}

const activate = (entry: FsEntry): void => {
  if (entry.isDir) {
    selectedPath.value = null
    selectedEntryRef.value = null
    void store.openDir(entry.path)
    return
  }
  const kind = audioFileKindForExt(entry.ext)
  if (kind !== null) {
    emit('open', entry.path, kind)
    closeAfterOpen()
  }
}

// Req: keep a DOCKED panel open after opening a file; only the floating window auto-closes.
const closeAfterOpen = (): void => {
  if (isFloating.value) {
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
    navigateToDir(fav.path)
    return
  }
  const kind = audioFileKindForExt(fav.path.split('.').pop() ?? '')
  if (kind !== null) {
    emit('open', fav.path, kind)
    closeAfterOpen()
  }
}

const close = (): void => {
  emit('update:modelValue', false)
}

// Init (discover the loopback server + open a start dir) whenever the panel becomes visible.
const initBrowser = (): void => {
  selectedPath.value = null
  selectedEntryRef.value = null
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

// Ctrl-S summons the quick filter (TC habit); FsEntryList focuses it when it appears. Never lets
// the browser's Save dialog through.
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    store.setFilterVisible(true)
  }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

// Generic pointer-drag: wire window listeners until pointerup.
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

  &--floating {
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

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

  &__footer {
    flex: 0 0 auto;
    padding: 6px 8px;
    gap: 8px;
  }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
  }

  // Single-column accordion for the left/right dock (FB4.3-refine 2).
  &__body--column {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  &__acc {
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);

    &--grow {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;

      :deep(.q-expansion-item__container) { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
      :deep(.q-expansion-item__content) { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    }
  }

  &__acc-body {
    max-height: 30vh;
    overflow-y: auto;
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
