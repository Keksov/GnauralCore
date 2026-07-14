<template>
  <!-- PW5.6c/PW5.7b: the in-window «Список треков» adapter. Renders the pure TrackListView from a
       snapshot of the SHARED gtracks/overall singletons and applies its actions straight back through
       the shared applier. Voice mutes emit up to AudioPage (which saves unsaved curve edits first —
       PW5.6b — before the reload); the fix-preparse confirm dialog lives here. -->
  <TrackListView :snapshot="snapshot" @action="onAction" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import TrackListView from './TrackListView.vue'
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
const audio = useAudioStore()
const gtracks = useSharedGtrackLanes()
const overallGraphs = useOverallGraphs()

const snapshot = useTrackListSnapshot()

// BK8a: mute state is read from the dump (the editor model drops it); the actual voice_mute patch +
// reload is owned by AudioPage. From here we just emit — AudioPage.applyScheduleVoiceStatePatches
// saves unsaved curve edits first (PW5.6b), so this is safe even when the Треки tab is unmounted.
function isVoiceMuted(voiceId: number): boolean {
  return audio.gnauralSchedule?.voices.find((v) => v.id === voiceId)?.muted ?? false
}

function onAction(action: TrackListAction): void {
  // fix-preparse is confirmed here (adapter-side) before it touches gtracks.
  if (action.kind === 'fix-preparse') {
    promptFixPreparse(action.voiceId)
    return
  }
  applyTrackListAction(action, {
    gtracks,
    overall: overallGraphs,
    toggleVoiceMuted: (voiceId) => emit('patch-voice-state', { voiceId, muted: !isVoiceMuted(voiceId) }),
  })
}

// GT3.7 (owner req. 11 / R6): fixing bakes the generator's expansion into concrete points and loses
// the generator node on Save — irreversible, so confirm first.
function promptFixPreparse(voiceId: number): void {
  $q.dialog({
    title: t('audio.gtrackFixTitle'),
    message: t('audio.gtrackFixWarning'),
    ok: { label: t('audio.gtrackFix'), color: 'primary' },
    cancel: { label: t('audio.cancel'), flat: true },
    persistent: true,
  }).onOk(() => {
    if (gtracks.fixPreparseVoice(voiceId)) {
      $q.notify({ type: 'positive', message: t('audio.gtrackFixed') })
    }
  })
}
</script>
