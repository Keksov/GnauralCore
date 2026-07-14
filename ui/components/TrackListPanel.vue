<template>
  <!-- PW5.6c: the «Список треков» content, extracted from TracksPanel so it can be hosted at the
       AudioPage level (dockable full editor height, cross-tab) inside a PanelWindow. Edits go through
       the SHARED gtracks singleton; voice mutes emit up to AudioPage (which saves unsaved curve edits
       first — PW5.6b — before the reload). -->
  <div class="track-list-panel">
    <!-- Bulk actions (owner req. 20) — gnaural-only (operate on schedule voices/lanes). -->
    <div v-if="isGnaural" class="track-list-panel__bulk">
      <q-btn dense flat round size="sm" icon="call_merge" :aria-label="t('audio.gtrackMergeAll')" @click="gtracks.mergeAllIntoOneLane()">
        <q-tooltip>{{ t('audio.gtrackMergeAll') }}</q-tooltip>
      </q-btn>
      <q-btn dense flat round size="sm" icon="call_split" :aria-label="t('audio.gtrackSpreadAll')" @click="gtracks.spreadPerVoiceLanes()">
        <q-tooltip>{{ t('audio.gtrackSpreadAll') }}</q-tooltip>
      </q-btn>
      <!-- GT3.18 (owner req. 38): one lane per (voice × mode), grouped by voice. -->
      <q-btn dense flat round size="sm" icon="grid_view" :aria-label="t('audio.gtrackAllModes')" @click="gtracks.showAllModesPerVoice()">
        <q-tooltip>{{ t('audio.gtrackAllModes') }}</q-tooltip>
      </q-btn>
      <q-btn
        dense flat round size="sm"
        :icon="gtracks.allLanesHidden.value ? 'visibility' : 'visibility_off'"
        :aria-label="gtracks.allLanesHidden.value ? t('audio.gtrackShowAll') : t('audio.gtrackHideAll')"
        @click="gtracks.setAllLanesHidden(!gtracks.allLanesHidden.value)"
      >
        <q-tooltip>{{ gtracks.allLanesHidden.value ? t('audio.gtrackShowAll') : t('audio.gtrackHideAll') }}</q-tooltip>
      </q-btn>
      <q-select
        class="track-list-panel__mode-all"
        dense options-dense outlined emit-value map-options
        :model-value="null"
        :display-value="t('audio.gtrackAllInMode')"
        :options="GTRACK_MODES.map((m) => ({ label: t(`audio.gtrackMode_${m}`), value: m }))"
        :aria-label="t('audio.gtrackAllInMode')"
        @update:model-value="(m: GTrackMode | null) => { if (m !== null) gtracks.setAllLanesMode(m) }"
      />
    </div>
    <q-separator v-if="isGnaural" class="q-my-sm" />
    <!-- Per-voice rows: colour, name/type, graph type, visibility. -->
    <q-list dense>
      <!-- PW5.4: the OVERALL tracks (waveform + spectrogram) as list rows — names only, the eye
           collapses/expands the corresponding stack in the Треки tab (shared useOverallGraphs). -->
      <q-item class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px"><q-icon name="waves" size="18px" color="grey-6" /></q-item-section>
        <q-item-section><q-item-label>{{ t('audio.tracksOverallWave') }}</q-item-label></q-item-section>
        <q-item-section side>
          <q-btn
            dense flat round size="sm"
            :icon="overallGraphs.waveHidden.value ? 'visibility_off' : 'visibility'"
            :color="overallGraphs.waveHidden.value ? 'grey-7' : undefined"
            :aria-label="t('audio.trackShow')"
            @click="overallGraphs.setWaveHidden(!overallGraphs.waveHidden.value)"
          >
            <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>
      <q-item class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px"><q-icon name="gradient" size="18px" color="grey-6" /></q-item-section>
        <q-item-section><q-item-label>{{ t('audio.tracksOverallSpectrum') }}</q-item-label></q-item-section>
        <q-item-section side>
          <q-btn
            dense flat round size="sm"
            :icon="overallGraphs.spectrumHidden.value ? 'visibility_off' : 'visibility'"
            :color="overallGraphs.spectrumHidden.value ? 'grey-7' : undefined"
            :aria-label="t('audio.trackShow')"
            @click="overallGraphs.setSpectrumHidden(!overallGraphs.spectrumHidden.value)"
          >
            <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>
      <q-separator v-if="gtracks.voices.value.length > 0" spaced />
      <q-item v-for="(v, vi) in gtracks.voices.value" :key="v.id" class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px">
          <span class="track-list-panel__voice-dot" :style="{ background: voiceDotColor(v, vi) }" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ v.description.trim() !== '' ? v.description : `#${v.id}` }}</q-item-label>
          <q-item-label caption>
            {{ gtracks.isVoicePreparse(v.id) ? `${v.type} · ${t('audio.gtrackGenerated')}` : v.type }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row items-center no-wrap q-gutter-xs">
            <!-- GT3.7 (owner req. 11): "fix / make editable" a generated (preparse) voice. -->
            <q-btn
              v-if="gtracks.isVoicePreparse(v.id)"
              dense flat round size="sm"
              icon="lock_open"
              color="warning"
              :aria-label="t('audio.gtrackFix')"
              @click="promptFixPreparse(v.id)"
            >
              <q-tooltip>{{ t('audio.gtrackFixTooltip') }}</q-tooltip>
            </q-btn>
            <q-select
              class="track-list-panel__voice-mode"
              dense options-dense borderless emit-value map-options
              :model-value="gtracks.voiceMode(v.id)"
              :options="GTRACK_MODES.map((m) => ({ label: t(`audio.gtrackMode_${m}`), value: m }))"
              :aria-label="t('audio.gtrackModeLabel')"
              @update:model-value="(m: GTrackMode) => gtracks.setVoiceMode(v.id, m)"
            />
            <q-btn
              dense flat round size="sm"
              :icon="gtracks.isVoiceVisible(v.id) ? 'visibility' : 'visibility_off'"
              :color="gtracks.isVoiceVisible(v.id) ? undefined : 'grey-7'"
              :aria-label="t('audio.trackShow')"
              @click="gtracks.setVoiceVisible(v.id, !gtracks.isVoiceVisible(v.id))"
            />
            <!-- BK8a: per-voice playback mute (persisted voice_mute), migrated from ScheduleView. -->
            <q-btn
              dense flat round size="sm"
              :icon="isVoiceMuted(v.id) ? 'volume_off' : 'volume_up'"
              :color="isVoiceMuted(v.id) ? 'grey-7' : undefined"
              :aria-label="isVoiceMuted(v.id) ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute')"
              @click="onToggleVoiceMuted(v.id)"
            >
              <q-tooltip>{{ isVoiceMuted(v.id) ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute') }}</q-tooltip>
            </q-btn>
            <!-- owner 2026-07-13: include/exclude this voice from the OVERALL wave/spectrum. -->
            <q-btn
              dense flat round size="sm"
              icon="graphic_eq"
              :color="gtracks.isVoiceInMix(v.id) ? undefined : 'grey-7'"
              :aria-label="gtracks.isVoiceInMix(v.id) ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude')"
              @click="gtracks.setVoiceInMix(v.id, !gtracks.isVoiceInMix(v.id))"
            >
              <q-tooltip>{{ gtracks.isVoiceInMix(v.id) ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude') }}</q-tooltip>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
    <!-- Editor properties (GT-D16): point-drag mode — gnaural-only (curve editing). -->
    <template v-if="isGnaural">
      <q-separator class="q-my-sm" />
      <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackDragMode') }}</div>
      <q-btn-toggle
        :model-value="gtracks.pointDragMode.value"
        dense unelevated no-caps spread
        toggle-color="primary"
        :options="[
          { label: t('audio.gtrackDragMode_crossover'), value: 'crossover' },
          { label: t('audio.gtrackDragMode_clamp'), value: 'clamp' },
        ]"
        @update:model-value="(m: GTrackPointDragMode) => gtracks.setPointDragMode(m)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useSharedGtrackLanes, type GTrackPointDragMode } from '../composables/use-gtrack-lanes'
import { GTRACK_MODES, type GTrackMode } from '../composables/gtrack-render'
import { voiceDotColor } from '../composables/gtrack-voice-color'
import { useOverallGraphs } from '../composables/use-overall-graphs'
import { useAudioStore } from '../stores/audio'

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

// PW5.4-fix: plain audio files (wav/flac) have no gnaural voices/lanes -> hide the gnaural-only
// controls (bulk lane actions, point-drag mode), leaving just the overall wave/spectrum rows.
const isGnaural = computed(() => audio.displayMode === 'gnaural')

// BK8a: mute state is read from the dump (the editor model drops it); the actual voice_mute patch +
// reload is owned by AudioPage. From here we just emit — AudioPage.applyScheduleVoiceStatePatches
// saves unsaved curve edits first (PW5.6b), so this is safe even when the Треки tab is unmounted.
function isVoiceMuted(voiceId: number): boolean {
  return audio.gnauralSchedule?.voices.find((v) => v.id === voiceId)?.muted ?? false
}
function onToggleVoiceMuted(voiceId: number): void {
  emit('patch-voice-state', { voiceId, muted: !isVoiceMuted(voiceId) })
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

<style scoped>
.track-list-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.track-list-panel__bulk {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.track-list-panel__mode-all {
  flex: 1 1 auto;
  min-width: 140px;
}
.track-list-panel__voice-row {
  padding-left: 4px;
  padding-right: 4px;
}
.track-list-panel__voice-dot {
  border-radius: 50%;
  display: inline-block;
  height: 12px;
  width: 12px;
}
.track-list-panel__voice-mode {
  min-width: 96px;
}
</style>
