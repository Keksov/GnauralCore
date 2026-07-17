<template>
  <!-- SG3.2b (SG-D6/SG-D7/SG-D8, PW5.7 «пульт»): the PURE per-graph «Параметры» view. It renders from
       `snapshot` and emits one scope-qualified `action` per gesture — no store — so the SAME view
       renders in the main window (via the in-window adapter SpectrogramOverridesPanel) and in the
       detached child window (via SpectrogramOverridesRemote). The scope selector is LOCAL to the view:
       a vertical LEFT nav «Оба канала | Левый | Правый», exactly like the overall-waveform settings
       form; the right pane holds the presets + the settings form. No individual/inherit toggle (owner):
       the spectrum shows the program level by default, editing a field auto-creates the scope's
       override (SG-D8), «Сброс» drops it back, applying a preset writes the active scope.
       VS2.4 (VS-D3 rev 2): `mono` hides the scope nav — the per-lane solo-spectrum dialog reuses
       this exact view over a single override (its adapter maps every scope to the one laneSpectrum
       entry), so the lane dialog IS the program/overall form, just without L/R. -->
  <div class="spectrum-overrides">
    <div class="spectrum-overrides__body row no-wrap">
      <q-list v-if="!mono" class="spectrum-overrides__nav">
        <q-item
          v-for="opt in scopeOptions"
          :key="String(opt.value)"
          clickable
          :disable="opt.disable"
          :active="scope === opt.value"
          active-class="spectrum-overrides__nav--active"
          @click="selectScope(opt)"
        >
          <q-item-section>{{ opt.label }}</q-item-section>
        </q-item>
      </q-list>

      <q-separator v-if="!mono" vertical />

      <div class="spectrum-overrides__content">
        <div class="spectrum-overrides__content-head">
          <!-- SG3.4 (owner): «Применить к обоим каналам», the waveform-dialog link analog (same
               label key). Lives on the «Оба канала» scope like the waveform's toggle; while ON the
               «Левый»/«Правый» items are locked so the channels cannot diverge. -->
          <q-toggle
            v-if="!mono && scope === 'both'"
            :model-value="snapshot.linkChannels"
            dense
            :label="t('audio.waveformApplyBoth')"
            @update:model-value="(v: boolean) => emit('action', { kind: 'set-link', value: v })"
          />
          <q-space />
          <q-btn-dropdown dense flat no-caps icon="bookmarks" :disable="formDisabled" :label="t('audio.spectrogramPresets')">
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
          <SpectrogramSettingsView :snapshot="formSnapshot" :disabled="formDisabled" @action="onFieldAction" />
        </div>
      </div>
    </div>

    <div class="spectrum-overrides__footer">
      <q-btn
        flat dense no-caps
        icon="restart_alt"
        :label="t('audio.spectrogramReset')"
        :disable="formDisabled || !hasOverride"
        @click="emit('action', { kind: 'reset', scope })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const props = defineProps<{
  readonly snapshot: OverridesSnapshot
  /** VS2.4: hide the L/R scope nav — a mono target (e.g. a lane's solo spectrum) has one override;
   *  the scope stays 'both' and the host adapter maps it onto that single entry. */
  readonly mono?: boolean
}>()
const emit = defineEmits<{ action: [action: OverridesAction] }>()

const { t } = useI18n()

// Local scope selection (not bridged): the child picks what to show; only the resulting edit crosses.
const scope = ref<OverrideScope>('both')

// Named + laid out like the overall-waveform settings form (owner): a vertical «Оба канала / Левый /
// Правый» nav. SG3.4: while «Применить к обоим каналам» is ON the per-channel items are LOCKED
// (waveform owner req 6 analog) so the channels cannot diverge.
interface ScopeOption { readonly label: string; readonly value: OverrideScope; readonly disable: boolean }
const scopeOptions = computed<ScopeOption[]>(() => {
  const locked = props.snapshot.linkChannels
  return [
    { label: t('audio.waveformChannelsBoth'), value: 'both' as const, disable: false },
    { label: t('audio.waveformChannelsLeft'), value: 0 as const, disable: locked },
    { label: t('audio.waveformChannelsRight'), value: 1 as const, disable: locked },
  ]
})
// The guard must be OURS (the WS1.1 lesson): QItem's :disable drops its own click handling but a
// fallthrough @click still lands on the root element, and Quasar's .disabled rule only sets
// opacity/cursor, not pointer-events — without this a locked tab would still open on click.
function selectScope(opt: ScopeOption): void {
  if (opt.disable) return
  scope.value = opt.value
}
// A snapshot can arrive with the link ON while a per-channel scope is selected (e.g. the flag was
// flipped in the other window while detached) — coerce back to «Оба», never leave a locked scope active.
watch(
  () => props.snapshot.linkChannels,
  (linked) => {
    if (linked && scope.value !== 'both') scope.value = 'both'
  },
)

// The inner field form renders the effective settings for the active scope (override ?? program).
const formSnapshot = computed<SpectrumSettingsSnapshot>(() => ({
  settings: displayedForScope(props.snapshot, scope.value),
  presets: props.snapshot.presets,
  activePresetId: null,
  isModified: false,
}))

const hasOverride = computed<boolean>(() => scopeHasOverride(props.snapshot, scope.value))

// SG3.5 (owner, the WS-D3 mirror): with the link toggle OFF the «Оба канала» group is not in effect
// (the per-channel tabs own the rendered settings) — its whole form goes inert; only the toggle
// itself stays live. Mono (the per-lane panel) has no channels to link and never disables.
const formDisabled = computed<boolean>(
  () => !props.mono && scope.value === 'both' && !props.snapshot.linkChannels,
)

function onFieldAction(action: SpectrumSettingsAction): void {
  // The field view only emits field edits here (presets/reset are this view's own chrome).
  if (action.kind !== 'set' || formDisabled.value) return
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
