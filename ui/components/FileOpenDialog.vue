<template>
  <!-- PW1.2 (PW-D3/PW-D4): the file-open dialog is now a thin composition of the universal
       PanelWindow chrome (@panel, extracted from the FB4.x implementation) and the FileOpenPanel
       content. AudioPage still teleports it to <body> when floating and hosts it as a flex child
       when docked; it renders only while the panel state is open (v-if on the host side). -->
  <PanelWindow :state="panel" :title="t('fsBrowser.title')" icon="folder_open" @keydown="onKeydown">
    <FileOpenPanel
      :column="isColumn"
      :initial-path="initialPath"
      @open="onOpen"
      @close="panel.open = false"
    />
  </PanelWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AudioFileKind } from '@protocol'
import PanelWindow from '@panel/PanelWindow.vue'
import { useFileOpenPanelState } from '../stores/file-open-panel'
import { useFsBrowserStore } from '../stores/fs-browser'
import FileOpenPanel from './FileOpenPanel.vue'

const props = defineProps<{
  readonly initialPath?: string
}>()

const emit = defineEmits<{
  open: [path: string, fileKind: AudioFileKind]
}>()

const { t } = useI18n()
const store = useFsBrowserStore()
const panel = useFileOpenPanelState()

// FB4.3-refine 2: the narrow left/right dock uses the single-column accordion layout.
const isColumn = computed<boolean>(() => panel.mode === 'left' || panel.mode === 'right')

// Req: keep a DOCKED panel open after opening a file; only the floating window auto-closes.
const onOpen = (path: string, fileKind: AudioFileKind): void => {
  emit('open', path, fileKind)
  if (panel.mode === 'floating') {
    panel.open = false
  }
}

// Ctrl-S summons the quick filter (TC habit); FsEntryList focuses it when it appears. Never lets
// the browser's Save dialog through. Lands on PanelWindow's root via attrs fallthrough.
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    store.setFilterVisible(true)
  }
}
</script>
