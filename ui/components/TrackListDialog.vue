<template>
  <!-- PW5.6c: thin composition of the universal PanelWindow chrome (@panel) + the TrackListPanel
       content, mirroring FileOpenDialog. AudioPage teleports it to <body> when floating and hosts it
       as a flex child when docked; it renders only while the panel state is open (v-if host-side). -->
  <PanelWindow :state="panel" :title="t('audio.tracksListPanel')" icon="queue_music">
    <TrackListPanel
      @patch-voice-state="(p) => emit('patch-voice-state', p)"
      @patch-voice-state-batch="(p) => emit('patch-voice-state-batch', p)"
    />
  </PanelWindow>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PanelWindow from '@panel/PanelWindow.vue'
import { useTracksListPanelState } from '../stores/track-list-panel'
import TrackListPanel from './TrackListPanel.vue'

type VoiceStatePatch = { voiceId: number; muted?: boolean; hidden?: boolean; color?: string }

const emit = defineEmits<{
  'patch-voice-state': [patch: VoiceStatePatch]
  'patch-voice-state-batch': [patches: readonly VoiceStatePatch[]]
}>()

const { t } = useI18n()
const panel = useTracksListPanelState()
</script>
