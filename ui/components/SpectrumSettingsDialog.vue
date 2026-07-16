<template>
  <!-- SG3.2 (SG-D6/SG-D7): the «Параметры» dockable/detachable @panel is now the PER-GRAPH editor for
       the overall spectrogram's L/R channel overrides — opened from the spectrogram group-header gear
       (TracksPanel), not the removed global `tune` button (the program level moved to Меню→Настройки,
       SG1.1/SG2.1). The scope selector, «Индивидуальные» toggle, presets-apply and «Сброс»(=revert to
       inherit) all live inside SpectrogramOverridesPanel, so this wrapper is just the PanelWindow
       chrome. SG3.2a: detach is OFF (:allow-detach="false", explicit — an absent type-only Boolean
       casts to false, PW5.7c) until SG3.2b wires the per-graph remote (SS-D3: a detached child runs
       its own Pinia and must bridge actions to this window's authoritative override store). -->
  <PanelWindow
    :state="panel"
    :title="t('audio.spectrogramSettingsTitle')"
    icon="tune"
    :allow-detach="false"
  >
    <div class="spectrum-settings-dialog__body">
      <SpectrogramOverridesPanel />
    </div>
  </PanelWindow>
</template>

<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { QSpinnerHourglass } from 'quasar'
import PanelWindow from '@panel/PanelWindow.vue'
import { useSpectrumSettingsPanelState } from '../stores/spectrum-settings-panel'

// Kept lazy (as the global panel was): the per-graph editor pulls in the whole spectrogram form, so
// it stays out of AudioPage's eager chunk until the user opens «Параметры».
const AsyncPanelLoading = defineComponent({
  name: 'AsyncSpectrumOverridesLoading',
  setup() {
    return () => h('div', { class: 'spectrum-settings-dialog__placeholder' }, [
      h(QSpinnerHourglass, { color: 'primary', size: '28px' }),
    ])
  },
})
const SpectrogramOverridesPanel = defineAsyncComponent({
  loader: () => import('./SpectrogramOverridesPanel.vue'),
  delay: 120,
  loadingComponent: AsyncPanelLoading,
})

const { t } = useI18n()
const panel = useSpectrumSettingsPanelState()
</script>

<style scoped>
.spectrum-settings-dialog__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.spectrum-settings-dialog__placeholder {
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
