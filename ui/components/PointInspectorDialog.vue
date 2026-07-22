<template>
  <!-- PI2.3 (point-inspector-panel): thin composition of the universal PanelWindow chrome (@panel) +
       the «Параметры точки» content. AudioPage teleports it to <body> when floating and hosts it as a
       flex child when docked; it renders only while the panel state is open (v-if host-side).
       Detach is OFF in Phase 2 (PI-D2): a separate app instance has no loaded gnaural file and its own
       gtracks singleton, so a true detached inspector needs the remote-control snapshot/bridge pattern
       (Phase 3). The title follows inspectorMode (PI-D3); undo/redo live in the titlebar-actions slot. -->
  <PanelWindow
    :state="panel"
    :title="title"
    icon="tune"
    :allow-detach="false"
    @close="onClose"
  >
    <template #titlebar-actions>
      <!-- GT10.8 (owner req. 52): undo/redo right in the inspector (model history has all steps). -->
      <q-btn
        flat dense round size="sm" icon="undo" :disable="!gtracks.canUndo.value"
        :aria-label="t('audio.gtrackUndo')"
        @click="undoWithFocus()"
      >
        <app-tooltip>{{ t('audio.gtrackUndo') }}</app-tooltip>
      </q-btn>
      <q-btn
        flat dense round size="sm" icon="redo" :disable="!gtracks.canRedo.value"
        :aria-label="t('audio.gtrackRedo')"
        @click="redoWithFocus()"
      >
        <app-tooltip>{{ t('audio.gtrackRedo') }}</app-tooltip>
      </q-btn>
    </template>

    <PointInspectorPanel />
  </PanelWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelWindow from '@panel/PanelWindow.vue'
import AppTooltip from '@tooltip/AppTooltip.vue'

import PointInspectorPanel from './PointInspectorPanel.vue'
import { usePointInspectorPanelState } from '../stores/point-inspector-panel'
import { usePointInspector } from '../composables/use-point-inspector'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'

const { t } = useI18n()
const panel = usePointInspectorPanelState()
const gtracks = useSharedGtrackLanes()
const { inspectorMode, pointDialogVoiceName, undoWithFocus, redoWithFocus, closeInspector } = usePointInspector()

// PI-D3: single/placeholder show «Параметры точки» (+ the voice name when a point is targeted); the
// multi-select table shows the selection count. inspectorMode drives which is live.
const title = computed<string>(() => {
  if (inspectorMode.value === 'table') {
    return t('audio.gtrackMultiSelected', { count: gtracks.multiSelection.value.size })
  }
  const base = t('audio.gtrackPointDialog')
  return pointDialogVoiceName.value !== '' ? `${base} — ${pointDialogVoiceName.value}` : base
})

// PI-D7: closing the panel is a user action; clear the selection/target so a later reopen starts from
// the placeholder rather than a stale point. PanelWindow already set panel.open = false.
function onClose(): void {
  closeInspector()
}
</script>
