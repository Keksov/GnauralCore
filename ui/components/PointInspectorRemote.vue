<template>
  <!-- PI3.2 (point-inspector-panel): the DETACHED «Параметры точки» adapter — the child OS window's
       content, resolved from module.ts panels[] by PanelHostPage. It holds NO gtracks/composable/
       localStorage state of its own (PW-D11: the child is a separate JS realm and must not clobber the
       shared per-file state). It renders whatever snapshot the parent pushes over the panel bridge
       (arriving as the reactive `bridgeState` prop) and forwards every gesture back as a serializable
       PointInspectorAction; the parent (PointInspectorDialog) applies it to the authoritative singletons
       and pushes the updated snapshot back. -->
  <PointInspectorView :snapshot="snapshot" @action="(a) => emit('action', a)" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PointInspectorView from './PointInspectorView.vue'
import type { PointInspectorAction, PointInspectorSnapshot } from '../composables/point-inspector-model'

const props = defineProps<{ bridgeState?: unknown }>()
const emit = defineEmits<{ action: [action: PointInspectorAction] }>()

// Until the first snapshot arrives (child-ready triggers the parent's immediate push), render the empty
// placeholder — mode 'none' also keeps every editing control inert during that brief gap.
const EMPTY_SNAPSHOT: PointInspectorSnapshot = {
  mode: 'none',
  voiceName: '',
  multiCount: 0,
  canUndo: false,
  canRedo: false,
  autosave: false,
  mono: false,
  hasNext: false,
  form: null,
  groups: [],
}
const snapshot = computed<PointInspectorSnapshot>(() => (props.bridgeState as PointInspectorSnapshot | undefined) ?? EMPTY_SNAPSHOT)
</script>
