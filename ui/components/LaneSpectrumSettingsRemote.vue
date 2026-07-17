<template>
  <!-- VS2.7 (VS-D3 rev 3, SS-D3): the DETACHED child-window content for the per-lane solo-spectrum
       panel — SpectrogramOverridesRemote's mono twin. It owns NO store: it renders the parent-pushed
       mono OverridesSnapshot and re-emits every gesture as one 'action' (PanelHostPage bridges it
       back; LaneSpectrumSettingsDialog applies it to the lane's authoritative override). -->
  <div class="lane-spectrum-remote">
    <SpectrogramOverridesView mono :snapshot="snapshot" @action="(a) => emit('action', a)" />
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
// override, not a blank panel.
const EMPTY_SNAPSHOT: OverridesSnapshot = {
  program: DEFAULT_SPECTROGRAM_SETTINGS,
  channel0: null,
  channel1: null,
  presets: [],
  linkChannels: true,
}
const snapshot = computed<OverridesSnapshot>(
  () => (props.bridgeState as OverridesSnapshot | undefined) ?? EMPTY_SNAPSHOT,
)
</script>

<style scoped>
.lane-spectrum-remote {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
</style>
