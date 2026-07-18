<template>
  <!-- PW5.7b: the pure «Список треков» view. Renders a serializable TrackListSnapshot and emits one
       TrackListAction per gesture — no gtracks/store access. Hosted by the in-window adapter
       (TrackListPanel) and, detached, by the child adapter (TrackListRemote, PW5.7c). -->
  <div class="track-list-panel">
    <!-- Bulk actions (owner req. 20) — gnaural-only (operate on schedule voices/lanes). -->
    <div v-if="snapshot.isGnaural" class="track-list-panel__bulk">
      <q-btn dense flat round size="sm" icon="call_merge" :aria-label="t('audio.gtrackMergeAll')" @click="emit('action', { kind: 'merge-all' })">
        <app-tooltip>{{ t('audio.gtrackMergeAll') }}</app-tooltip>
      </q-btn>
      <q-btn dense flat round size="sm" icon="call_split" :aria-label="t('audio.gtrackSpreadAll')" @click="emit('action', { kind: 'spread-all' })">
        <app-tooltip>{{ t('audio.gtrackSpreadAll') }}</app-tooltip>
      </q-btn>
      <!-- GT3.18 (owner req. 38): one lane per (voice × mode), grouped by voice. -->
      <q-btn dense flat round size="sm" icon="grid_view" :aria-label="t('audio.gtrackAllModes')" @click="emit('action', { kind: 'show-all-modes' })">
        <app-tooltip>{{ t('audio.gtrackAllModes') }}</app-tooltip>
      </q-btn>
      <!-- VS4.1 (owner, VS-D5г): the stacked variant — one lane per voice, all modes checked. -->
      <q-btn dense flat round size="sm" icon="view_agenda" :aria-label="t('audio.gtrackAllModesStacked')" @click="emit('action', { kind: 'show-all-modes-stacked' })">
        <app-tooltip>{{ t('audio.gtrackAllModesStacked') }}</app-tooltip>
      </q-btn>
      <q-btn
        dense flat round size="sm"
        :icon="snapshot.allLanesHidden ? 'visibility' : 'visibility_off'"
        :aria-label="snapshot.allLanesHidden ? t('audio.gtrackShowAll') : t('audio.gtrackHideAll')"
        @click="emit('action', { kind: 'set-all-hidden', hidden: !snapshot.allLanesHidden })"
      >
        <app-tooltip>{{ snapshot.allLanesHidden ? t('audio.gtrackShowAll') : t('audio.gtrackHideAll') }}</app-tooltip>
      </q-btn>
      <q-select
        class="track-list-panel__mode-all"
        dense options-dense outlined emit-value map-options
        :model-value="null"
        :display-value="t('audio.gtrackAllInMode')"
        :options="modeOptions"
        :aria-label="t('audio.gtrackAllInMode')"
        @update:model-value="(m: GTrackMode | null) => { if (m !== null) emit('action', { kind: 'set-all-mode', mode: m }) }"
      />
    </div>
    <q-separator v-if="snapshot.isGnaural" class="q-my-sm" />
    <!-- Per-voice rows: colour, name/type, graph type, visibility. -->
    <q-list dense>
      <!-- PW5.4: the OVERALL tracks (waveform + spectrogram) as list rows — names only, the eye
           collapses/expands (PW5.8: fully hides) the corresponding stack in the Треки tab. -->
      <q-item class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px"><q-icon name="waves" size="18px" color="grey-6" /></q-item-section>
        <q-item-section><q-item-label>{{ t('audio.tracksOverallWave') }}</q-item-label></q-item-section>
        <q-item-section side>
          <q-btn
            dense flat round size="sm"
            :icon="snapshot.waveHidden ? 'visibility_off' : 'visibility'"
            :color="snapshot.waveHidden ? 'grey-7' : undefined"
            :aria-label="t('audio.trackShow')"
            @click="emit('action', { kind: 'set-wave-hidden', hidden: !snapshot.waveHidden })"
          >
            <app-tooltip>{{ t('audio.trackShow') }}</app-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>
      <q-item class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px"><q-icon name="gradient" size="18px" color="grey-6" /></q-item-section>
        <q-item-section><q-item-label>{{ t('audio.tracksOverallSpectrum') }}</q-item-label></q-item-section>
        <q-item-section side>
          <q-btn
            dense flat round size="sm"
            :icon="snapshot.spectrumHidden ? 'visibility_off' : 'visibility'"
            :color="snapshot.spectrumHidden ? 'grey-7' : undefined"
            :aria-label="t('audio.trackShow')"
            @click="emit('action', { kind: 'set-spectrum-hidden', hidden: !snapshot.spectrumHidden })"
          >
            <app-tooltip>{{ t('audio.trackShow') }}</app-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>
      <q-separator v-if="snapshot.voices.length > 0" spaced />
      <q-item v-for="v in snapshot.voices" :key="v.id" class="track-list-panel__voice-row">
        <q-item-section avatar style="min-width: 22px">
          <span class="track-list-panel__voice-dot" :style="{ background: v.dotColor }" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ v.label }}</q-item-label>
          <q-item-label caption>
            {{ v.preparse ? `${v.type} · ${t('audio.gtrackGenerated')}` : v.type }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row items-center no-wrap q-gutter-xs">
            <!-- GT3.7 (owner req. 11): "fix / make editable" a generated (preparse) voice. The confirm
                 dialog lives in the adapter (in-window or child) — the view just requests it. -->
            <q-btn
              v-if="v.preparse"
              dense flat round size="sm"
              icon="lock_open"
              color="warning"
              :aria-label="t('audio.gtrackFix')"
              @click="emit('action', { kind: 'fix-preparse', voiceId: v.id })"
            >
              <app-tooltip>{{ t('audio.gtrackFixTooltip') }}</app-tooltip>
            </q-btn>
            <q-select
              class="track-list-panel__voice-mode"
              dense options-dense borderless emit-value map-options
              :model-value="v.mode"
              :options="modeOptions"
              :aria-label="t('audio.gtrackModeLabel')"
              @update:model-value="(m: GTrackMode) => emit('action', { kind: 'set-voice-mode', voiceId: v.id, mode: m })"
            />
            <q-btn
              dense flat round size="sm"
              :icon="v.visible ? 'visibility' : 'visibility_off'"
              :color="v.visible ? undefined : 'grey-7'"
              :aria-label="t('audio.trackShow')"
              @click="emit('action', { kind: 'set-voice-visible', voiceId: v.id, visible: !v.visible })"
            />
            <!-- BK8a: per-voice playback mute (persisted voice_mute), applied by AudioPage. -->
            <q-btn
              dense flat round size="sm"
              :icon="v.muted ? 'volume_off' : 'volume_up'"
              :color="v.muted ? 'grey-7' : undefined"
              :aria-label="v.muted ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute')"
              @click="emit('action', { kind: 'toggle-voice-muted', voiceId: v.id })"
            >
              <app-tooltip>{{ v.muted ? t('audio.scheduleTrackUnmute') : t('audio.scheduleTrackMute') }}</app-tooltip>
            </q-btn>
            <!-- owner 2026-07-13: include/exclude this voice from the OVERALL wave/spectrum. -->
            <q-btn
              dense flat round size="sm"
              icon="graphic_eq"
              :color="v.inMix ? undefined : 'grey-7'"
              :aria-label="v.inMix ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude')"
              @click="emit('action', { kind: 'set-voice-in-mix', voiceId: v.id, inMix: !v.inMix })"
            >
              <app-tooltip>{{ v.inMix ? t('audio.gtrackMixExclude') : t('audio.gtrackMixInclude') }}</app-tooltip>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
    <!-- Editor properties (GT-D16): point-drag mode — gnaural-only (curve editing). -->
    <template v-if="snapshot.isGnaural">
      <q-separator class="q-my-sm" />
      <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackDragMode') }}</div>
      <q-btn-toggle
        :model-value="snapshot.pointDragMode"
        dense unelevated no-caps spread
        toggle-color="primary"
        :options="[
          { label: t('audio.gtrackDragMode_crossover'), value: 'crossover' },
          { label: t('audio.gtrackDragMode_clamp'), value: 'clamp' },
        ]"
        @update:model-value="(m: GTrackPointDragMode) => emit('action', { kind: 'set-point-drag-mode', mode: m })"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GTRACK_MODES, type GTrackMode } from '../composables/gtrack-render'
import type { GTrackPointDragMode } from '../composables/use-gtrack-lanes'
import type { TrackListSnapshot, TrackListAction } from '../composables/track-list-model'
import AppTooltip from '@tooltip/AppTooltip.vue'

defineProps<{ snapshot: TrackListSnapshot }>()
const emit = defineEmits<{ action: [action: TrackListAction] }>()

const { t } = useI18n()
const modeOptions = computed(() => GTRACK_MODES.map((m) => ({ label: t(`audio.gtrackMode_${m}`), value: m })))
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
