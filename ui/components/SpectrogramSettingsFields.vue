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
        v-model="sVal[field.key]"
        :options="field.options"
        dense outlined emit-value map-options
        class="spectrogram-fields__control"
      />
      <q-input
        v-else-if="field.kind === 'number'"
        v-model.number="sNum[field.key]"
        type="number"
        dense outlined
        class="spectrogram-fields__control"
      />
      <!-- SF16.1: numeric spinbox with -/+ steppers for the render dials. -->
      <q-input
        v-else-if="field.kind === 'spin'"
        v-model.number="sNum[field.key]"
        type="number"
        :min="field.spin!.min"
        :max="field.spin!.max"
        :step="field.spin!.step"
        dense outlined
        class="spectrogram-fields__control"
        @blur="clampField(field)"
      >
        <template #prepend>
          <q-btn dense flat round size="sm" icon="remove" :aria-label="'−'" @click="stepField(field, -1)" />
        </template>
        <template #append>
          <q-btn dense flat round size="sm" icon="add" :aria-label="'+'" @click="stepField(field, 1)" />
        </template>
      </q-input>
      <template v-else>
        <div class="spectrogram-fields__slider-value text-grey-7">
          {{ Number(sNum[field.key]).toFixed(field.slider!.decimals) }}
        </div>
        <q-slider
          v-model="sNum[field.key]"
          :min="field.slider!.min"
          :max="field.slider!.max"
          :step="field.slider!.step"
          dense
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// SS2.1: the field renderer, extracted verbatim from SpectrogramSettingsPanel so the tiles and the
// accordion layouts share ONE copy of it (a duplicated 50-line control block would be exactly the
// divergent-copy hazard this repo has been bitten by before). It binds v-model directly onto the
// global spectrogram store — the same object every group's instance edits, each at its own keys.
import { useI18n } from 'vue-i18n'
import { useSpectrogramStore } from '../stores/spectrogram'
import { clamp, type Field } from '../composables/spectrogram-settings-fields'

defineProps<{ readonly fields: readonly Field[] }>()

const { t } = useI18n()
const store = useSpectrogramStore()
const s = store.settings
// Same reactive object, loosely typed for the data-driven v-models (the field kind guarantees the
// runtime type; TS can't narrow s[field.key] from a dynamic key).
const sNum = s as unknown as Record<string, number>
const sVal = s as unknown as Record<string, string | number>

function stepField(aField: Field, aDir: number): void {
  const spec = aField.spin!
  const cur = Number(sNum[aField.key])
  sNum[aField.key] = clamp((Number.isFinite(cur) ? cur : 0) + aDir * spec.step, spec)
}
function clampField(aField: Field): void {
  const spec = aField.spin!
  const cur = Number(sNum[aField.key])
  sNum[aField.key] = clamp(Number.isFinite(cur) ? cur : spec.min, spec)
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
