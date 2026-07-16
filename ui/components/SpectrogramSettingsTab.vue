<template>
  <!-- SG1.1 (SG-D2/SG-D4): the PROGRAM-LEVEL spectrogram settings as a tab on the general Settings
       page — the same CoreModuleSettingsTabContribution seam BodyMonitor's «Devices» uses. It reuses
       the finished form (SpectrogramSettingsPanel talks to the global spectrogram store directly) and
       re-provides «Сброс» + presets access, which used to live in the retired PanelWindow chrome
       (SpectrumSettingsDialog: footer Reset + title-bar bookmarks), not inside the form itself.
       This edits the program-level defaults applied to every spectrogram (SG-D4); per-graph
       individual L/R settings are a separate surface (the dockable/detachable panel, SG-D6, phase 3). -->
  <div class="spectrogram-settings-tab">
    <div class="spectrogram-settings-tab__toolbar">
      <q-btn
        flat dense no-caps
        icon="bookmarks"
        :label="t('audio.spectrogramPresets')"
        @click="openPresets"
      />
      <q-space />
      <q-btn
        flat dense no-caps
        icon="restart_alt"
        :label="t('audio.spectrogramReset')"
        @click="store.reset()"
      />
    </div>

    <div class="spectrogram-settings-tab__body">
      <SpectrogramSettingsPanel />
    </div>

    <!-- Lazy + mounted on first open, so the preset manager stays out of the tab's initial chunk
         (mirrors SpectrumSettingsDialog's handling). Once mounted it stays, preserving the close
         animation. -->
    <SpectrogramPresetsDialog v-if="presetsEverOpened" v-model="presetsOpen" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SpectrogramSettingsPanel from './SpectrogramSettingsPanel.vue'
import { useSpectrogramStore } from '../stores/spectrogram'

const { t } = useI18n()
const store = useSpectrogramStore()

const SpectrogramPresetsDialog = defineAsyncComponent(() => import('./SpectrogramPresetsDialog.vue'))
const presetsOpen = ref(false)
const presetsEverOpened = ref(false)
function openPresets(): void {
  presetsEverOpened.value = true
  presetsOpen.value = true
}
</script>

<style scoped>
.spectrogram-settings-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.spectrogram-settings-tab__toolbar {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
}

.spectrogram-settings-tab__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
