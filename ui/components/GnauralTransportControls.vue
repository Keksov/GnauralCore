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
  </div>
</template>

<script setup lang="ts">
// MR2.1 (menu-redesign): the «Экспорт» dropdown moved out of the transport toolbar into
// Меню → Файл → Экспорт (a dialog in AudioPage). This component is now transport-only.
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
}>(), {
  startStopColor: 'primary',
  startStopFlat: false,
  startStopDisabled: false,
  pauseResumeDisabled: false,
  hideStartPause: false,
})

const emit = defineEmits<{
  'start-stop': []
  'pause-resume': []
}>()
</script>

<style scoped>
.gnaural-transport-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>