<template>
  <!-- SS3.2 (SS-D2/SS-D8, PW5.7 «пульт»): the DETACHED child-window content. It owns NO store — it
       renders the parent-pushed snapshot and re-emits every gesture as one `action` (PanelHostPage
       bridges it back to the main window, which applies it to the authoritative store). The child has
       no title-bar/footer chrome, so it hosts its own compact bar: presets (apply + «Сохранить как…»
       only — manage stays main-window-only, SS-D8) + «Сброс». Field edits come from the shared view. -->
  <div class="spectrum-remote">
    <div class="spectrum-remote__bar">
      <q-btn-dropdown dense flat no-caps icon="bookmarks" :label="presetLabel" class="spectrum-remote__presets">
        <q-list dense style="min-width: 220px">
          <q-item
            v-for="p in snapshot.presets"
            :key="p.id"
            clickable
            v-close-popup
            :active="p.id === snapshot.activePresetId"
            active-class="text-primary"
            @click="emit('action', { kind: 'apply-preset', id: p.id })"
          >
            <q-item-section avatar style="min-width: 26px">
              <q-icon v-if="p.id === snapshot.activePresetId" name="check" size="18px" />
            </q-item-section>
            <q-item-section>{{ p.name }}</q-item-section>
            <q-item-section side v-if="p.builtin">
              <q-badge outline color="grey">{{ t('audio.spectrogramPresetBuiltinTag') }}</q-badge>
            </q-item-section>
          </q-item>
          <q-separator />
          <q-item clickable v-close-popup @click="onSaveAs">
            <q-item-section avatar style="min-width: 26px"><q-icon name="save" size="18px" /></q-item-section>
            <q-item-section>{{ t('audio.spectrogramPresetSaveAs') }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
      <q-space />
      <q-btn flat dense no-caps icon="restart_alt" :label="t('audio.spectrogramReset')" @click="emit('action', { kind: 'reset' })" />
      <q-btn flat dense round icon="close" :aria-label="t('audio.spectrogramSettingsClose')" @click="emit('close')" />
    </div>

    <div class="spectrum-remote__body">
      <SpectrogramSettingsView :snapshot="snapshot" @action="(a) => emit('action', a)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import SpectrogramSettingsView from './SpectrogramSettingsView.vue'
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../composables/spectrogram-settings'
import type { SpectrumSettingsSnapshot, SpectrumSettingsAction } from '../composables/spectrum-settings-model'

const props = defineProps<{ readonly bridgeState?: unknown }>()
const emit = defineEmits<{ action: [action: SpectrumSettingsAction]; close: [] }>()

const { t } = useI18n()
const $q = useQuasar()

// Before the parent's first push (or if it's ever absent) render defaults, not a blank panel.
const EMPTY_SNAPSHOT: SpectrumSettingsSnapshot = {
  settings: DEFAULT_SPECTROGRAM_SETTINGS,
  presets: [],
  activePresetId: null,
  isModified: false,
}
const snapshot = computed<SpectrumSettingsSnapshot>(
  () => (props.bridgeState as SpectrumSettingsSnapshot | undefined) ?? EMPTY_SNAPSHOT,
)

const presetLabel = computed(() => {
  const active = snapshot.value.presets.find((p) => p.id === snapshot.value.activePresetId)
  if (active === undefined) return t('audio.spectrogramPresets')
  return snapshot.value.isModified ? `${active.name} *` : active.name
})

function onSaveAs(): void {
  $q.dialog({
    title: t('audio.spectrogramPresetSaveAs'),
    message: t('audio.spectrogramPresetNamePrompt'),
    prompt: { model: '', type: 'text' },
    cancel: { label: t('audio.spectrogramPresetCancel'), flat: true },
    ok: { label: t('audio.spectrogramPresetOk'), flat: true },
    persistent: false,
  }).onOk((aName: string) => {
    if (aName.trim() !== '') emit('action', { kind: 'save-as', name: aName.trim() })
  })
}
</script>

<style scoped>
.spectrum-remote {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.spectrum-remote__bar {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  padding: 4px 6px;
}

.spectrum-remote__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
</style>
