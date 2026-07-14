<template>
  <!-- PW5.6c/PW5.7c: thin composition of the universal PanelWindow chrome (@panel) + the «Список
       треков» content. AudioPage teleports it to <body> when floating and hosts it as a flex child
       when docked; it renders only while the panel state is open (v-if host-side).
       In-window the slot renders TrackListPanel (binds the shared gtracks directly). Detached, the
       panel lives in a child OS window running TrackListRemote (PW-D11: no child-side gtracks): the
       parent pushes the live snapshot via :bridge-state and applies bridged actions via @panel-event. -->
  <PanelWindow
    :state="panel"
    :title="t('audio.tracksListPanel')"
    icon="queue_music"
    :bridge-state="snapshot"
    @panel-event="onBridgedEvent"
  >
    <TrackListPanel
      @patch-voice-state="(p) => emit('patch-voice-state', p)"
      @patch-voice-state-batch="(p) => emit('patch-voice-state-batch', p)"
    />
  </PanelWindow>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import PanelWindow from '@panel/PanelWindow.vue'
import { useTracksListPanelState } from '../stores/track-list-panel'
import TrackListPanel from './TrackListPanel.vue'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { useOverallGraphs } from '../composables/use-overall-graphs'
import { useAudioStore } from '../stores/audio'
import { useTrackListSnapshot } from '../composables/use-track-list-snapshot'
import { applyTrackListAction } from '../composables/track-list-actions'
import type { TrackListAction } from '../composables/track-list-model'

type VoiceStatePatch = { voiceId: number; muted?: boolean; hidden?: boolean; color?: string }

const emit = defineEmits<{
  'patch-voice-state': [patch: VoiceStatePatch]
  'patch-voice-state-batch': [patches: readonly VoiceStatePatch[]]
}>()

const { t } = useI18n()
const $q = useQuasar()
const panel = useTracksListPanelState()
const audio = useAudioStore()
const gtracks = useSharedGtrackLanes()
const overallGraphs = useOverallGraphs()

// PW5.7: the live snapshot pushed to the DETACHED child window (no-op while in-window — the child
// bridge is null; the slot's TrackListPanel renders the same data directly). Any mutation of the
// shared singletons recomputes it, and PanelWindow forwards the change to the child.
const snapshot = useTrackListSnapshot()

function isVoiceMuted(voiceId: number): boolean {
  return audio.gnauralSchedule?.voices.find((v) => v.id === voiceId)?.muted ?? false
}

// PW5.7c: an action performed in the DETACHED child arrives over the bridge and is applied to the
// authoritative singletons HERE (the in-window TrackListPanel is unmounted while detached). Mute
// round-trips through AudioPage (PW5.6b save-first + voice_mute patch + reload); fix-preparse was
// already confirmed child-side, so it applies directly and we notify.
function onBridgedEvent(name: string, payload: readonly unknown[]): void {
  if (name !== 'action') {
    return
  }
  applyTrackListAction(payload[0] as TrackListAction, {
    gtracks,
    overall: overallGraphs,
    toggleVoiceMuted: (voiceId) => emit('patch-voice-state', { voiceId, muted: !isVoiceMuted(voiceId) }),
    onFixed: () => $q.notify({ type: 'positive', message: t('audio.gtrackFixed') }),
  })
}
</script>
