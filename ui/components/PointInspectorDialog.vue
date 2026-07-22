<template>
  <!-- PI3.3 (point-inspector-panel): thin composition of the universal PanelWindow chrome (@panel) +
       the «Параметры точки» content. AudioPage teleports it to <body> when floating and hosts it as a
       flex child when docked; it renders only while the panel state is open (v-if host-side).
       Detach is ON (remote-control, PI-D8): in-window the slot renders PointInspectorPanel (binds the
       shared singletons directly); detached, the panel lives in a child OS window running
       PointInspectorRemote (PW-D11: no child-side state) — the parent pushes the live snapshot via
       :bridge-state and applies bridged actions via @panel-event. Undo/redo + the title-count live in
       the view/title now, so the titlebar carries only the standard chrome. -->
  <PanelWindow
    :state="panel"
    :title="title"
    icon="tune"
    :bridge-state="snapshot"
    @panel-event="onBridgedEvent"
    @close="onClose"
  >
    <PointInspectorPanel />
  </PanelWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelWindow from '@panel/PanelWindow.vue'

import PointInspectorPanel from './PointInspectorPanel.vue'
import { usePointInspectorPanelState } from '../stores/point-inspector-panel'
import { usePointInspector } from '../composables/use-point-inspector'
import { usePointInspectorSnapshot } from '../composables/use-point-inspector-snapshot'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { applyPointInspectorAction, type PointInspectorApi } from '../composables/point-inspector-actions'
import type { PointInspectorAction } from '../composables/point-inspector-model'

const { t } = useI18n()
const panel = usePointInspectorPanelState()
const gtracks = useSharedGtrackLanes()
const inspector = usePointInspector()

// PW5.7: the live snapshot pushed to the DETACHED child window (no-op while in-window — the child
// bridge is null; the slot's PointInspectorPanel renders the same data directly). Any mutation of the
// shared singletons recomputes it, and PanelWindow forwards the change to the child.
const snapshot = usePointInspectorSnapshot()

// PI-D3: single/placeholder show «Параметры точки» (+ the voice name when a point is targeted); the
// multi-select table shows the selection count. inspectorMode drives which is live.
const title = computed<string>(() => {
  if (inspector.inspectorMode.value === 'table') {
    return t('audio.gtrackMultiSelected', { count: gtracks.multiSelection.value.size })
  }
  const base = t('audio.gtrackPointDialog')
  return inspector.pointDialogVoiceName.value !== '' ? `${base} — ${inspector.pointDialogVoiceName.value}` : base
})

// PW5.7c: an action performed in the DETACHED child arrives over the bridge and is applied to the
// authoritative singletons HERE (the in-window PointInspectorPanel is unmounted while detached) — the
// same applier/commit methods the in-window adapter uses.
const api: PointInspectorApi = {
  commitForm: inspector.commitForm,
  setAutosave: inspector.setAutosave,
  deleteCurrentPoint: inspector.deleteCurrentPointFromDialog,
  addPointRight: inspector.addPointToRight,
  undo: inspector.undoWithFocus,
  redo: inspector.redoWithFocus,
  commitRow: inspector.commitRow,
  commitAllRows: inspector.commitAllRows,
  removeChecked: inspector.removeChecked,
}
function onBridgedEvent(name: string, payload: readonly unknown[]): void {
  if (name !== 'action') return
  applyPointInspectorAction(payload[0] as PointInspectorAction, api)
}

// PI-D7: closing the panel is a user action; clear the selection/target so a later reopen starts from
// the placeholder rather than a stale point. PanelWindow already set panel.open = false.
function onClose(): void {
  inspector.closeInspector()
}
</script>
