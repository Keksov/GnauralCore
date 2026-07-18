<template>
  <!-- viewmode-graph-header (VH-D4): icon-only Audacity-style view-mode picker
       (waveform / spectrogram / both / overlay). Lives in each overall graph header,
       before the settings gear. The active mode shows as a check in the list + the tooltip. -->
  <q-btn-dropdown
    dense
    flat
    round
    size="xs"
    icon="layers"
    class="tracks-panel__gtrack-header-viewmode"
    :aria-label="t('audio.viewMode')"
  >
    <app-tooltip>{{ t('audio.viewMode') }}: {{ t(`audio.viewMode_${modelValue}`) }}</app-tooltip>
    <q-list dense style="min-width: 190px">
      <q-item
        v-for="m in AUDIO_VIEW_MODES"
        :key="m"
        clickable
        v-close-popup
        :active="m === modelValue"
        @click="emit('update:modelValue', m)"
      >
        <q-item-section avatar style="min-width: 26px">
          <q-icon v-if="m === modelValue" name="check" size="18px" />
        </q-item-section>
        <q-item-section>{{ t(`audio.viewMode_${m}`) }}</q-item-section>
      </q-item>
    </q-list>
  </q-btn-dropdown>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppTooltip from '@tooltip/AppTooltip.vue'

import { AUDIO_VIEW_MODES, type AudioViewMode } from '../composables/audio-view-mode'

defineProps<{
  /** Current view mode (owned + persisted by the host TracksPanel). */
  modelValue: AudioViewMode
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: AudioViewMode): void
}>()

const { t } = useI18n()
</script>
