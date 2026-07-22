<template>
  <!-- PI3.2 (point-inspector-panel): the IN-WINDOW adapter. Builds the snapshot from the shared
       use-point-inspector singleton, renders the pure PointInspectorView, and applies each emitted
       action straight back to the authoritative composable via applyPointInspectorAction — the same
       applier the detached-window parent (PointInspectorDialog) uses for bridged actions. -->
  <PointInspectorView :snapshot="snapshot" @action="onAction" />
</template>

<script setup lang="ts">
import PointInspectorView from './PointInspectorView.vue'
import { usePointInspectorSnapshot } from '../composables/use-point-inspector-snapshot'
import { usePointInspector } from '../composables/use-point-inspector'
import { applyPointInspectorAction, type PointInspectorApi } from '../composables/point-inspector-actions'
import type { PointInspectorAction } from '../composables/point-inspector-model'

const snapshot = usePointInspectorSnapshot()
const inspector = usePointInspector()

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

function onAction(action: PointInspectorAction): void {
  applyPointInspectorAction(action, api)
}
</script>
