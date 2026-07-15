<template>
  <!-- PW1.2 (PW-D4): the file-open panel CONTENT — everything between the window chrome's
       titlebar and its resizers. Hosted by FileOpenDialog (inside PanelWindow) in the main
       window, and by PanelHostPage in a detached child window (PW2.x). No window logic here:
       opening/closing decisions are the host's (emits open/close). -->
  <div class="file-open-panel">
    <!-- Not on the local host: the loopback file service is unreachable (FB-D2). -->
    <div v-if="!store.available" class="file-open-panel__unavailable">
      <q-banner dense rounded class="bg-orange-1 text-orange-10">
        {{ store.error ?? t('fsBrowser.unavailable') }}
      </q-banner>
    </div>

    <template v-else>
      <!-- FB4.3-refine 2: narrow (left/right dock) -> single-column accordion (File list /
           Locations / Favorites); wide -> two-pane sidebar + list. The host picks via :column. -->
      <div v-if="column" class="file-open-panel__body file-open-panel__body--column">
        <q-expansion-item
          default-opened
          dense
          :label="t('fsBrowser.sectionFiles')"
          class="file-open-panel__acc file-open-panel__acc--grow"
        >
          <FsEntryList
            :selected-path="selectedPath"
            @select="select"
            @activate="activate"
          />
        </q-expansion-item>

        <!-- In tree mode the roots are already the top of the tree, so this list is redundant. -->
        <q-expansion-item v-if="store.viewMode !== 'tree'" dense :label="t('fsBrowser.roots')" class="file-open-panel__acc">
          <div class="file-open-panel__acc-body">
            <q-list dense>
              <q-item v-for="root in store.roots" :key="root.id" clickable dense @click="navigateToDir(root.path)">
                <q-item-section avatar><q-icon :name="rootIcon(root.kind)" size="20px" /></q-item-section>
                <q-item-section>{{ root.label }}</q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>

        <q-expansion-item dense class="file-open-panel__acc">
          <template #header>
            <q-item-section>{{ t('fsBrowser.favorites') }}</q-item-section>
            <q-item-section side>
              <q-btn flat dense round size="sm" icon="star" :aria-label="t('fsBrowser.addFavorite')" @click.stop="addCurrentToFavorites">
                <app-tooltip>{{ t('fsBrowser.addFavorite') }}</app-tooltip>
              </q-btn>
            </q-item-section>
          </template>
          <div class="file-open-panel__acc-body">
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
                <q-item-section class="file-open-panel__fav-label">{{ fav.label }}</q-item-section>
                <q-item-section side>
                  <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.removeFavorite')" @click.stop="store.removeFavorite(fav.path, fav.providerId)" />
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-expansion-item>
      </div>

      <div v-else class="file-open-panel__body row no-wrap">
        <div class="file-open-panel__sidebar">
          <q-list dense>
            <!-- In tree mode the roots are already the top of the tree, so this list is redundant. -->
            <template v-if="store.viewMode !== 'tree'">
              <q-item-label header class="file-open-panel__sidebar-header">{{ t('fsBrowser.roots') }}</q-item-label>
              <q-item v-for="root in store.roots" :key="root.id" clickable dense @click="navigateToDir(root.path)">
                <q-item-section avatar><q-icon :name="rootIcon(root.kind)" size="20px" /></q-item-section>
                <q-item-section>{{ root.label }}</q-item-section>
              </q-item>

              <q-separator spaced />
            </template>
            <q-item-label header class="file-open-panel__sidebar-header row items-center no-wrap">
              <span>{{ t('fsBrowser.favorites') }}</span>
              <q-space />
              <q-btn flat dense round size="sm" icon="star" :aria-label="t('fsBrowser.addFavorite')" @click="addCurrentToFavorites">
                <app-tooltip>{{ t('fsBrowser.addFavorite') }}</app-tooltip>
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
              <q-item-section class="file-open-panel__fav-label">{{ fav.label }}</q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="close" :aria-label="t('fsBrowser.removeFavorite')" @click.stop="store.removeFavorite(fav.path, fav.providerId)" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <q-separator vertical />

        <FsEntryList
          :selected-path="selectedPath"
          @select="select"
          @activate="activate"
        />
      </div>

      <q-separator />

      <div class="file-open-panel__footer row items-center no-wrap">
        <q-space />
        <q-btn flat :label="t('fsBrowser.cancel')" @click="emit('close')" />
        <q-btn color="primary" :label="t('fsBrowser.open')" :disable="!canOpen" @click="confirmOpen" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AudioFileKind, FsEntry, FsRootKind } from '@protocol'
import { audioFileKindForExt, useFsBrowserStore, type FsFavorite } from '../stores/fs-browser'
import FsEntryList from './FsEntryList.vue'
import AppTooltip from '@tooltip/AppTooltip.vue'

const props = defineProps<{
  /** Narrow single-column (accordion) layout — the host sets it for left/right docks. */
  readonly column?: boolean
  readonly initialPath?: string
}>()

const emit = defineEmits<{
  open: [path: string, fileKind: AudioFileKind]
  close: []
}>()

const { t } = useI18n()
const store = useFsBrowserStore()

const selectedPath = ref<string | null>(null)
// FB5.1: the tree view can select a file outside the current dir, so the entry may not be in
// store.visibleEntries — remember the emitted entry directly (flat views still fall back to lookup).
const selectedEntryRef = ref<FsEntry | null>(null)

// FB5.1 fix: in tree mode a folder click must reveal that branch in the tree — request it via the
// store (FsEntryList watches revealSignal). In the flat views it's a normal openDir.
const navigateToDir = (path: string): void => {
  if (store.viewMode === 'tree') {
    store.requestReveal(path)
  } else {
    void store.openDir(path)
  }
}

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
  }
}

// Init (discover the loopback server + open a start dir) on mount: hosts render the panel only
// while it is open (v-if), so every show is a fresh mount.
onMounted(() => {
  selectedPath.value = null
  selectedEntryRef.value = null
  void store.init(props.initialPath)
})
</script>

<style scoped lang="scss">
.file-open-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;

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
}
</style>
