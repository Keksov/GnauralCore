<template>
  <div class="gnaural-transport-controls">
    <q-btn
      v-if="!hideStartPause"
      :color="startStopColor"
      :flat="startStopFlat"
      :icon="startStopIcon"
      :label="startStopLabel"
      :disable="startStopDisabled"
      @click="emit('start-stop')"
    />
    <q-btn
      v-if="!hideStartPause"
      color="primary"
      flat
      :icon="pauseResumeIcon"
      :label="pauseResumeLabel"
      :disable="pauseResumeDisabled"
      @click="emit('pause-resume')"
    />
    <q-btn-dropdown
      v-if="showExport"
      color="primary"
      flat
      icon="download"
      :label="t('audio.export')"
      :disable="exportDisabled"
      :loading="exportLoading"
    >
      <q-list dense>
        <q-item clickable v-close-popup @click="emit('export', 'wav')">
          <q-item-section>{{ t('audio.exportWav') }}</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="emit('export', 'flac')">
          <q-item-section>{{ t('audio.exportFlac') }}</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  readonly startStopIcon: string
  readonly startStopLabel: string
  readonly startStopColor?: string
  readonly startStopFlat?: boolean
  readonly startStopDisabled?: boolean
  readonly pauseResumeIcon: string
  readonly pauseResumeLabel: string
  readonly pauseResumeDisabled?: boolean
  readonly hideStartPause?: boolean
  readonly showExport?: boolean
  readonly exportDisabled?: boolean
  readonly exportLoading?: boolean
}>(), {
  startStopColor: 'primary',
  startStopFlat: false,
  startStopDisabled: false,
  pauseResumeDisabled: false,
  hideStartPause: false,
  showExport: false,
  exportDisabled: false,
  exportLoading: false,
})

const emit = defineEmits<{
  'start-stop': []
  'pause-resume': []
  export: [format: 'wav' | 'flac']
}>()

const { t } = useI18n()
</script>

<style scoped>
.gnaural-transport-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>