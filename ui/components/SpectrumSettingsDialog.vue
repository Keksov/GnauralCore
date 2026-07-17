<template>
  <!-- SG3.2 (SG-D6/SG-D7): the «Параметры» dockable/detachable @panel is the PER-GRAPH editor for the
       overall spectrogram's L/R channel overrides — opened from the spectrogram group-header gear
       (TracksPanel), not the removed global `tune` button (the program level moved to Меню→Настройки,
       SG1.1/SG2.1). The scope selector, presets-apply and «Сброс»(=revert to inherit) live inside the
       pure SpectrogramOverridesView (hosted here via the in-window adapter SpectrogramOverridesPanel),
       so this wrapper is just the PanelWindow chrome. SG3.2b: detach is ON (allow-detach defaults to
       true). The detached child runs its own Pinia and holds NO override store (SS-D3) — PanelWindow
       pushes `snapshot` to it, and the child (SpectrogramOverridesRemote) sends every gesture back as
       one scope-qualified `action` over the bridge, which we apply HERE to the authoritative stores.
       So editing in the separate window repaints THIS window's spectrogram, with one writer only. -->
  <!-- VS2.8 (owner): the caption names the edited entity — «Параметры: Общий спектр». -->
  <PanelWindow
    :state="panel"
    :title="t('audio.paramsTitle', { entity: t('audio.entityOverallSpectrum') })"
    icon="tune"
    :bridge-state="snapshot"
    @panel-event="onBridgedEvent"
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
import { useOverridesSnapshot, useApplyOverridesAction } from '../composables/use-overrides-snapshot'
import type { OverridesAction } from '../composables/overall-spectrum-overrides-model'

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

// SG3.2b: the snapshot pushed to the detached child, and the handler that applies the child's bridged
// actions to the authoritative stores (the main window is the single writer, SS-D3).
const snapshot = useOverridesSnapshot()
const applyAction = useApplyOverridesAction()
function onBridgedEvent(name: string, payload: readonly unknown[]): void {
  if (name !== 'action') return
  applyAction(payload[0] as OverridesAction)
}
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
