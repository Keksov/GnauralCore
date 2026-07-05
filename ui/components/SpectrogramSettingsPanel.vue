<template>
  <div class="spectrogram-settings">
    <div class="spectrogram-settings__presets">
      <!-- SF18: quick-apply dropdown (active ✓ + "modified" *) + Save as… / Manage…. -->
      <q-btn-dropdown dense flat no-caps icon="tune" :label="presetLabel" class="spectrogram-settings__field">
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

    <!-- SF13.1: Audacity-style groups (Масштаб / Цвет / FFT-фильтр). -->
    <div v-for="group in groups" :key="group.key" class="spectrogram-settings__group">
      <div class="spectrogram-settings__title">{{ group.title }}</div>

      <div v-for="field in group.fields" :key="field.key" class="spectrogram-settings__field">
        <div class="spectrogram-settings__label-row">
          <span class="spectrogram-settings__label">{{ field.label }}</span>
          <!-- SF13.3: per-parameter help. -->
          <q-icon
            name="help_outline"
            size="15px"
            class="spectrogram-settings__help"
            :aria-label="t('audio.spectrogramHelpFor', { field: field.label })"
            tabindex="0"
          >
            <q-menu anchor="bottom right" self="top right" max-width="280px">
              <div class="spectrogram-settings__help-text">{{ field.help }}</div>
            </q-menu>
          </q-icon>
        </div>

        <q-select
          v-if="field.kind === 'select'"
          v-model="sVal[field.key]"
          :options="field.options"
          dense outlined emit-value map-options
          class="spectrogram-settings__control"
        />
        <q-input
          v-else-if="field.kind === 'number'"
          v-model.number="sNum[field.key]"
          type="number"
          dense outlined
          class="spectrogram-settings__control"
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
          class="spectrogram-settings__control"
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
          <div class="spectrogram-settings__slider-value text-grey-7">
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

    <div class="spectrogram-settings__actions">
      <q-btn flat dense no-caps :label="t('audio.spectrogramReset')" icon="restart_alt" @click="store.reset()" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'

import { useSpectrogramStore } from '../stores/spectrogram'
import SpectrogramPresetManager from './SpectrogramPresetManager.vue'
import {
  SPECTROGRAM_DATA_MODES,
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_HIGH_ZOOM_MODES,
  SPECTROGRAM_IMAGE_SCALINGS,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WINDOW_SIZES,
  SPECTROGRAM_WIN_FUNCS,
  SPECTROGRAM_ZERO_PADDING,
  type SpectrogramSettings,
} from '../composables/spectrogram-settings'

const { t } = useI18n()
const $q = useQuasar()
const store = useSpectrogramStore()
const s = store.settings
// Same reactive object, loosely typed for the data-driven v-models (the field kind
// guarantees the runtime type; TS can't narrow s[field.key] from a dynamic key).
const sNum = s as unknown as Record<string, number>
const sVal = s as unknown as Record<string, string | number>

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
    cancel: true,
    persistent: false,
  }).onOk((aName: string) => {
    if (aName.trim() !== '') store.saveAsPreset(aName)
  })
}

type SelectableKey = keyof SpectrogramSettings

interface SliderSpec {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

// SF16.1: numeric spinbox spec (min/max/step + rounding decimals for the -/+ steppers).
interface SpinSpec {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

// SF13.2: enum -> localized option {label,value}. `optionsKey` is the i18n namespace
// holding one label per enum value (e.g. audio.spectrogramWinFuncOpt.hann).
function enumOptions(aList: readonly string[], aOptionsKey: string): { label: string; value: string }[] {
  return aList.map((v) => ({ label: t(`audio.${aOptionsKey}.${v}`), value: v }))
}
function numberOptions(aList: readonly number[], aSuffix = ''): { label: string; value: number }[] {
  return aList.map((v) => ({ label: `${v}${aSuffix}`, value: v }))
}

interface Field {
  readonly key: SelectableKey
  readonly kind: 'select' | 'number' | 'slider' | 'spin'
  readonly label: string
  readonly help: string
  readonly options?: { label: string; value: string | number }[]
  readonly slider?: SliderSpec
  readonly spin?: SpinSpec
}
interface Group {
  readonly key: string
  readonly title: string
  readonly fields: Field[]
}

// helpers building a field with its localized label + help.
const sel = (key: SelectableKey, labelKey: string, options: { label: string; value: string | number }[]): Field =>
  ({ key, kind: 'select', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), options })
const num = (key: SelectableKey, labelKey: string): Field =>
  ({ key, kind: 'number', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`) })
const sld = (key: SelectableKey, labelKey: string, slider: SliderSpec): Field =>
  ({ key, kind: 'slider', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), slider })
const spn = (key: SelectableKey, labelKey: string, spin: SpinSpec): Field =>
  ({ key, kind: 'spin', label: t(`audio.${labelKey}`), help: t(`audio.${labelKey}Help`), spin })

// SF16.1: -/+ stepper + clamp for spinbox fields (rounds to the spec step to avoid FP drift).
function clamp(aValue: number, aSpec: SpinSpec): number {
  const stepped = Math.round(aValue / aSpec.step) * aSpec.step
  const bounded = Math.min(aSpec.max, Math.max(aSpec.min, stepped))
  return Number(bounded.toFixed(aSpec.decimals))
}
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

// SF13.1 + SF13.2: grouped, localized (reactive to locale via t()).
const groups = computed<Group[]>(() => [
  {
    key: 'scale',
    title: t('audio.spectrogramGroupScale'),
    fields: [
      sel('fscale', 'spectrogramFreqScale', enumOptions(SPECTROGRAM_FSCALES, 'spectrogramFscaleOpt')),
      num('startHz', 'spectrogramStartHz'),
      num('stopHz', 'spectrogramStopHz'),
    ],
  },
  {
    key: 'color',
    title: t('audio.spectrogramGroupColor'),
    fields: [
      sel('scale', 'spectrogramIntensityScale', enumOptions(SPECTROGRAM_SCALES, 'spectrogramScaleOpt')),
      // SF16.1: numeric spinbox dials (default 0 where meaningful). Gain is in dB now.
      spn('gain', 'spectrogramGain', { min: -60, max: 60, step: 1, decimals: 0 }),
      spn('drange', 'spectrogramDynamicRange', { min: 10, max: 200, step: 5, decimals: 0 }),
      spn('limit', 'spectrogramLimit', { min: -100, max: 0, step: 1, decimals: 0 }),
      spn('frequencyGain', 'spectrogramFrequencyGain', { min: -60, max: 60, step: 1, decimals: 0 }),
      spn('saturation', 'spectrogramSaturation', { min: 0, max: 1, step: 0.1, decimals: 1 }),
      sel('palette', 'spectrogramPalette', enumOptions(SPECTROGRAM_PALETTES, 'spectrogramPaletteOpt')),
    ],
  },
  {
    key: 'fft',
    title: t('audio.spectrogramGroupFft'),
    fields: [
      sel('data', 'spectrogramAlgorithm', enumOptions(SPECTROGRAM_DATA_MODES, 'spectrogramDataOpt')),
      sel('window', 'spectrogramWindow', numberOptions(SPECTROGRAM_WINDOW_SIZES)),
      sel('winFunc', 'spectrogramWinFunc', enumOptions(SPECTROGRAM_WIN_FUNCS, 'spectrogramWinFuncOpt')),
      sel('zeroPaddingFactor', 'spectrogramZeroPad', numberOptions(SPECTROGRAM_ZERO_PADDING, 'x')),
      // SF14 (variant b): Overlap is the frame-step control; the worker hop is derived
      // from it. (The redundant Hop field was removed.)
      sld('overlap', 'spectrogramOverlap', { min: 0, max: 0.95, step: 0.05, decimals: 2 }),
      // SF14.1: 'Channel mode' removed (a no-op — the L/R split is UI-driven).
      // SF15.2: 'Channel' removed too — it was overridden by the L/R split (AudioPage always
      // opens channel 0 + channel 1 as two tracks), so the field did nothing.
    ],
  },
  {
    // SF17.2/17.3: sharpness controls for high zoom.
    key: 'sharpness',
    title: t('audio.spectrogramGroupSharpness'),
    fields: [
      sel('imageScaling', 'spectrogramImageScaling', enumOptions(SPECTROGRAM_IMAGE_SCALINGS, 'spectrogramImageScalingOpt')),
      sel('highZoomMode', 'spectrogramHighZoomMode', enumOptions(SPECTROGRAM_HIGH_ZOOM_MODES, 'spectrogramHighZoomModeOpt')),
      spn('highZoomThreshold', 'spectrogramHighZoomThreshold', { min: 2, max: 64, step: 1, decimals: 0 }),
      sel('highZoomWindow', 'spectrogramHighZoomWindow', numberOptions(SPECTROGRAM_WINDOW_SIZES)),
    ],
  },
])
</script>

<style scoped>
.spectrogram-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.spectrogram-settings__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.spectrogram-settings__title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
}

.spectrogram-settings__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spectrogram-settings__label-row {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 4px;
  justify-content: space-between;
}

.spectrogram-settings__label {
  min-width: 0;
}

.spectrogram-settings__help {
  cursor: help;
  flex: 0 0 auto;
  opacity: 0.6;
}

.spectrogram-settings__help:hover {
  opacity: 1;
}

.spectrogram-settings__help-text {
  font-size: 12px;
  line-height: 1.4;
  padding: 10px 12px;
}

.spectrogram-settings__slider-value {
  font-size: 12px;
  text-align: right;
}

.spectrogram-settings__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
