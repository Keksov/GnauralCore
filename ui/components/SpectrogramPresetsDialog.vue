<template>
  <!-- SS2.3 (SS-D6 rev. 2, owner 2026-07-16): presets moved OUT of the «Параметры» body into their
       own modal dialog, opened by a title-bar icon on «Параметры». Quick-apply (✓ active, * modified
       via the label) + «Сохранить как…» + «Управление…» (which still opens the full manager). -->
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="spectrogram-presets-dialog">
      <q-card-section class="row items-center no-wrap q-py-sm">
        <div class="text-subtitle1 col">{{ presetTitle }}</div>
        <q-btn flat round dense icon="close" v-close-popup :aria-label="t('audio.spectrogramSettingsClose')" />
      </q-card-section>
      <q-separator />

      <q-list dense class="spectrogram-presets-dialog__list">
        <q-item
          v-for="p in store.allPresets"
          :key="p.id"
          clickable
          :active="p.id === store.activePresetId"
          active-class="text-primary"
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
      </q-list>

      <q-separator />
      <q-card-actions align="right">
        <q-btn flat no-caps icon="save" :label="t('audio.spectrogramPresetSaveAs')" @click="onSaveAs" />
        <q-btn flat no-caps icon="settings" :label="t('audio.spectrogramPresetManage')" @click="managerOpen = true" />
      </q-card-actions>

      <spectrogram-preset-manager v-model="managerOpen" />
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useSpectrogramStore } from '../stores/spectrogram'
import SpectrogramPresetManager from './SpectrogramPresetManager.vue'

defineProps<{ readonly modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const $q = useQuasar()
const store = useSpectrogramStore()

const managerOpen = ref(false)
// Title = «Пресеты», plus the active preset name and a "*" when settings diverge (SF18).
const presetTitle = computed(() => {
  const active = store.activePreset
  if (active === null) return t('audio.spectrogramPresets')
  return store.isModified ? `${t('audio.spectrogramPresets')} — ${active.name} *` : `${t('audio.spectrogramPresets')} — ${active.name}`
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
.spectrogram-presets-dialog {
  min-width: 320px;
}

.spectrogram-presets-dialog__list {
  max-height: 50vh;
  overflow: auto;
}
</style>
