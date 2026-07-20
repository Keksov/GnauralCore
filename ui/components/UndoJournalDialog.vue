<template>
  <!-- UG3.1 (undo-global-journal, UG-D5): «Журнал операций» — the standard dockable/floating @panel
       (100% reuse, no bespoke dialog). Detach is OFF: like «Список треков» before PW5.7, a separate
       app instance would hold its own gtracks singleton and show a foreign, empty history; a true
       detached version needs the remote-control snapshot/bridge pattern — future work if asked. -->
  <PanelWindow
    :state="panel"
    :title="t('audio.undoJournalPanel')"
    icon="history"
    :allow-detach="false"
  >
    <UndoJournalPanel />
  </PanelWindow>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PanelWindow from '@panel/PanelWindow.vue'

import UndoJournalPanel from './UndoJournalPanel.vue'
import { useUndoJournalPanelState } from '../stores/undo-journal-panel'

const { t } = useI18n()
const panel = useUndoJournalPanelState()
</script>
