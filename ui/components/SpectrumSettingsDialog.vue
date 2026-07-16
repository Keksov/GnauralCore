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
    :bridge-state="snapshot"
    @panel-event="onBridgedEvent"
  >
    <!-- SS2.3 (SS-D6 rev. 2, owner 2026-07-16): presets are no longer a block in the body — a
         title-bar icon opens them as a separate modal dialog. -->
    <template #titlebar-actions>
      <q-btn
        flat dense round size="sm"
        icon="bookmarks"
        :color="presetsOpen ? 'primary' : undefined"
        :aria-label="t('audio.spectrogramPresets')"
        @click="openPresets"
      >
        <app-tooltip>{{ t('audio.spectrogramPresets') }}</app-tooltip>
      </q-btn>
    </template>

    <div class="spectrum-settings-dialog__body">
      <SpectrogramSettingsPanel />
    </div>

    <!-- SS2.1 (SS-D6, owner req 5): «Сброс» sits «сам по себе» in the window footer — NOT inside a
         block, so collapsing every accordion block never hides Reset. It stays out of the scrolling
         body, always visible. -->
    <template #footer>
      <div class="spectrum-settings-dialog__footer">
        <q-btn flat dense no-caps :label="t('audio.spectrogramReset')" icon="restart_alt" @click="store.reset()" />
      </div>
    </template>

    <!-- The presets modal (teleported to body by q-dialog). Mounted lazily on first open so the
         preset manager it pulls in stays out of the eager AudioPage chunk (as it was when the panel
         itself carried the presets). Once mounted it stays, so the close animation is preserved. -->
    <SpectrogramPresetsDialog v-if="presetsEverOpened" v-model="presetsOpen" />
  </PanelWindow>
</template>

<script setup lang="ts">
import { defineAsyncComponent, defineComponent, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { QSpinnerHourglass } from 'quasar'
import PanelWindow from '@panel/PanelWindow.vue'
import AppTooltip from '@tooltip/AppTooltip.vue'
import { useSpectrumSettingsPanelState } from '../stores/spectrum-settings-panel'
import { useSpectrogramStore } from '../stores/spectrogram'
import { useSpectrumSettingsSnapshot } from '../composables/use-spectrum-settings-snapshot'
import { applySpectrumSettingsAction } from '../composables/spectrum-settings-actions'
import type { SpectrumSettingsAction } from '../composables/spectrum-settings-model'

// SS3.2 (SS-D3): detach is now ON (allow-detach defaults to true). The detached child runs its own
// Vue/Pinia and holds NO spectrogram store — instead PanelWindow pushes `snapshot` to it, and the
// child (SpectrogramSettingsRemote) sends every gesture back as one `action` over the bridge, which
// we apply HERE to the authoritative store. So editing in the separate window repaints THIS window's
// spectrogram, and there is only one store writing the localStorage keys (no clobbering).

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

// SS3.2: the snapshot pushed to the detached child, and the handler that applies the child's bridged
// actions to the store. The store satisfies SpectrumSettingsActionContext structurally.
const snapshot = useSpectrumSettingsSnapshot()
function onBridgedEvent(name: string, payload: readonly unknown[]): void {
  if (name !== 'action') return
  applySpectrumSettingsAction(payload[0] as SpectrumSettingsAction, store)
}

// The presets dialog (+ its manager) is only needed once the user asks for it — keep it lazy and
// out of the eager AudioPage chunk until first open.
const SpectrogramPresetsDialog = defineAsyncComponent(() => import('./SpectrogramPresetsDialog.vue'))
const presetsOpen = ref(false)
const presetsEverOpened = ref(false)
function openPresets(): void {
  presetsEverOpened.value = true
  presetsOpen.value = true
}
</script>

<style scoped>
/* The panel content scrolls inside the window chrome; PanelWindow owns the outer geometry.
   SS2.6 (owner): NO padding — the block frame sits flush with the window edge (no gap), in every
   dock/float mode. The scrollbar gutter is not reserved (it would be a right-side gap); the flap it
   used to guard against is instead handled by hysteresis in the panel's ResizeObserver. */
.spectrum-settings-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
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
