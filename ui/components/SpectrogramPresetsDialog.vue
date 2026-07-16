<template>
  <!-- SS2.3 (SS-D6 rev.2) + SS2.4 (owner 2026-07-16): the presets modal, opened by a title-bar icon
       on «Параметры». Since this is now a window of its own, preset MANAGEMENT (rename / delete /
       duplicate / update / import / export) lives here directly — the former separate «Управление…»
       dialog + button are gone (SS-D12). -->
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="spectrogram-presets-dialog">
      <q-card-section class="row items-center no-wrap q-py-sm">
        <div class="text-subtitle1 col">{{ presetTitle }}</div>
        <q-btn flat round dense icon="close" v-close-popup :aria-label="t('audio.spectrogramSettingsClose')" />
      </q-card-section>
      <q-separator />

      <q-card-section class="scroll spectrogram-presets-dialog__body">
        <div class="text-caption text-grey-6 q-mb-xs">{{ t('audio.spectrogramPresetBuiltin') }}</div>
        <q-list dense>
          <q-item v-for="p in builtins" :key="p.id" :active="p.id === store.activePresetId" active-class="text-primary">
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
        <q-btn flat dense no-caps icon="save" :label="t('audio.spectrogramPresetSaveAs')" @click="onSaveAs" />
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

defineProps<{ readonly modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const $q = useQuasar()
const store = useSpectrogramStore()

const builtins = computed(() => store.allPresets.filter((p) => p.builtin))
const fileInput = ref<HTMLInputElement | null>(null)

// Title = «Пресеты», plus the active preset name and a "*" when settings diverge (SF18).
const presetTitle = computed(() => {
  const active = store.activePreset
  if (active === null) return t('audio.spectrogramPresets')
  return store.isModified ? `${t('audio.spectrogramPresets')} — ${active.name} *` : `${t('audio.spectrogramPresets')} — ${active.name}`
})

// Handlers only need id + name, so they accept both built-in entries and user presets.
type PresetRef = { readonly id: string; readonly name: string }

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
.spectrogram-presets-dialog {
  min-width: 340px;
  max-width: 92vw;
}

.spectrogram-presets-dialog__body {
  max-height: 60vh;
}

.hidden {
  display: none;
}
</style>
