<template>
  <!-- SF18: preset manager — apply / rename / delete / duplicate / export / import. -->
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="spectrogram-preset-manager">
      <q-card-section class="row items-center q-pb-sm">
        <div class="text-subtitle1">{{ t('audio.spectrogramPresetManager') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup :aria-label="t('audio.spectrogramZoomClose')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="scroll spectrogram-preset-manager__body">
        <div class="text-caption text-grey-6 q-mb-xs">{{ t('audio.spectrogramPresetBuiltin') }}</div>
        <q-list dense>
          <q-item v-for="p in builtins" :key="p.id">
            <q-item-section>
              <q-item-label>
                {{ p.name }}
                <q-icon v-if="p.id === store.activePresetId" name="check" size="16px" class="q-ml-xs" />
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row no-wrap items-center">
                <q-btn flat dense no-caps size="sm" :label="t('audio.spectrogramPresetApply')" @click="store.applyPresetById(p.id)" />
                <q-btn flat dense round size="sm" icon="content_copy" @click="duplicate(p)">
                  <app-tooltip>{{ t('audio.spectrogramPresetDuplicate') }}</app-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>

        <div class="text-caption text-grey-6 q-mt-md q-mb-xs">{{ t('audio.spectrogramPresetUser') }}</div>
        <div v-if="store.userPresets.length === 0" class="text-grey-6 q-pa-sm text-caption">
          {{ t('audio.spectrogramPresetNone') }}
        </div>
        <q-list v-else dense>
          <q-item v-for="p in store.userPresets" :key="p.id" :active="p.id === store.activePresetId" active-class="text-primary">
            <q-item-section>
              <q-item-label>
                {{ p.name }}
                <q-icon v-if="p.id === store.activePresetId" name="check" size="16px" class="q-ml-xs" />
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row no-wrap items-center">
                <q-btn flat dense no-caps size="sm" :label="t('audio.spectrogramPresetApply')" @click="store.applyPresetById(p.id)" />
                <q-btn flat dense round size="sm" icon="save" @click="store.updatePreset(p.id)">
                  <app-tooltip>{{ t('audio.spectrogramPresetUpdate') }}</app-tooltip>
                </q-btn>
                <q-btn flat dense round size="sm" icon="edit" @click="rename(p)">
                  <app-tooltip>{{ t('audio.spectrogramPresetRename') }}</app-tooltip>
                </q-btn>
                <q-btn flat dense round size="sm" icon="content_copy" @click="duplicate(p)">
                  <app-tooltip>{{ t('audio.spectrogramPresetDuplicate') }}</app-tooltip>
                </q-btn>
                <q-btn flat dense round size="sm" icon="delete" color="negative" @click="remove(p)">
                  <app-tooltip>{{ t('audio.spectrogramPresetDelete') }}</app-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>

      <q-separator />
      <q-card-actions align="between">
        <div class="row no-wrap">
          <q-btn flat dense no-caps icon="upload" :label="t('audio.spectrogramPresetImport')" @click="triggerImport" />
          <q-btn
            flat dense no-caps icon="download"
            :label="t('audio.spectrogramPresetExport')"
            :disable="store.userPresets.length === 0"
            @click="doExport"
          />
          <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="onImportFile" />
        </div>
        <q-btn flat no-caps :label="t('audio.spectrogramPresetClose')" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'

import { useSpectrogramStore } from '../stores/spectrogram'
import AppTooltip from '@tooltip/AppTooltip.vue'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const $q = useQuasar()
const store = useSpectrogramStore()

const builtins = computed(() => store.allPresets.filter((p) => p.builtin))
const fileInput = ref<HTMLInputElement | null>(null)

// Handlers only need id + name, so they accept both built-in entries and user presets.
type PresetRef = { readonly id: string; readonly name: string }

function rename(aPreset: PresetRef): void {
  $q.dialog({
    title: t('audio.spectrogramPresetRename'),
    prompt: { model: aPreset.name, type: 'text' },
    cancel: { label: t('audio.spectrogramPresetCancel'), flat: true },
    ok: { label: t('audio.spectrogramPresetOk'), flat: true },
  }).onOk((aName: string) => store.renamePreset(aPreset.id, aName))
}

function duplicate(aPreset: PresetRef): void {
  store.duplicatePreset(aPreset.id)
}

function remove(aPreset: PresetRef): void {
  $q.dialog({
    title: t('audio.spectrogramPresetDelete'),
    message: t('audio.spectrogramPresetDeleteConfirm', { name: aPreset.name }),
    cancel: { label: t('audio.spectrogramPresetCancel'), flat: true },
    ok: { color: 'negative', flat: true, label: t('audio.spectrogramPresetDelete') },
  }).onOk(() => store.deletePreset(aPreset.id))
}

function doExport(): void {
  const json = store.exportPresets()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'spectrogram-presets.json'
  a.click()
  URL.revokeObjectURL(url)
}

function triggerImport(): void {
  fileInput.value?.click()
}

async function onImportFile(aEvent: Event): Promise<void> {
  const input = aEvent.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-importing the same file
  if (file === undefined) return
  const text = await file.text()
  const added = store.importPresets(text)
  $q.notify({
    message: t('audio.spectrogramPresetImported', { n: added }),
    color: added > 0 ? 'positive' : 'warning',
    position: 'top',
    timeout: 2500,
  })
}
</script>

<style scoped>
.spectrogram-preset-manager {
  min-width: 340px;
  max-width: 92vw;
}

.spectrogram-preset-manager__body {
  max-height: 60vh;
}

.hidden {
  display: none;
}
</style>
