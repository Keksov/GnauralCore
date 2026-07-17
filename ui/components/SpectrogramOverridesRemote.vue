<template>
  <!-- SG3.2b (SG-D6/SS-D3, PW5.7 «пульт»): the DETACHED child-window content for the per-graph
       «Параметры» panel. It owns NO store — it renders the parent-pushed OverridesSnapshot and
       re-emits every gesture as one scope-qualified `action` (PanelHostPage bridges it back to the
       main window, which applies it to the authoritative override store). The pure view carries all
       the chrome (scope nav + presets + «Сброс»), so this wrapper only adapts bridgeState → snapshot
       and forwards the action. -->
  <div class="spectrum-overrides-remote">
    <SpectrogramOverridesView :snapshot="snapshot" @action="(a) => emit('action', a)" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SpectrogramOverridesView from './SpectrogramOverridesView.vue'
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../composables/spectrogram-settings'
import type { OverridesAction, OverridesSnapshot } from '../composables/overall-spectrum-overrides-model'

const props = defineProps<{ readonly bridgeState?: unknown }>()
const emit = defineEmits<{ action: [action: OverridesAction] }>()

// Before the parent's first push (or if it's ever absent) render the program defaults with no
// overrides, not a blank panel.
const EMPTY_SNAPSHOT: OverridesSnapshot = {
  program: DEFAULT_SPECTROGRAM_SETTINGS,
  channel0: null,
  channel1: null,
  both: null,
  presets: [],
  linkChannels: true,
}
const snapshot = computed<OverridesSnapshot>(
  () => (props.bridgeState as OverridesSnapshot | undefined) ?? EMPTY_SNAPSHOT,
)
</script>

<style scoped>
.spectrum-overrides-remote {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
</style>
