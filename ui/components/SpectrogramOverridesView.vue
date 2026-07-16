<template>
  <!-- SG3.2b (SG-D6/SG-D7/SG-D8, PW5.7 «пульт»): the PURE per-graph «Параметры» view. It renders from
       `snapshot` and emits one scope-qualified `action` per gesture — no store — so the SAME view
       renders in the main window (via the in-window adapter SpectrogramOverridesPanel) and in the
       detached child window (via SpectrogramOverridesRemote). The scope selector is LOCAL to the view:
       a vertical LEFT nav «Оба канала | Левый | Правый», exactly like the overall-waveform settings
       form; the right pane holds the presets + the settings form. No individual/inherit toggle (owner):
       the spectrum shows the program level by default, editing a field auto-creates the scope's
       override (SG-D8), «Сброс» drops it back, applying a preset writes the active scope. -->
  <div class="spectrum-overrides">
    <div class="spectrum-overrides__body row no-wrap">
      <q-list class="spectrum-overrides__nav">
        <q-item
          v-for="opt in scopeOptions"
          :key="String(opt.value)"
          clickable
          :active="scope === opt.value"
          active-class="spectrum-overrides__nav--active"
          @click="scope = opt.value"
        >
          <q-item-section>{{ opt.label }}</q-item-section>
        </q-item>
      </q-list>

      <q-separator vertical />

      <div class="spectrum-overrides__content">
        <div class="spectrum-overrides__content-head">
          <q-space />
          <q-btn-dropdown dense flat no-caps icon="bookmarks" :label="t('audio.spectrogramPresets')">
            <q-list dense style="min-width: 200px">
              <q-item
                v-for="p in snapshot.presets"
                :key="p.id"
                clickable
                v-close-popup
                @click="emit('action', { kind: 'apply-preset', scope, id: p.id })"
              >
                <q-item-section>{{ p.name }}</q-item-section>
                <q-item-section side v-if="p.builtin">
                  <q-badge outline color="grey">{{ t('audio.spectrogramPresetBuiltinTag') }}</q-badge>
                </q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <div class="spectrum-overrides__form">
          <SpectrogramSettingsView :snapshot="formSnapshot" @action="onFieldAction" />
        </div>
      </div>
    </div>

    <div class="spectrum-overrides__footer">
      <q-btn
        flat dense no-caps
        icon="restart_alt"
        :label="t('audio.spectrogramReset')"
        :disable="!hasOverride"
        @click="emit('action', { kind: 'reset', scope })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SpectrogramSettingsView from './SpectrogramSettingsView.vue'
import {
  displayedForScope,
  scopeHasOverride,
  type OverrideScope,
  type OverridesAction,
  type OverridesSnapshot,
} from '../composables/overall-spectrum-overrides-model'
import type { SpectrumSettingsSnapshot, SpectrumSettingsAction } from '../composables/spectrum-settings-model'

const props = defineProps<{ readonly snapshot: OverridesSnapshot }>()
const emit = defineEmits<{ action: [action: OverridesAction] }>()

const { t } = useI18n()

// Local scope selection (not bridged): the child picks what to show; only the resulting edit crosses.
const scope = ref<OverrideScope>('both')

// Named + laid out like the overall-waveform settings form (owner): a vertical «Оба канала / Левый /
// Правый» nav.
const scopeOptions = computed(() => [
  { label: t('audio.waveformChannelsBoth'), value: 'both' as const },
  { label: t('audio.waveformChannelsLeft'), value: 0 as const },
  { label: t('audio.waveformChannelsRight'), value: 1 as const },
])

// The inner field form renders the effective settings for the active scope (override ?? program).
const formSnapshot = computed<SpectrumSettingsSnapshot>(() => ({
  settings: displayedForScope(props.snapshot, scope.value),
  presets: props.snapshot.presets,
  activePresetId: null,
  isModified: false,
}))

const hasOverride = computed<boolean>(() => scopeHasOverride(props.snapshot, scope.value))

function onFieldAction(action: SpectrumSettingsAction): void {
  // The field view only emits field edits here (presets/reset are this view's own chrome).
  if (action.kind !== 'set') return
  emit('action', { kind: 'set-field', scope: scope.value, key: action.key, value: action.value })
}
</script>

<style scoped>
.spectrum-overrides {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

/* Two-pane like the waveform settings form: scope nav on the LEFT, content on the RIGHT. */
.spectrum-overrides__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.spectrum-overrides__nav {
  flex: 0 0 132px;
  overflow: auto;
  padding: 4px 0;
}

.spectrum-overrides__nav--active {
  background: rgba(25, 118, 210, 0.12);
  color: var(--q-primary);
  font-weight: 600;
}

.spectrum-overrides__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.spectrum-overrides__content-head {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 4px 8px;
}

.spectrum-overrides__form {
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
