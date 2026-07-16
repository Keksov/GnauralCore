<template>
  <div class="spectrogram-fields">
    <div v-for="field in fields" :key="field.key" class="spectrogram-fields__field">
      <div class="spectrogram-fields__label-row">
        <span class="spectrogram-fields__label">{{ field.label }}</span>
        <!-- SF13.3: per-parameter help. -->
        <q-icon
          name="help_outline"
          size="15px"
          class="spectrogram-fields__help"
          :aria-label="t('audio.spectrogramHelpFor', { field: field.label })"
          tabindex="0"
        >
          <q-menu anchor="bottom right" self="top right" max-width="280px">
            <div class="spectrogram-fields__help-text">{{ field.help }}</div>
          </q-menu>
        </q-icon>
      </div>

      <q-select
        v-if="field.kind === 'select'"
        :model-value="local[field.key]"
        :options="field.options"
        dense outlined emit-value map-options
        class="spectrogram-fields__control"
        @update:model-value="(v: string | number) => set(field.key, v)"
      />
      <q-input
        v-else-if="field.kind === 'number'"
        :model-value="local[field.key]"
        type="number"
        dense outlined
        class="spectrogram-fields__control"
        @update:model-value="(v: string | number | null) => set(field.key, toNumber(v))"
      />
      <!-- SF16.1 + SS2.6: numeric field; native arrows are the only stepper. @blur re-clamps. -->
      <q-input
        v-else-if="field.kind === 'spin'"
        :model-value="local[field.key]"
        type="number"
        :min="field.spin!.min"
        :max="field.spin!.max"
        :step="field.spin!.step"
        dense outlined
        class="spectrogram-fields__control"
        @update:model-value="(v: string | number | null) => set(field.key, toNumber(v))"
        @blur="clampField(field)"
      />
      <template v-else>
        <div class="spectrogram-fields__slider-value text-grey-7">
          {{ Number(local[field.key]).toFixed(field.slider!.decimals) }}
        </div>
        <q-slider
          :model-value="Number(local[field.key])"
          :min="field.slider!.min"
          :max="field.slider!.max"
          :step="field.slider!.step"
          dense
          @update:model-value="(v: number | null) => set(field.key, v ?? field.slider!.min)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// SS3.1 (SS-D2): the field renderer is now a PURE view — it reads its values from `values` (the
// snapshot's settings) and emits a `set` action per edit instead of mutating a store. This is what
// lets the same markup render in the detached child window (which has no store). @blur still clamps
// spinbox fields to the step grid + bounds, emitting the clamped value.
import { reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clamp, type Field } from '../composables/spectrogram-settings-fields'
import type { SpectrogramSettings } from '../composables/spectrogram-settings'
import type { SpectrumSettingsAction } from '../composables/spectrum-settings-model'

const props = defineProps<{
  readonly fields: readonly Field[]
  readonly values: SpectrogramSettings
}>()
const emit = defineEmits<{ action: [action: SpectrumSettingsAction] }>()

const { t } = useI18n()

// SS3.2: a LOCAL mirror of the values, so a controlled input stays smooth even when the authoritative
// value arrives asynchronously — in the detached child the round-trip (emit -> bridge -> parent store
// -> snapshot -> bridge -> prop) is async, and binding the raw prop would fight the user's typing. On
// input we update `local` immediately AND emit the action; when the snapshot echoes back we reconcile
// `local` to it (no-op if unchanged, so no loop). In the main window the echo is synchronous.
const local = reactive<Record<string, string | number>>({ ...(props.values as unknown as Record<string, string | number>) })
watch(
  () => props.values,
  (nv) => {
    const src = nv as unknown as Record<string, string | number>
    for (const k in src) {
      if (local[k] !== src[k]) local[k] = src[k]
    }
  },
  { deep: true },
)

function set(key: Field['key'], value: string | number): void {
  local[key] = value
  emit('action', { kind: 'set', key, value })
}
function toNumber(v: string | number | null): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function clampField(aField: Field): void {
  const spec = aField.spin!
  const cur = Number(local[aField.key])
  set(aField.key, clamp(Number.isFinite(cur) ? cur : spec.min, spec))
}
</script>

<style scoped>
.spectrogram-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spectrogram-fields__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spectrogram-fields__label-row {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 4px;
  justify-content: space-between;
}

.spectrogram-fields__label {
  min-width: 0;
}

.spectrogram-fields__help {
  cursor: help;
  flex: 0 0 auto;
  opacity: 0.6;
}

.spectrogram-fields__help:hover {
  opacity: 1;
}

.spectrogram-fields__help-text {
  font-size: 12px;
  line-height: 1.4;
  padding: 10px 12px;
}

.spectrogram-fields__slider-value {
  font-size: 12px;
  text-align: right;
}
</style>
