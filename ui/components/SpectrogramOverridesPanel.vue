<template>
  <!-- SG3.2 (SG-D7/SG-D8): the PER-GRAPH editor hosted by the dockable/detachable «Параметры» @panel
       (SpectrumSettingsDialog), opened from the overall spectrogram group-header gear. It edits the
       overall spectrogram's per-CHANNEL overrides (overall-spectrum-overrides store), NOT the program
       level. Scope «Оба | Левый | Правый» picks the channel(s); the «Индивидуальные» toggle turns the
       scope's override on (seeded from the program level) or off (inherit). Editing a field while
       inheriting auto-enables individual (SG-D8). Applying a preset writes the active scope. This is
       the IN-WINDOW adapter (dock/float); the detached child reuses the same view via a remote. -->
  <div class="spectrum-overrides">
    <div class="spectrum-overrides__bar">
      <q-btn-toggle
        :model-value="scope"
        dense no-caps unelevated
        toggle-color="primary"
        :options="scopeOptions"
        @update:model-value="onScopeChange"
      />
      <q-space />
      <q-btn-dropdown dense flat no-caps icon="bookmarks" :label="t('audio.spectrogramPresets')">
        <q-list dense style="min-width: 200px">
          <q-item
            v-for="p in presets"
            :key="p.id"
            clickable
            v-close-popup
            @click="applyPreset(p.id)"
          >
            <q-item-section>{{ p.name }}</q-item-section>
            <q-item-section side v-if="p.builtin">
              <q-badge outline color="grey">{{ t('audio.spectrogramPresetBuiltinTag') }}</q-badge>
            </q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
    </div>

    <div class="spectrum-overrides__scope-row">
      <q-toggle
        :model-value="individualActive"
        dense
        :label="t('audio.spectrumScopeIndividual')"
        @update:model-value="onIndividualToggle"
      />
      <span v-if="!individualActive" class="spectrum-overrides__hint text-caption text-grey">
        {{ t('audio.spectrumScopeInheritHint') }}
      </span>
    </div>

    <div class="spectrum-overrides__body">
      <SpectrogramSettingsView :snapshot="snapshot" @action="onFieldAction" />
    </div>

    <div class="spectrum-overrides__footer">
      <q-btn
        flat dense no-caps
        icon="restart_alt"
        :label="t('audio.spectrumScopeReset')"
        :disable="!individualActive"
        @click="revertScope"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SpectrogramSettingsView from './SpectrogramSettingsView.vue'
import { useSpectrogramStore } from '../stores/spectrogram'
import { useOverallSpectrumOverridesStore } from '../stores/overall-spectrum-overrides'
import type { SpectrogramSettings } from '../composables/spectrogram-settings'
import type { SpectrumSettingsSnapshot, SpectrumSettingsAction } from '../composables/spectrum-settings-model'

type Scope = 'both' | 0 | 1

const { t } = useI18n()
const store = useSpectrogramStore()
const overrides = useOverallSpectrumOverridesStore()

const scope = ref<Scope>('both')
const scopeOptions = computed(() => [
  { label: t('audio.spectrumScopeBoth'), value: 'both' as const },
  { label: t('audio.spectrumScopeLeft'), value: 0 as const },
  { label: t('audio.spectrumScopeRight'), value: 1 as const },
])

// The channel(s) the active scope touches: «Оба» = both, else the one channel.
const channels = computed<number[]>(() => (scope.value === 'both' ? [0, 1] : [scope.value]))

// The settings the form shows for the active scope: its individual override if set, else the program
// level (inherited). For «Оба» the left channel is the representative shown.
const displayedSettings = computed<SpectrogramSettings>(() => {
  const ch = scope.value === 'both' ? 0 : scope.value
  return overrides.getChannel(ch) ?? store.settings
})

// The active scope is «individual» only when EVERY channel it covers has its own override.
const individualActive = computed<boolean>(() => channels.value.every((ch) => overrides.isIndividual(ch)))

const presets = computed(() => store.allPresets.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })))

const snapshot = computed<SpectrumSettingsSnapshot>(() => ({
  settings: { ...displayedSettings.value },
  presets: presets.value,
  activePresetId: null,
  isModified: false,
}))

function writeScope(settings: SpectrogramSettings): void {
  if (scope.value === 'both') overrides.setBoth(settings)
  else overrides.setChannel(scope.value, settings)
}

function onFieldAction(action: SpectrumSettingsAction): void {
  // The view only emits field edits here (presets/reset are this panel's own chrome).
  if (action.kind !== 'set') return
  // SG-D8: editing while inheriting auto-enables individual — writeScope seeds the override from the
  // currently displayed settings (the program level when inheriting) plus the one changed field.
  const base: SpectrogramSettings = { ...displayedSettings.value }
  ;(base as unknown as Record<string, string | number>)[action.key] = action.value
  writeScope(base)
}

function applyPreset(id: string): void {
  const preset = store.allPresets.find((p) => p.id === id)
  if (preset === undefined) return
  writeScope(preset.settings)
}

function onScopeChange(next: Scope): void {
  scope.value = next
}

function onIndividualToggle(on: boolean): void {
  if (on) {
    for (const ch of channels.value) overrides.ensureChannel(ch, { ...store.settings })
  } else {
    revertScope()
  }
}

function revertScope(): void {
  if (scope.value === 'both') overrides.clearBoth()
  else overrides.clearChannel(scope.value)
}
</script>

<style scoped>
.spectrum-overrides {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.spectrum-overrides__bar {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 4px 6px;
}

.spectrum-overrides__scope-row {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  padding: 4px 8px;
}

.spectrum-overrides__hint {
  min-width: 0;
}

.spectrum-overrides__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.spectrum-overrides__footer {
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-end;
  padding: 6px 12px;
}
</style>
