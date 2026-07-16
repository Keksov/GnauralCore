<template>
  <!-- SF18: quick-apply dropdown (active ✓ + "modified" *) + Save as… / Manage…. Extracted in SS2.1
       so «Пресеты» can be block #1 (SS-D6) in both the tiled and the accordion layouts. -->
  <div class="spectrogram-presets">
    <q-btn-dropdown dense flat no-caps icon="tune" :label="presetLabel" class="spectrogram-presets__dropdown">
      <q-list dense style="min-width: 220px">
        <q-item
          v-for="p in store.allPresets"
          :key="p.id"
          clickable
          v-close-popup
          @click="store.applyPresetById(p.id)"
        >
          <q-item-section avatar style="min-width: 26px">
            <q-icon v-if="p.id === store.activePresetId" name="check" size="18px" />
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
        <q-item clickable v-close-popup @click="managerOpen = true">
          <q-item-section avatar style="min-width: 26px"><q-icon name="settings" size="18px" /></q-item-section>
          <q-item-section>{{ t('audio.spectrogramPresetManage') }}</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
    <spectrogram-preset-manager v-model="managerOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useSpectrogramStore } from '../stores/spectrogram'
import SpectrogramPresetManager from './SpectrogramPresetManager.vue'

const { t } = useI18n()
const $q = useQuasar()
const store = useSpectrogramStore()

// SF18: preset dropdown label = active preset name + "*" when settings diverge.
const managerOpen = ref(false)
const presetLabel = computed(() => {
  const active = store.activePreset
  if (active === null) return t('audio.spectrogramPresets')
  return store.isModified ? `${active.name} *` : active.name
})
function onSaveAs(): void {
  $q.dialog({
    title: t('audio.spectrogramPresetSaveAs'),
    message: t('audio.spectrogramPresetNamePrompt'),
    prompt: { model: store.activePreset?.name ?? '', type: 'text' },
    cancel: { label: t('audio.spectrogramPresetCancel'), flat: true },
    ok: { label: t('audio.spectrogramPresetOk'), flat: true },
    persistent: false,
  }).onOk((aName: string) => {
    if (aName.trim() !== '') store.saveAsPreset(aName)
  })
}
</script>

<style scoped>
.spectrogram-presets {
  display: flex;
}

.spectrogram-presets__dropdown {
  flex: 1 1 auto;
}
</style>
