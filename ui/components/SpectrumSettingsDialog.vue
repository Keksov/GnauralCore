<template>
  <!-- SS1.1 (SS-D1): thin composition of the universal PanelWindow chrome (@panel) + the existing
       «Параметры» content — the THIRD consumer of the control, after «Открытие файлов» (PW1.2) and
       «Список треков» (PW5.6c). AudioPage teleports it to <body> when floating and hosts it as a
       flex child when docked; it renders only while the panel state is open (v-if host-side).
       The content is UNCHANGED here: this step only moves it onto the control (blocks/tiles/
       accordion are SS2.1, so SS1.2's owner checkpoint judges the FORM alone). -->
  <PanelWindow
    :state="panel"
    :title="t('audio.spectrogramSettingsTitle')"
    icon="tune"
    :allow-detach="false"
  >
    <div class="spectrum-settings-dialog__body">
      <SpectrogramSettingsPanel />
    </div>

    <!-- SS2.1 (SS-D6, owner req 5): «Сброс» sits «сам по себе» in the window footer — NOT inside the
         «Пресеты» block, so collapsing that block in the accordion never hides Reset. It stays out of
         the scrolling body, always visible. -->
    <template #footer>
      <div class="spectrum-settings-dialog__footer">
        <q-btn flat dense no-caps :label="t('audio.spectrogramReset')" icon="restart_alt" @click="store.reset()" />
      </div>
    </template>
  </PanelWindow>
</template>

<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { QSpinnerHourglass } from 'quasar'
import PanelWindow from '@panel/PanelWindow.vue'
import { useSpectrumSettingsPanelState } from '../stores/spectrum-settings-panel'
import { useSpectrogramStore } from '../stores/spectrogram'

// SS-D3: detach is OFF until the SS3.x remote exists, and this prop is passed EXPLICITLY rather
// than omitted — an absent type-only Boolean casts to false, which happens to be what we want here,
// but relying on that cast is exactly the PW5.7c trap that silently hid the mode from the other two
// panels. Why it must be off: a detached child window runs its own Pinia, so it would edit its OWN
// spectrogram store — never repainting THIS window's spectrogram (a silent no-op, since there is no
// 'storage' listener anywhere) while racing this window's deep watches on the same three
// localStorage keys. It is enabled in SS3.2 together with the snapshot/action remote.

// Kept lazy exactly as TracksPanel's flyout had it (createAsyncPanel): the panel body + its preset
// manager stay out of AudioPage's chunk until the user actually opens «Параметры».
const AsyncPanelLoading = defineComponent({
  name: 'AsyncSpectrumSettingsLoading',
  setup() {
    return () => h('div', { class: 'spectrum-settings-dialog__placeholder' }, [
      h(QSpinnerHourglass, { color: 'primary', size: '28px' }),
    ])
  },
})
const SpectrogramSettingsPanel = defineAsyncComponent({
  loader: () => import('./SpectrogramSettingsPanel.vue'),
  delay: 120,
  loadingComponent: AsyncPanelLoading,
})

const { t } = useI18n()
const panel = useSpectrumSettingsPanelState()
const store = useSpectrogramStore()
</script>

<style scoped>
/* The panel content scrolls inside the window chrome; PanelWindow owns the outer geometry.
   SS2.1/R1: reserve the scrollbar gutter so the content width does NOT change when the scrollbar
   appears — that width change is the feedback loop that would flap the tiles<->accordion switch. */
.spectrum-settings-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  scrollbar-gutter: stable;
}

.spectrum-settings-dialog__footer {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  justify-content: flex-end;
  padding: 6px 12px;
}

.spectrum-settings-dialog__placeholder {
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
