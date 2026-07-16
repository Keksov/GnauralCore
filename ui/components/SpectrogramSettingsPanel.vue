<template>
  <!-- SS3.1 (SS-D2): the IN-WINDOW adapter. It builds the reactive snapshot from the spectrogram
       store and applies the view's actions straight to that store (via the shared apply function).
       The store is the single source of truth; editing here repaints the spectrogram as before.
       The detached child uses the same view through SpectrogramSettingsRemote instead. -->
  <SpectrogramSettingsView :snapshot="snapshot" @action="onAction" />
</template>

<script setup lang="ts">
import SpectrogramSettingsView from './SpectrogramSettingsView.vue'
import { useSpectrogramStore } from '../stores/spectrogram'
import { useSpectrumSettingsSnapshot } from '../composables/use-spectrum-settings-snapshot'
import { applySpectrumSettingsAction } from '../composables/spectrum-settings-actions'
import type { SpectrumSettingsAction } from '../composables/spectrum-settings-model'

const store = useSpectrogramStore()
const snapshot = useSpectrumSettingsSnapshot()

function onAction(action: SpectrumSettingsAction): void {
  // The store satisfies SpectrumSettingsActionContext structurally.
  applySpectrumSettingsAction(action, store)
}
</script>
