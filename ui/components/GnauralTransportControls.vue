<template>
  <div class="gnaural-transport-controls" :class="{ 'gnaural-transport-controls--toolbar': toolbar }">
    <!-- toolbar variant (owner 2026-07-15): icon-only buttons matching the spectrogram-header
         toolbar icons (dense/flat/round/sm + tooltip), used when the transport lives inline in
         the Треки toolbar to the left of the zoom controls. -->
    <template v-if="toolbar">
      <q-btn
        v-if="!hideStartPause"
        dense flat round size="sm"
        :color="startStopColor"
        :icon="startStopIcon"
        :disable="startStopDisabled"
        :aria-label="startStopLabel"
        @click="emit('start-stop')"
      >
        <q-tooltip>{{ startStopLabel }}</q-tooltip>
      </q-btn>
      <q-btn
        v-if="!hideStartPause"
        dense flat round size="sm"
        :icon="pauseResumeIcon"
        :disable="pauseResumeDisabled"
        :aria-label="pauseResumeLabel"
        @click="emit('pause-resume')"
      >
        <q-tooltip>{{ pauseResumeLabel }}</q-tooltip>
      </q-btn>
    </template>
    <template v-else>
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
    </template>
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
  // Render as icon-only toolbar buttons (see the toolbar variant in the template).
  readonly toolbar?: boolean
}>(), {
  startStopColor: 'primary',
  startStopFlat: false,
  startStopDisabled: false,
  pauseResumeDisabled: false,
  hideStartPause: false,
  toolbar: false,
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

/* Icon-only toolbar variant: tighten to the 4px gap the spectrogram-header toolbar uses. */
.gnaural-transport-controls--toolbar {
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
}
</style>