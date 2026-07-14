<template>
  <div ref="rootEl" :style="overlayFrame" class="audio-page__output-section audio-page__output-section--spectrogram tracks-panel__root">
    <!-- PW5.2: dock-wrap hosts the «Список треков» PanelWindow + the track content; docked -> reflow,
         floating -> teleported to <body>. .tracks-panel__dock-inner is the (new) scroll container. -->
    <div class="tracks-panel__dock-wrap" :class="tracksListDockWrapClass">
      <div class="tracks-panel__dock-inner">
    <div class="audio-page__player-toolbar">
      <!-- GT2.4: transport controls come from AudioPage (same pattern as GnauralScheduleView). -->
      <slot name="toolbar" />
    </div>

    <!-- GT2.6 fix: a spectrum error (e.g. a huge WAV that won't decode) is a non-blocking notice —
         the gtrack lanes still render from the schedule below it. -->
    <q-banner v-if="audio.spectrogramError !== null" dense rounded class="bg-orange-1 text-orange-10 q-mb-md">
      {{ audio.spectrogramError }}
    </q-banner>
    <!-- GT2.7: schedule (dump) problems were previously invisible here — the gtrack lanes silently
         didn't appear. Surface them so a failed/slow dump is obvious. -->
    <q-banner
      v-if="audio.displayMode === 'gnaural' && audio.gnauralScheduleError !== null"
      dense rounded class="bg-orange-1 text-orange-10 q-mb-md"
    >
      {{ audio.gnauralScheduleError }}
    </q-banner>
    <div v-if="showGtracks || hasSpectrogramData" class="row no-wrap items-start" style="gap: 16px;">
      <div class="col column" style="min-width: 0;">
        <!-- SF10.1: common header above the whole stack; all buttons here (once) -->
        <div class="audio-page__spectrogram-header">
          <q-btn dense flat round size="sm" icon="zoom_in" :disable="!spectrogramHasView" :aria-label="t('audio.spectrogramZoomIn')" @click="spectrogramZoomIn" />
          <q-btn dense flat round size="sm" icon="zoom_out" :disable="!spectrogramHasView" :aria-label="t('audio.spectrogramZoomOut')" @click="spectrogramZoomOut" />
          <q-btn dense flat round size="sm" icon="fit_screen" :disable="!spectrogramHasView || spectrogramIsFull" :aria-label="t('audio.spectrogramFit')" @click="spectrogramFit" />
          <q-space />
          <!-- SF28.5: hidden-tracks dropdown, just left of the view-mode dropdown. -->
          <q-btn-dropdown
            v-if="hiddenTrackList.length > 0"
            dense flat no-caps size="sm"
            icon="visibility_off"
            :label="`${t('audio.hiddenTracks')} (${hiddenTrackList.length})`"
            :aria-label="t('audio.hiddenTracks')"
          >
            <q-list dense style="min-width: 190px">
              <q-item
                v-for="h in hiddenTrackList"
                :key="h.key"
                clickable
                v-close-popup
                @click="h.restore()"
              >
                <q-item-section avatar style="min-width: 26px">
                  <q-icon name="visibility" size="18px" />
                </q-item-section>
                <q-item-section>{{ h.label }}</q-item-section>
                <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
              </q-item>
            </q-list>
          </q-btn-dropdown>
          <!-- SF23.3: Audacity-style view-mode dropdown (waveform / spectrogram / both / overlay). -->
          <q-btn-dropdown dense flat no-caps size="sm" icon="layers" :label="viewModeLabel" :aria-label="t('audio.viewMode')">
            <q-list dense style="min-width: 190px">
              <q-item
                v-for="m in AUDIO_VIEW_MODES"
                :key="m"
                clickable
                v-close-popup
                :active="m === viewMode"
                @click="viewMode = m"
              >
                <q-item-section avatar style="min-width: 26px">
                  <q-icon v-if="m === viewMode" name="check" size="18px" />
                </q-item-section>
                <q-item-section>{{ t(`audio.viewMode_${m}`) }}</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
          <!-- GT3.9: slide-over voice panel of the schedule (GT-D15). -->
          <q-btn
            v-if="audio.displayMode === 'gnaural'"
            dense flat round size="sm"
            icon="queue_music"
            :color="tracksListPanel.open ? 'primary' : undefined"
            :aria-label="t('audio.tracksListPanel')"
            :aria-expanded="tracksListPanel.open"
            @click="tracksListPanel.open = !tracksListPanel.open"
          >
            <q-tooltip>{{ t('audio.tracksListPanel') }}</q-tooltip>
          </q-btn>
          <!-- GT9.2 (owner req. 42): schedule problems (lint) badge — count + severity colour. -->
          <q-btn
            v-if="audio.displayMode === 'gnaural' && gtracks.diagnostics.value.length > 0"
            dense flat round size="sm"
            icon="report_problem"
            :color="diagnosticsSeverity === 'error' ? 'negative' : 'warning'"
            :aria-label="t('audio.gtrackProblems')"
            @click="diagnosticsOpen = !diagnosticsOpen"
          >
            <q-badge floating rounded :color="diagnosticsSeverity === 'error' ? 'negative' : 'warning'" text-color="dark">
              {{ gtracks.diagnostics.value.length }}
            </q-badge>
            <q-tooltip>{{ t('audio.gtrackProblems') }}</q-tooltip>
          </q-btn>
          <!-- GT2.2: add a gtrack editor lane (only for a gnaural file). -->
          <q-btn
            v-if="audio.displayMode === 'gnaural'"
            dense flat no-caps size="sm"
            icon="add"
            :label="t('audio.gtrackAddLane')"
            :aria-label="t('audio.gtrackAddLane')"
            @click="onAddLane"
          >
            <q-tooltip>{{ t('audio.gtrackAddLane') }}</q-tooltip>
          </q-btn>
          <!-- GT3.4: save the gtrack edits back to the .gnaural (highlighted while dirty; Ctrl+S too). -->
          <q-btn
            v-if="audio.displayMode === 'gnaural'"
            dense flat round size="sm"
            icon="save"
            :color="gtracks.dirty.value ? 'primary' : undefined"
            :loading="savingEdits"
            :disable="!gtracks.dirty.value || savingEdits"
            :aria-label="t('audio.gtrackSave')"
            @click="saveGtrackEdits"
          >
            <q-tooltip>{{ gtracks.dirty.value ? t('audio.gtrackSaveDirty') : t('audio.gtrackSave') }}</q-tooltip>
          </q-btn>
          <!-- GT3.14: point-mode tool switcher (owner req. 24) — Select (default) / Add / Delete.
               One global tool, applies in every lane currently in point mode. -->
          <template v-if="audio.displayMode === 'gnaural'">
            <q-btn
              dense flat round size="sm"
              icon="near_me"
              :color="gtracks.pointTool.value === 'select' ? 'primary' : undefined"
              :aria-label="t('audio.gtrackToolSelect')"
              @click="gtracks.setPointTool('select')"
            >
              <q-tooltip>{{ t('audio.gtrackToolSelect') }}</q-tooltip>
            </q-btn>
            <q-btn
              dense flat round size="sm"
              icon="add_circle"
              :color="gtracks.pointTool.value === 'add' ? 'primary' : undefined"
              :aria-label="t('audio.gtrackToolAdd')"
              @click="gtracks.setPointTool('add')"
            >
              <q-tooltip>{{ t('audio.gtrackToolAdd') }}</q-tooltip>
            </q-btn>
            <q-btn
              dense flat round size="sm"
              icon="remove_circle"
              :color="gtracks.pointTool.value === 'delete' ? 'primary' : undefined"
              :aria-label="t('audio.gtrackToolDelete')"
              @click="gtracks.setPointTool('delete')"
            >
              <q-tooltip>{{ t('audio.gtrackToolDelete') }}</q-tooltip>
            </q-btn>
          </template>
          <!-- SF27: waveform colour/scale moved to a per-track gear (see each track). -->
          <q-btn
            dense flat round size="sm"
            icon="tune"
            :color="spectrogramSettingsOpen ? 'primary' : undefined"
            :aria-label="t('audio.spectrogramSettingsTitle')"
            aria-controls="tracks-panel-settings"
            :aria-expanded="spectrogramSettingsOpen"
            @click="toggleSpectrogramSettings"
          />
        </div>
        <!-- GT2.2: gtrack editor lanes (schedule curves) above the waveform + spectrum.
             NOTE: MUST be PascalCase. Kebab <gtrack-view> resolves to "GtrackView" (lowercase t)
             and silently fails against the GTrackView import (kebab of GTrackView is g-track-view)
             — the lanes never rendered because of exactly this. -->
        <div v-if="showGtracks" class="audio-page__gtrack-stack">
          <template v-for="(lane, gIndex) in gtracks.visibleLanes.value" :key="lane.id">
            <!-- GT11.5 (owner 2026-07-14): per-track header bar — track-colour stripe on the left,
                 a Fold/Unfold toggle, and the wave name(s). Folding collapses this track's graphs
                 (curve + solo wave/spectrum sub-lanes) to just this bar. -->
            <div class="tracks-panel__gtrack-header" :data-gtrack-header="lane.id">
              <span
                class="tracks-panel__gtrack-header-stripe"
                :style="{ background: laneHeaderColor(lane) }"
              />
              <q-btn
                dense flat round size="xs"
                class="tracks-panel__gtrack-fold"
                :icon="lane.folded ? 'chevron_right' : 'expand_more'"
                :aria-label="lane.folded ? t('audio.gtrackUnfold') : t('audio.gtrackFold')"
                @click="gtracks.toggleLaneFolded(lane.id)"
              >
                <q-tooltip>{{ lane.folded ? t('audio.gtrackUnfold') : t('audio.gtrackFold') }}</q-tooltip>
              </q-btn>
              <!-- GT11.8/GT11.11: hidden solo sub-graphs of this track -> eye toggle -> restore. -->
              <q-btn
                v-if="laneHiddenGraphs(lane).length > 0"
                dense flat round size="xs"
                class="tracks-panel__gtrack-header-eye"
                icon="visibility_off"
                :aria-label="t('audio.hiddenTracks')"
              >
                <q-tooltip>{{ t('audio.hiddenTracks') }}</q-tooltip>
                <q-menu>
                  <q-list dense style="min-width: 160px">
                    <q-item v-for="h in laneHiddenGraphs(lane)" :key="h.key" clickable v-close-popup @click="h.restore()">
                      <q-item-section avatar style="min-width: 26px"><q-icon name="visibility" size="18px" /></q-item-section>
                      <q-item-section>{{ h.label }}</q-item-section>
                      <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
              <span
                class="tracks-panel__gtrack-header-title"
                :style="laneTitleStyle(lane)"
              >{{ gtrackLaneLabel(lane) }}</span>
            </div>
            <!-- GT4.2 (GT-D17): a curve lane sits over an optional inline solo-audio underlay -->
            <div
              v-show="!lane.folded"
              class="tracks-panel__gtrack-inline"
              :class="{ 'tracks-panel__gtrack-inline--new': lane.id === newLaneId }"
              :data-gtrack-lane-wrap="lane.id"
              :style="{ height: `${lane.curveHeight}px` }"
            >
              <waveform-view
                v-if="laneInlineKind(lane) === 'wave'"
                class="tracks-panel__gtrack-underlay"
                :style="{ opacity: lane.soloWaveOpacity }"
                :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :color="lane.soloWaveColor"
                :seekable="false"
                :height="lane.curveHeight"
                :show-time-axis-top="gIndex === firstUnfoldedGIndex"
                :show-time-axis-bottom="false"
              />
              <spectrogram-view
                v-else-if="laneInlineKind(lane) === 'spectrum'"
                class="tracks-panel__gtrack-underlay"
                :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :render="laneSpectrogramRender(lane.id)"
                :seekable="false"
                :primary="false"
                :height="lane.curveHeight"
                :show-time-axis-top="gIndex === firstUnfoldedGIndex"
                :show-time-axis-bottom="false"
              />
              <GTrackView
                class="tracks-panel__gtrack-over"
                :inline-underlay="laneInlineKind(lane) !== null"
                :data-gtrack-lane="lane.id"
                :voices="lane.voices"
                :mode="lane.mode"
                :duration-sec="gtracks.durationSec.value"
                :label="''"
                :height="lane.curveHeight"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="true"
                :show-time-axis-top="gIndex === firstUnfoldedGIndex"
                :show-time-axis-bottom="false"
                :point-mode="gtracks.isLanePointMode(lane.id)"
                :selection="gtracks.selectionForLane(lane.id)"
                :point-tool="gtracks.pointTool.value"
                :multi-selected="gtracks.multiSelection.value"
                :accent-color="laneAccentColor(lane)"
                :muted="laneMuted(lane)"
                :in-mix="laneInMix(lane)"
                :show-beat-band="lane.beatBand"
                :class="{ 'audio-page__track--dragging': gtrackDrag === lane.id }"
                @seek="handleSeek"
                @open-settings="gtrackSettingsId = lane.id"
                @hide="gtracks.setLaneHidden(lane.id, true)"
                @toggle-mute="onToggleLaneMuted(lane)"
                @toggle-in-mix="onToggleLaneInMix(lane)"
                @remove-lane="onRemoveLane(lane.id)"
                @reorder-grip="onGtrackGripDown(lane.id, $event)"
                @toggle-point-mode="gtracks.toggleLanePointMode(lane.id)"
                @select-point="(p: GTrackPointRef | null) => { gtracks.selectPoint(lane.id, p); gtracks.clearMultiSelection() }"
                @drag-start="(p: GTrackPointRef) => gtracks.beginPointDrag(p)"
                @drag-move="(e: GTrackDragMove) => gtracks.dragPoint(e.point, e.timeSec, e.value, lane.mode)"
                @drag-end="gtracks.endPointDrag()"
                @drag-cancel="gtracks.cancelPointDrag()"
                @edit-point="(p: GTrackPointRef) => openPointDialog(lane.id, p)"
                @add-point="(e: GTrackAddPoint) => onAddPoint(lane.id, e)"
                @delete-point-at="(p: GTrackPointRef) => gtracks.deletePointAt(lane.id, p)"
                @toggle-multi-select="(p: GTrackPointRef) => gtracks.toggleMultiSelect(p.voiceId, p.pointIndex)"
              />
            </div>
            <!-- GT11.7 (owner 2026-07-14): each gtrack graph has its OWN resize handle + height. -->
            <div
              v-if="!lane.folded"
              class="audio-page__spectrogram-bottom-handle"
              role="separator"
              aria-orientation="horizontal"
              :aria-label="t('audio.spectrogramResizeHandle')"
              @pointerdown="onGraphResizeDown(lane.id, 'curve', lane.curveHeight, $event)"
              @pointermove="onGraphResizeMove"
              @pointerup="onGraphResizeUp"
              @pointercancel="onGraphResizeUp"
            />
            <!-- GT4.3/GT4.1: solo audio shown as sub-lane(s) below (when not inline). -->
            <div v-if="laneWaveSublane(lane) && !lane.folded && !lane.soloWaveHidden" class="tracks-panel__sublane" :style="sublaneAccentStyle(lane)">
              <waveform-view
                :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :color="lane.soloWaveColor"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="false"
                :label="''"
                :height="lane.soloWaveHeight"
                :show-time-axis-top="false"
                :show-time-axis-bottom="false"
                @open-settings="gtrackSettingsId = lane.id"
                @hide="gtracks.setLaneSoloGraphHidden(lane.id, 'wave', true)"
              />
            </div>
            <div
              v-if="laneWaveSublane(lane) && !lane.folded && !lane.soloWaveHidden"
              class="audio-page__spectrogram-bottom-handle"
              role="separator"
              aria-orientation="horizontal"
              :aria-label="t('audio.spectrogramResizeHandle')"
              @pointerdown="onGraphResizeDown(lane.id, 'wave', lane.soloWaveHeight, $event)"
              @pointermove="onGraphResizeMove"
              @pointerup="onGraphResizeUp"
              @pointercancel="onGraphResizeUp"
            />
            <div v-if="laneSpectrumSublane(lane) && !lane.folded && !lane.soloSpectrumHidden" class="tracks-panel__sublane" :style="sublaneAccentStyle(lane)">
              <spectrogram-view
                :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :render="laneSpectrogramRender(lane.id)"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="false"
                :primary="false"
                :show-settings-gear="true"
                :label="''"
                :height="lane.soloSpectrumHeight"
                :show-time-axis-top="false"
                :show-time-axis-bottom="false"
                @open-settings="gtrackSettingsId = lane.id"
                @hide="gtracks.setLaneSoloGraphHidden(lane.id, 'spectrum', true)"
              />
            </div>
            <div
              v-if="laneSpectrumSublane(lane) && !lane.folded && !lane.soloSpectrumHidden"
              class="audio-page__spectrogram-bottom-handle"
              role="separator"
              aria-orientation="horizontal"
              :aria-label="t('audio.spectrogramResizeHandle')"
              @pointerdown="onGraphResizeDown(lane.id, 'spectrum', lane.soloSpectrumHeight, $event)"
              @pointermove="onGraphResizeMove"
              @pointerup="onGraphResizeUp"
              @pointercancel="onGraphResizeUp"
            />
          </template>
        </div>
        <!-- SF22: waveform tracks above the spectrogram (Audacity-style), sharing the view.
             SF25: same resizers as the spectrogram (mutual divider + uniform bottom handle). -->
        <template v-if="showWaveform && hasSpectrogramData && overallMixActive">
          <!-- GT11.10 (owner 2026-07-14): fold header bar for the OVERALL waveform stack. -->
          <div class="tracks-panel__gtrack-header tracks-panel__overall-header">
            <span class="tracks-panel__gtrack-header-stripe" :style="{ background: wfColor(0) }" />
            <q-btn
              dense flat round size="xs"
              class="tracks-panel__gtrack-fold"
              :icon="overallWaveFolded ? 'chevron_right' : 'expand_more'"
              :aria-label="overallWaveFolded ? t('audio.gtrackUnfold') : t('audio.gtrackFold')"
              @click="toggleOverallWaveFolded"
            >
              <q-tooltip>{{ overallWaveFolded ? t('audio.gtrackUnfold') : t('audio.gtrackFold') }}</q-tooltip>
            </q-btn>
            <!-- GT11.11 (owner 2026-07-14): hidden graphs in this group -> eye toggle -> restore list. -->
            <q-btn
              v-if="hiddenWaveList.length > 0"
              dense flat round size="xs"
              class="tracks-panel__gtrack-header-eye"
              icon="visibility_off"
              :aria-label="t('audio.hiddenTracks')"
            >
              <q-tooltip>{{ t('audio.hiddenTracks') }}</q-tooltip>
              <q-menu>
                <q-list dense style="min-width: 180px">
                  <q-item v-for="h in hiddenWaveList" :key="h.key" clickable v-close-popup @click="h.restore()">
                    <q-item-section avatar style="min-width: 26px"><q-icon name="visibility" size="18px" /></q-item-section>
                    <q-item-section>{{ h.label }}</q-item-section>
                    <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
            <span class="tracks-panel__gtrack-header-title">{{ t('audio.tracksOverallWave') }}</span>
          </div>
          <div v-show="!overallWaveFolded" class="audio-page__waveform-stack">
          <template v-for="(wtrack, wIndex) in waveformTracks" :key="wtrack.key">
            <waveform-view
              :ref="(el) => setPrimaryWaveformRef(el, wIndex)"
              :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
              :solo-voice-ids="gtracks.mixVoiceIds.value"
              :analysis="spectrogramAnalysisForChannel(wtrack.channel)"
              :channel="wtrack.channel"
              :label="''"
              :scale="wfScale(wtrack.channel)"
              :color="wfColor(wtrack.channel)"
              :playhead-sec="gtrackPlayheadSec"
              :seekable="canSeek"
              :show-time-axis-top="wIndex === 0"
              :show-time-axis-bottom="wIndex === waveformTracks.length - 1 && !showSpectrogram"
              :height="waveformTrackHeights[wIndex]"
              data-track-kind="waveform"
              :data-track-channel="wtrack.channel"
              :class="{ 'audio-page__track--dragging': trackDrag?.kind === 'waveform' && trackDrag?.channel === wtrack.channel }"
              @seek="handleSeek"
              @open-settings="openWaveformSettings(wtrack.channel)"
              @hide="hideTrack('waveform', wtrack.channel)"
              @reorder-grip="onTrackGripDown('waveform', wtrack.channel, $event)"
            />
            <div
              v-if="wIndex < waveformTracks.length - 1"
              class="audio-page__spectrogram-divider"
              role="separator"
              aria-orientation="horizontal"
              :aria-label="t('audio.spectrogramResizeHandle')"
              @pointerdown="onOverallResizeDown('waveform', wIndex, $event)"
              @pointermove="onOverallResizeMove"
              @pointerup="onOverallResizeUp"
              @pointercancel="onOverallResizeUp"
            />
          </template>
          <div
            class="audio-page__spectrogram-bottom-handle"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onOverallResizeDown('waveform', waveformTracks.length - 1, $event)"
            @pointermove="onOverallResizeMove"
            @pointerup="onOverallResizeUp"
            @pointercancel="onOverallResizeUp"
          />
          </div>
        </template>
        <!-- owner 2026-07-13: all voices excluded from the overall mix -> nothing to render. -->
        <div v-if="hasSpectrogramData && !overallMixActive" class="audio-page__empty text-grey-7">
          {{ t('audio.gtrackMixAllExcluded') }}
        </div>
        <template v-if="showSpectrogram && hasSpectrogramData && overallMixActive">
          <!-- GT11.10 (owner 2026-07-14): fold header bar for the OVERALL spectrogram stack. -->
          <div class="tracks-panel__gtrack-header tracks-panel__overall-header">
            <span class="tracks-panel__gtrack-header-stripe" :style="{ background: '#64748b' }" />
            <q-btn
              dense flat round size="xs"
              class="tracks-panel__gtrack-fold"
              :icon="overallSpectrumFolded ? 'chevron_right' : 'expand_more'"
              :aria-label="overallSpectrumFolded ? t('audio.gtrackUnfold') : t('audio.gtrackFold')"
              @click="toggleOverallSpectrumFolded"
            >
              <q-tooltip>{{ overallSpectrumFolded ? t('audio.gtrackUnfold') : t('audio.gtrackFold') }}</q-tooltip>
            </q-btn>
            <!-- GT11.11 (owner 2026-07-14): hidden graphs in this group -> eye toggle -> restore list. -->
            <q-btn
              v-if="hiddenSpectrumList.length > 0"
              dense flat round size="xs"
              class="tracks-panel__gtrack-header-eye"
              icon="visibility_off"
              :aria-label="t('audio.hiddenTracks')"
            >
              <q-tooltip>{{ t('audio.hiddenTracks') }}</q-tooltip>
              <q-menu>
                <q-list dense style="min-width: 180px">
                  <q-item v-for="h in hiddenSpectrumList" :key="h.key" clickable v-close-popup @click="h.restore()">
                    <q-item-section avatar style="min-width: 26px"><q-icon name="visibility" size="18px" /></q-item-section>
                    <q-item-section>{{ h.label }}</q-item-section>
                    <q-tooltip>{{ t('audio.trackShow') }}</q-tooltip>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
            <span class="tracks-panel__gtrack-header-title">{{ t('audio.tracksOverallSpectrum') }}</span>
          </div>
          <div v-show="!overallSpectrumFolded" class="audio-page__spectrogram-stack">
        <template v-for="(track, index) in spectrogramTracks" :key="track.key">
          <spectrogram-view
            :ref="(el) => setPrimarySpectrogramRef(el, index)"
            :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
            :solo-voice-ids="gtracks.mixVoiceIds.value"
            :analysis="track.analysis"
            :render="spectrogramStore.renderOptions"
            :window-override="spectrogramWindowOverride"
            :waveform-overlay="waveformOverlay"
            :waveform-scale="wfScale(track.channel)"
            :waveform-color="wfColor(track.channel)"
            :waveform-opacity="wfOpacity(track.channel)"
            :waveform-channel="track.channel"
            :playhead-sec="gtrackPlayheadSec"
            :seekable="canSeek"
            :label="''"
            :primary="track.primary"
            :show-time-axis-top="index === 0 && (!showWaveform || overallWaveFolded)"
            :show-time-axis-bottom="index === spectrogramTracks.length - 1"
            :height="spectrogramTrackHeights[index]"
            data-track-kind="spectrogram"
            :data-track-channel="track.channel"
            :class="{ 'audio-page__track--dragging': trackDrag?.kind === 'spectrogram' && trackDrag?.channel === track.channel }"
            @seek="handleSeek"
            @open-settings="openWaveformSettings(track.channel)"
            @hide="hideTrack('spectrogram', track.channel)"
            @reorder-grip="onTrackGripDown('spectrogram', track.channel, $event)"
          />
          <!-- SF9.2: 2px mutual-resize divider between adjacent tracks -->
          <div
            v-if="index < spectrogramTracks.length - 1"
            class="audio-page__spectrogram-divider"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onOverallResizeDown('spectrogram', index, $event)"
            @pointermove="onOverallResizeMove"
            @pointerup="onOverallResizeUp"
            @pointercancel="onOverallResizeUp"
          />
        </template>
          <!-- SF9.3: bottom handle resizes ALL tracks uniformly (SF-D20) -->
          <div
            class="audio-page__spectrogram-bottom-handle"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onOverallResizeDown('spectrogram', spectrogramTracks.length - 1, $event)"
            @pointermove="onOverallResizeMove"
            @pointerup="onOverallResizeUp"
            @pointercancel="onOverallResizeUp"
          />
          </div>
        </template>
        <!-- SF10.4: fixed bottom minimap-overview / timespan selector (SF-D24).
             B7: also renders a whole-clip spectrogram thumbnail (primary channel). -->
        <div v-if="showSpectrogram && hasSpectrogramData" class="audio-page__minimap-wrap">
          <spectrogram-minimap
            :duration-sec="spectrogramDuration"
            :file-path="audio.displayFilePath"
                :reload-key="spectrogramReloadKey"
            :analysis="spectrogramTracks[0]?.analysis"
            :render="spectrogramStore.renderOptions"
            :mode="minimapMode"
            :waveform-color="wfColor(0)"
            v-model:view="spectrogramView"
          />
          <!-- SF26: gear opens the minimap settings dialog. -->
          <q-btn
            dense flat round size="xs"
            icon="settings"
            class="audio-page__minimap-gear"
            :aria-label="t('audio.minimapMode')"
            @click="minimapSettingsOpen = true"
          >
            <q-tooltip>{{ t('audio.minimapMode') }}</q-tooltip>
          </q-btn>
        </div>

        <!-- SF26: minimap settings dialog (thumbnail content). -->
        <q-dialog v-model="minimapSettingsOpen">
          <q-card class="audio-page__minimap-dialog">
            <q-card-section class="row items-center q-pb-sm">
              <div class="text-subtitle1">{{ t('audio.minimapMode') }}</div>
              <q-space />
              <q-btn icon="close" flat round dense v-close-popup :aria-label="t('audio.spectrogramZoomClose')" />
            </q-card-section>
            <q-separator />
            <q-list>
              <q-item
                v-for="m in MINIMAP_MODES"
                :key="m"
                clickable
                v-close-popup
                :active="m === minimapMode"
                active-class="text-primary"
                @click="minimapMode = m"
              >
                <q-item-section avatar style="min-width: 30px">
                  <q-icon v-if="m === minimapMode" name="check" size="20px" />
                </q-item-section>
                <q-item-section>{{ t(`audio.minimapMode_${m}`) }}</q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </q-dialog>

        <!-- GT2.2: gtrack lane settings — display mode + which voices are shown. -->
        <q-dialog v-model="gtrackSettingsOpen">
          <q-card v-if="gtrackSettingsLane !== null" class="audio-page__gtrack-dialog">
            <q-card-section class="row items-center q-pb-sm">
              <div class="text-subtitle1">{{ t('audio.gtrackSettings') }}</div>
              <q-space />
              <q-btn icon="close" flat round dense v-close-popup :aria-label="t('audio.spectrogramZoomClose')" />
            </q-card-section>
            <q-separator />
            <q-card-section>
              <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackModeLabel') }}</div>
              <q-btn-toggle
                :model-value="gtrackSettingsLane.mode"
                dense unelevated no-caps spread
                toggle-color="primary"
                :options="GTRACK_MODES.map((m) => ({ label: t(`audio.gtrackMode_${m}`), value: m }))"
                @update:model-value="(m: GTrackMode) => gtracks.setLaneMode(gtrackSettingsLane!.id, m)"
              />
              <!-- owner 2026-07-14: beat-band shading (base ± beat/2), like the Schedule tab. Base mode only. -->
              <q-toggle
                v-if="gtrackSettingsLane.mode === 'base'"
                class="q-mt-sm"
                :model-value="gtrackSettingsLane.beatBand"
                dense
                :label="t('audio.gtrackBeatBand')"
                @update:model-value="(v: boolean) => gtracks.setLaneBeatBand(gtrackSettingsLane!.id, v)"
              />
            </q-card-section>
            <q-separator />
            <!-- GT4.3 (owner req. 21, GT-D17): solo spectrum of this lane's voice set, under the curves. -->
            <q-card-section>
              <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackSoloAudio') }}</div>
              <q-btn-toggle
                :model-value="gtrackSettingsLane.soloMode ?? 'off'"
                dense unelevated no-caps spread
                toggle-color="primary"
                :options="[
                  { label: t('audio.gtrackSoloOff'), value: 'off' },
                  { label: t('audio.gtrackSoloWave'), value: 'wave' },
                  { label: t('audio.gtrackSoloSpectrum'), value: 'spectrum' },
                  { label: t('audio.gtrackSoloBoth'), value: 'both' },
                ]"
                @update:model-value="(m: GTrackSoloMode) => gtracks.setLaneSolo(gtrackSettingsLane!.id, m)"
              />
              <div class="text-caption text-grey q-mt-xs">{{ t('audio.gtrackSoloHint') }}</div>
              <!-- GT4.2 (GT-D17): placement — under the curves (inline) or a sub-lane below. -->
              <q-btn-toggle
                v-if="(gtrackSettingsLane.soloMode ?? 'off') !== 'off'"
                class="q-mt-sm"
                :model-value="gtrackSettingsLane.soloInline ?? false"
                dense unelevated no-caps spread
                toggle-color="primary"
                :options="[
                  { label: t('audio.gtrackSoloSublane'), value: false },
                  { label: t('audio.gtrackSoloUnder'), value: true },
                ]"
                @update:model-value="(v: boolean) => gtracks.setLaneSoloInline(gtrackSettingsLane!.id, v)"
              />
              <!-- GT10.4 (owner req. 48): solo-wave colour + opacity. -->
              <template v-if="gtrackSettingsLane.soloMode === 'wave' || gtrackSettingsLane.soloMode === 'both'">
                <div class="row items-center q-col-gutter-sm q-mt-sm">
                  <div class="col-5">
                    <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackSoloWaveColor') }}</div>
                    <!-- GT10.20 (owner req. 69): the colour circle opens a colour picker on click. -->
                    <div
                      class="tracks-panel__color-swatch"
                      :style="{ background: gtrackSettingsLane.soloWaveColor ?? '#f59e0b' }"
                      role="button" tabindex="0"
                      :aria-label="t('audio.gtrackSoloWaveColor')"
                    >
                      <!-- GT10.20 (owner 2026-07-12): open to the RIGHT of the circle, with a close (X). -->
                      <q-popup-proxy anchor="top right" self="top left" :offset="[8, 0]" transition-show="scale" transition-hide="scale">
                        <div class="tracks-panel__color-popup">
                          <div class="row justify-end">
                            <q-btn flat round dense icon="close" v-close-popup :aria-label="t('audio.spectrogramSettingsClose')" />
                          </div>
                          <q-color
                            :model-value="gtrackSettingsLane.soloWaveColor ?? '#f59e0b'"
                            format-model="hex" no-header-tabs default-view="palette"
                            @update:model-value="(v) => gtracks.setLaneSoloWaveStyle(gtrackSettingsLane!.id, String(v ?? '#f59e0b'), gtrackSettingsLane!.soloWaveOpacity ?? 0.6)"
                          />
                        </div>
                      </q-popup-proxy>
                    </div>
                  </div>
                  <div class="col-7">
                    <div class="text-caption text-grey">
                      {{ t('audio.gtrackSoloWaveOpacity') }}: {{ (gtrackSettingsLane.soloWaveOpacity ?? 0.6).toFixed(2) }}
                    </div>
                    <q-slider
                      dense :min="0.1" :max="1" :step="0.05"
                      :model-value="gtrackSettingsLane.soloWaveOpacity ?? 0.6"
                      @update:model-value="(v) => gtracks.setLaneSoloWaveStyle(gtrackSettingsLane!.id, gtrackSettingsLane!.soloWaveColor ?? '#f59e0b', v ?? 0.6)"
                    />
                  </div>
                </div>
              </template>
            </q-card-section>
            <!-- GT8.1/GT8.2 (owner req. 35-37, GT-D19): per-lane spectrum settings (accordion),
                 independent of the global panel — shown when this lane displays a solo spectrum. -->
            <template v-if="gtrackSettingsLane.soloMode === 'spectrum' || gtrackSettingsLane.soloMode === 'both'">
              <q-separator />
              <q-card-section>
                <q-toggle
                  :model-value="gtracks.getLaneSpectrum(gtrackSettingsLane.id) !== null"
                  dense
                  :label="t('audio.gtrackSpectrumCustom')"
                  @update:model-value="(on: boolean) => toggleLaneSpectrumCustom(gtrackSettingsLane!.id, on)"
                />
                <GTrackSpectrumSettings
                  v-if="gtracks.getLaneSpectrum(gtrackSettingsLane.id) !== null"
                  class="q-mt-sm"
                  :model-value="gtracks.getLaneSpectrum(gtrackSettingsLane.id)!"
                  @update:model-value="(s) => gtracks.setLaneSpectrum(gtrackSettingsLane!.id, s)"
                />
              </q-card-section>
            </template>
            <q-separator />
            <q-card-section>
              <div class="text-caption text-grey q-mb-xs">{{ t('audio.gtrackVoices') }}</div>
              <q-list dense>
                <q-item v-for="v in gtracks.voices.value" :key="v.id" tag="label" clickable>
                  <q-item-section side>
                    <q-checkbox
                      :model-value="gtrackSettingsLane.voiceIds.includes(v.id)"
                      @update:model-value="() => gtracks.toggleLaneVoice(gtrackSettingsLane!.id, v.id)"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ v.description.trim() !== '' ? v.description : `#${v.id}` }}</q-item-label>
                    <q-item-label caption>{{ v.type }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
            <q-separator />
            <q-card-actions align="right">
              <q-btn
                flat no-caps color="negative"
                icon="delete"
                :label="t('audio.gtrackRemoveLane')"
                v-close-popup
                @click="gtracks.removeLane(gtrackSettingsLane.id)"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- SF27: per-track waveform settings (colour / amplitude scale / overlay opacity). -->
        <q-dialog v-model="waveformSettingsOpen">
          <q-card class="audio-page__minimap-dialog">
            <q-card-section class="row items-center q-pb-sm">
              <div class="text-subtitle1">
                {{ t('audio.waveformStyle') }}<span v-if="wfDlgLabel"> — {{ wfDlgLabel }}</span>
              </div>
              <q-space />
              <q-btn icon="close" flat round dense v-close-popup :aria-label="t('audio.spectrogramZoomClose')" />
            </q-card-section>
            <q-separator />
            <q-card-section class="q-gutter-md">
              <div class="row items-center justify-between no-wrap">
                <span class="text-body2">{{ t('audio.waveformColor') }}</span>
                <input type="color" v-model="wfDlgColor" class="audio-page__wf-color" />
              </div>
              <div class="row items-center justify-between no-wrap">
                <span class="text-body2">{{ t('audio.waveformScale') }}</span>
                <q-btn-toggle
                  v-model="wfDlgScale"
                  dense unelevated no-caps
                  toggle-color="primary"
                  :options="[{ label: 'lin', value: 'linear' }, { label: 'dB', value: 'db' }]"
                />
              </div>
              <div v-if="viewMode === 'overlay'">
                <div class="text-body2 q-mb-xs">{{ t('audio.waveformOpacity') }}: {{ Math.round(wfDlgOpacity * 100) }}%</div>
                <q-slider v-model="wfDlgOpacity" :min="0.1" :max="1" :step="0.05" dense />
              </div>
            </q-card-section>
          </q-card>
        </q-dialog>
      </div>
    </div>
    <div v-else-if="audio.spectrogramError === null" class="audio-page__empty text-grey-7">
      <!-- GT10.16 (owner req. 65): staged open progress (thin-client wording) instead of a vague
           "loading the file" phrase; especially relevant for gnaural (server render is a stage). -->
      <div v-if="openStages.length > 0" class="tracks-panel__stages">
        <div v-for="st in openStages" :key="st.key" class="tracks-panel__stage">
          <q-spinner v-if="st.active" size="14px" class="q-mr-sm" />
          <q-icon v-else name="check" size="14px" color="positive" class="q-mr-sm" />
          <span>{{ st.label }}</span>
        </div>
      </div>
      <template v-else>{{ noSpectrogramLabel }}</template>
    </div>
      </div><!-- /tracks-panel__dock-inner -->

    <!-- PW5.2 (was GT3.9/GT-D15 slide-over): the «Список треков» content now lives in the universal
         PanelWindow. floating -> teleported to <body>; docked -> flex sibling reflowing the tracks. -->
    <Teleport to="body" :disabled="!tracksListFloating">
      <PanelWindow
        v-if="tracksListPanel.open"
        :state="tracksListPanel"
        :title="t('audio.tracksListPanel')"
        icon="queue_music"
      >
        <div class="audio-page__spectrogram-settings-body tracks-panel__list-body">
          <!-- Bulk actions (owner req. 20). -->
          <div class="tracks-panel__voices-bulk">
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
              class="tracks-panel__voices-mode-all"
              dense options-dense outlined emit-value map-options
              :model-value="null"
              :display-value="t('audio.gtrackAllInMode')"
              :options="GTRACK_MODES.map((m) => ({ label: t(`audio.gtrackMode_${m}`), value: m }))"
              :aria-label="t('audio.gtrackAllInMode')"
              @update:model-value="(m: GTrackMode | null) => { if (m !== null) gtracks.setAllLanesMode(m) }"
            />
          </div>
          <q-separator class="q-my-sm" />
          <!-- Per-voice rows: colour, name/type, graph type, visibility. -->
          <q-list dense>
            <q-item v-for="(v, vi) in gtracks.voices.value" :key="v.id" class="tracks-panel__voice-row">
              <q-item-section avatar style="min-width: 22px">
                <span class="tracks-panel__voice-dot" :style="{ background: voiceDotColor(v, vi) }" />
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
                    class="tracks-panel__voice-mode"
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
          <q-separator class="q-my-sm" />
          <!-- Editor properties (GT-D16): point-drag mode. -->
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
        </div>
      </PanelWindow>
    </Teleport>
    </div><!-- /tracks-panel__dock-wrap -->

    <!-- GT9.2 (owner req. 42, GT-D21): schedule problems (lint) — slide-over list; click navigates. -->
    <transition name="spectrogram-settings-backdrop">
      <div v-if="diagnosticsOpen" class="audio-page__spectrogram-settings-backdrop" aria-hidden="true" @click="diagnosticsOpen = false" />
    </transition>
    <transition name="gtrack-voices-panel">
      <aside
        v-if="diagnosticsOpen"
        class="tracks-panel__voices-panel"
        role="dialog"
        aria-modal="false"
        :aria-label="t('audio.gtrackProblems')"
      >
        <div class="audio-page__spectrogram-settings-header">
          <div class="audio-page__spectrogram-settings-title">{{ t('audio.gtrackProblems') }} ({{ gtracks.diagnostics.value.length }})</div>
          <q-btn flat round dense icon="close" :aria-label="t('audio.spectrogramSettingsClose')" @click="diagnosticsOpen = false" />
        </div>
        <div class="audio-page__spectrogram-settings-body">
          <div v-if="gtracks.diagnostics.value.length === 0" class="text-caption text-grey q-pa-sm">
            {{ t('audio.gtrackNoProblems') }}
          </div>
          <q-list v-else dense separator>
            <q-item
              v-for="(d, i) in gtracks.diagnostics.value"
              :key="i"
              clickable
              @click="navigateToDiagnostic(d)"
            >
              <q-item-section avatar style="min-width: 28px">
                <q-icon
                  :name="d.severity === 'error' ? 'error' : 'warning'"
                  :color="d.severity === 'error' ? 'negative' : 'warning'"
                  size="20px"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label caption class="tracks-panel__diag-msg">{{ t(d.messageKey, d.messageParams) }}</q-item-label>
              </q-item-section>
              <!-- GT9.3: one-click auto-fix for the fixable rules (undoable; Ctrl+S to persist). -->
              <q-item-section side v-if="isDiagFixable(d)">
                <q-btn dense flat no-caps size="sm" color="primary" :label="t('audio.gtrackDiagFix')" @click.stop="fixDiagnostic(d)" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </aside>
    </transition>

    <!-- GT3.12 (GT-D18): non-modal live point inspector — NO backdrop (owner req. 26: the tracks
         stay fully interactive so the user can click other vertices to inspect them). Floats as a
         small panel instead of docking to an edge, so it doesn't block the whole stack.
         GT3.15 (owner req. 30): auto-switches to a TABLE when 2+ vertices are multi-selected. -->
    <transition name="gtrack-point-inspector">
      <aside
        v-if="inspectorMode !== 'none'"
        ref="inspectorEl"
        class="tracks-panel__point-inspector"
        :class="{ 'tracks-panel__point-inspector--table': inspectorMode === 'table' }"
        :style="inspectorStyle"
        role="dialog"
        aria-modal="false"
        :aria-label="t('audio.gtrackPointDialog')"
      >
        <!-- GT3.21 (owner req. 41): the title bar is a drag handle — move the inspector anywhere. -->
        <div class="audio-page__spectrogram-settings-header">
          <div
            class="audio-page__spectrogram-settings-title tracks-panel__inspector-drag"
            @pointerdown="onInspectorDragStart"
            @pointermove="onInspectorDragMove"
            @pointerup="onInspectorDragEnd"
            @pointercancel="onInspectorDragEnd"
          >
            <template v-if="inspectorMode === 'table'">
              {{ t('audio.gtrackMultiSelected', { count: gtracks.multiSelection.value.size }) }}
            </template>
            <template v-else>
              {{ t('audio.gtrackPointDialog') }}<span v-if="pointDialogVoiceName"> — {{ pointDialogVoiceName }}</span>
            </template>
          </div>
          <!-- GT10.8 (owner req. 52): undo/redo right in the inspector (model history has all steps). -->
          <q-btn
            flat round dense icon="undo" :disable="!gtracks.canUndo.value"
            :aria-label="t('audio.gtrackUndo')"
            @click="undoWithFocus()"
          >
            <q-tooltip>{{ t('audio.gtrackUndo') }}</q-tooltip>
          </q-btn>
          <q-btn
            flat round dense icon="redo" :disable="!gtracks.canRedo.value"
            :aria-label="t('audio.gtrackRedo')"
            @click="redoWithFocus()"
          >
            <q-tooltip>{{ t('audio.gtrackRedo') }}</q-tooltip>
          </q-btn>
          <q-btn
            flat round dense icon="close" :aria-label="t('audio.spectrogramSettingsClose')"
            @click="closeInspector"
          />
        </div>

        <!-- Table mode (owner req. 30): view + edit VALUE fields (not time — see GT-D16 note in
             the composable) across every multi-selected vertex, plus a bulk-delete action. -->
        <template v-if="inspectorMode === 'table'">
          <!-- GT10.22 (owner req. 71): Ctrl/Alt+Arrow big-step is handled in the window keydown
               (handleTracksKeyDown); data-step-field + data-step-row on each <td> identify the cell. -->
          <div class="audio-page__spectrogram-settings-body tracks-panel__multi-table-wrap">
            <q-markup-table dense flat dark class="tracks-panel__multi-table">
              <thead>
                <tr>
                  <th class="tracks-panel__col-chk"></th>
                  <th class="tracks-panel__col-num tracks-panel__col-idx">#</th>
                  <th class="tracks-panel__col-num">{{ t('audio.gtrackPointTime') }}</th>
                  <th class="tracks-panel__col-num">{{ t('audio.gtrackPointBase') }}</th>
                  <th class="tracks-panel__col-num">{{ t('audio.gtrackPointBeat') }}</th>
                  <th class="tracks-panel__col-num">{{ t('audio.gtrackPointVolL') }}</th>
                  <th class="tracks-panel__col-num">{{ t('audio.gtrackPointVolR') }}</th>
                </tr>
              </thead>
              <tbody>
                <!-- GT10.41 (owner req.): points grouped by voice under a collapsible header. -->
                <template v-for="group in groupedMultiForm" :key="group.voiceId">
                  <tr class="tracks-panel__group-row" @click="toggleGroup(group.voiceId)">
                    <td colspan="7">
                      <q-icon :name="collapsedGroups.has(group.voiceId) ? 'chevron_right' : 'expand_more'" size="18px" />
                      {{ group.name }} <span class="text-grey">({{ group.rows.length }})</span>
                    </td>
                  </tr>
                  <template v-if="!collapsedGroups.has(group.voiceId)">
                    <tr v-for="row in group.rows" :key="`${row.voiceId}:${row.pointIndex}`">
                      <td class="tracks-panel__col-chk"><q-checkbox v-model="row.checked" dense /></td>
                      <!-- GT10.43 (owner req.): the point's ordinal (index) within its voice. -->
                      <td class="tracks-panel__col-num tracks-panel__col-idx text-grey">{{ row.pointIndex }}</td>
                      <!-- GT10.40: time is read-only in the table (crossover reindexing would desync keys). -->
                      <td class="tracks-panel__col-num">{{ row.timeSec }}</td>
                      <td class="tracks-panel__col-num" data-step-field="baseFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                        <q-input
                          v-model.number="row.baseFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                          @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                        />
                      </td>
                      <td class="tracks-panel__col-num" data-step-field="beatFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                        <q-input
                          v-model.number="row.beatFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                          @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                        />
                      </td>
                      <td class="tracks-panel__col-num" data-step-field="volL" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                        <q-input
                          v-model.number="row.volL" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                          @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                        />
                      </td>
                      <td class="tracks-panel__col-num" data-step-field="volR" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                        <q-input
                          v-model.number="row.volR" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                          @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                        />
                      </td>
                    </tr>
                  </template>
                </template>
              </tbody>
            </q-markup-table>
            <q-checkbox
              :model-value="gtracks.pointAutosave.value" dense
              :label="t('audio.gtrackAutosave')"
              @update:model-value="(v) => gtracks.setPointAutosave(v === true)"
            />
          </div>
          <q-separator />
          <div class="tracks-panel__point-inspector-actions">
            <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeleteSelected')" :disable="!multiForm.some((r) => r.checked)" @click="removeCheckedRows" />
            <q-space />
            <q-btn
              v-if="!gtracks.pointAutosave.value"
              dense unelevated no-caps color="primary"
              :label="t('audio.spectrogramZoomApply')"
              @click="applyAllMultiRows"
            />
          </div>
        </template>

        <!-- Single-point mode (GT3.3/GT3.12): unchanged. -->
        <template v-else>
          <!-- GT10.22 (owner req. 71): Ctrl/Alt+Arrow big-step is handled in the window keydown
               (handleTracksKeyDown). Each field is tagged data-step-field (on a native display:contents
               span) so the handler can find the focused field. -->
          <div class="audio-page__spectrogram-settings-body q-gutter-sm">
            <!-- data-step-field lives on a native display:contents span (layout unchanged) so
                 closest() reliably finds it from the input regardless of QInput attr handling. -->
            <span data-step-field="timeSec" style="display: contents">
              <q-input
                v-model.number="pointForm.timeSec" dense outlined type="number" :step="fieldStep('0.01')" min="0"
                :label="t('audio.gtrackPointTime')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
              />
            </span>
            <span data-step-field="baseFreq" style="display: contents">
              <q-input
                v-model.number="pointForm.baseFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
                :label="t('audio.gtrackPointBase')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
              />
            </span>
            <span data-step-field="beatFreq" style="display: contents">
              <q-input
                v-model.number="pointForm.beatFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
                :label="t('audio.gtrackPointBeat')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
              />
            </span>
            <!-- GT3.11 (owner req. 22): plain flex gap — q-col-gutter's negative margins made
                 these overlap the beat-frequency field inside a q-gutter parent. -->
            <div class="tracks-panel__vol-row">
              <span data-step-field="volL" style="display: contents">
                <q-input
                  v-model.number="pointForm.volL" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
                  :label="t('audio.gtrackPointVolL')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
                />
              </span>
              <span data-step-field="volR" style="display: contents">
                <q-input
                  v-model.number="pointForm.volR" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
                  :label="t('audio.gtrackPointVolR')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
                />
              </span>
            </div>
            <!-- Derived controls (GT-D6): editing them maps back onto volL/volR. -->
            <!-- GT10.37 (owner 2026-07-12): Volume is a numeric field with steppers (was a slider). -->
            <q-input
              :model-value="Number(pointFormVolume.toFixed(3))" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
              :label="t('audio.gtrackMode_volume')"
              @update:model-value="(v) => setPointFormVolume(Number(v) || 0)"
              @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
            <template v-if="!pointDialogVoiceMono">
              <div class="text-caption text-grey">{{ t('audio.gtrackMode_balance') }}: {{ pointFormBalance.toFixed(2) }}</div>
              <!-- GT10.38 (owner 2026-07-12): horizontal padding so the thumb doesn't overflow the dialog. -->
              <div class="tracks-panel__balance-slider">
                <q-slider
                  :model-value="pointFormBalance" :min="-1" :max="1" :step="0.01" dense
                  @update:model-value="(v) => setPointFormBalance(v ?? 0)" @change="maybeAutosave"
                />
              </div>
            </template>
            <q-checkbox
              :model-value="gtracks.pointAutosave.value" dense
              :label="t('audio.gtrackAutosave')"
              @update:model-value="(v) => gtracks.setPointAutosave(v === true)"
            />
          </div>
          <q-separator />
          <div class="tracks-panel__point-inspector-actions">
            <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeletePoint')" @click="deleteCurrentPointFromDialog" />
            <q-btn dense flat no-caps icon="add" :label="t('audio.gtrackAddPointRight')" :disable="!pointDialogHasNext" @click="addPointToRight" />
            <q-space />
            <q-btn
              v-if="!gtracks.pointAutosave.value"
              dense unelevated no-caps color="primary"
              :label="t('audio.spectrogramZoomApply')"
              @click="applyPointDialog"
            />
          </div>
        </template>
      </aside>
    </transition>

    <!-- SF3.1 (SF-D4/D5): settings panel as a toggleable overlay "Параметры" -->
    <transition name="spectrogram-settings-backdrop">
      <div
        v-if="spectrogramSettingsOpen"
        class="audio-page__spectrogram-settings-backdrop"
        aria-hidden="true"
        @click="closeSpectrogramSettings"
      />
    </transition>
    <transition name="spectrogram-settings-panel">
      <aside
        v-if="spectrogramSettingsOpen"
        id="tracks-panel-settings"
        class="audio-page__spectrogram-settings-panel"
        role="dialog"
        aria-modal="false"
        :aria-label="t('audio.spectrogramSettingsTitle')"
      >
        <div class="audio-page__spectrogram-settings-header">
          <div class="audio-page__spectrogram-settings-title">{{ t('audio.spectrogramSettingsTitle') }}</div>
          <q-btn
            flat round dense
            icon="close"
            :aria-label="t('audio.spectrogramSettingsClose')"
            @click="closeSpectrogramSettings"
          />
        </div>
        <div class="audio-page__spectrogram-settings-body">
          <spectrogram-settings-panel />
        </div>
      </aside>
    </transition>
  </div>
</template>

<script setup lang="ts">
// GT2.4 (GT-D10a): the "Треки" tab — the ENTIRE new track stack, moved verbatim out of
// AudioPage.vue (which was then restored to its pre-GT2.2 frozen state, GT2.5). This panel is the
// single surface for all new editor functionality (gtracks + waveform + spectrum on one form).
// Deliberate duplication of the frozen Spectrogram tab (risk R7): fixes land HERE only.
// Isolation per GT-D10: OWN spectrogramShared (zoom/selection) + OWN localStorage keys
// ('mindwave-tracks-*'), so the frozen tab and this one never influence each other.

import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type AsyncComponentLoader, type Component } from 'vue'
import { QSpinnerHourglass, useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'

import type { SpectrogramAnalysisParams } from '@protocol'

import { audioApi } from '../audio-api'
import SpectrogramMinimap from './SpectrogramMinimap.vue'
import SpectrogramView from './SpectrogramView.vue'
import WaveformView from './WaveformView.vue'
import GTrackView from './GTrackView.vue'
import PanelWindow from '@panel/PanelWindow.vue'
import { useTracksListPanelState } from '../stores/track-list-panel'
import GTrackSpectrumSettings from './GTrackSpectrumSettings.vue'
import { findPreparseVoiceIds, patchGnauralXml } from '../composables/gtrack-xml'
import { toAnalysisParams, toRenderOptions } from '../composables/spectrogram-settings'
import { useSpectrogram } from '../composables/use-spectrogram'
import { useSharedGtrackLanes, type GTrackAddPoint, type GTrackDragMove, type GTrackPointDragMode, type GTrackPointRef, type GTrackSoloMode } from '../composables/use-gtrack-lanes'
import type { GTrackDiagnostic } from '../composables/gtrack-lint'
import type { GTrackVoice } from '../composables/gtrack-model'
import { GTRACK_MODES, ctrlStepValue, type GTrackMode } from '../composables/gtrack-render'
import {
  fullWindow,
  isFullWindow,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
} from '../composables/spectrogram-viewport'
import { useAudioStore } from '../stores/audio'
import { useSpectrogramStore } from '../stores/spectrogram'

interface Props {
  /** Displayed playback position (drives the playheads). */
  positionSec: number | null
  canSeek: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{
  (event: 'seek', sec: number): void
  /** Space hotkey — AudioPage owns the transport, so toggling play is delegated up. */
  (event: 'toggle-play'): void
  /** BK8a: per-voice playback mute (persisted voice_mute). AudioPage owns the schedule patch+reload. */
  (event: 'patch-voice-state', patch: { voiceId: number; muted?: boolean; hidden?: boolean; color?: string }): void
  /** BK8a: batch mute for a multi-voice lane — one server round-trip + reload. */
  (event: 'patch-voice-state-batch', patches: readonly { voiceId: number; muted?: boolean; hidden?: boolean; color?: string }[]): void
}>()

// Aliases keep the moved template byte-identical to the frozen original.
const displayedPositionSec = computed(() => props.positionSec)
const canSeek = computed(() => props.canSeek)
// GT10.32 (owner 2026-07-12): the Tracks editor keeps a PERSISTENT local playhead so clicking a
// curve (or arrow-key seek) places a visible position cursor even when the transport is STOPPED —
// the shared optimistic seek reverts to 0 once the transport is idle, which made the cursor snap
// back to 0. (gtrackPlayheadSec + the reactivity live after the audio store is created below.)
const localPlayheadSec = ref<number | null>(null)
// GT10.28 (owner req. 77): after "+ lane" adds an (empty) lane, scroll the editor to it and flash a
// highlight so the user sees where the new lane landed.
const newLaneId = ref<number | null>(null)
let newLaneTimer: ReturnType<typeof setTimeout> | null = null
function onAddLane(): void {
  const id = gtracks.addLane()
  newLaneId.value = id
  if (newLaneTimer !== null) clearTimeout(newLaneTimer)
  newLaneTimer = setTimeout(() => { newLaneId.value = null; newLaneTimer = null }, 1800)
  void nextTick(() => {
    document.querySelector(`[data-gtrack-lane-wrap="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}
// GT10.44 (owner 2026-07-13): the trash icon fully removes the lane (no confirm) but offers an
// immediate Undo via the notification, restoring it at its previous position.
function onRemoveLane(id: number): void {
  const removed = gtracks.removeLane(id)
  if (removed === null) return
  $q.notify({
    type: 'info',
    message: t('audio.gtrackLaneRemoved'),
    timeout: 6000,
    actions: [{ label: t('audio.gtrackUndo'), color: 'white', handler: () => gtracks.restoreLane(removed.lane, removed.index) }],
  })
}
function handleSeek(aSec: number): void {
  localPlayheadSec.value = aSec // persistent local cursor (survives an idle transport)
  // GT10.32 (owner 2026-07-12): only issue the REAL transport seek when a session is actually
  // active — seeking an idle gnaural session errors ("Gnaural session is not active"). The visible
  // local cursor is set regardless of transport state.
  if (audio.transportState === 'playing' || audio.transportState === 'paused') emit('seek', aSec)
}

// GT-D10: OWN storage keys — never shared with the frozen Spectrogram tab.
const STORAGE_TRACKS_SPECTROGRAM_TRACK_HEIGHTS = 'mindwave-tracks-spectrogram-track-heights'
// Audacity-like default spectrogram track height (per channel), in px (SF5.1).
const SPECTROGRAM_TRACK_HEIGHT_DEFAULT = 260
const SPECTROGRAM_TRACK_HEIGHT_MIN = 120
const SPECTROGRAM_TRACK_HEIGHT_MAX = 1200

const AsyncPanelLoading = defineComponent({
  name: 'AsyncTracksPanelLoading',
  setup() {
    return () => h('div', { class: 'audio-page__async-placeholder' }, [
      h(QSpinnerHourglass, { color: 'primary', size: '28px' }),
    ])
  },
})

function createAsyncPanel(loader: AsyncComponentLoader<Component>) {
  return defineAsyncComponent({
    loader,
    delay: 120,
    loadingComponent: AsyncPanelLoading,
  })
}

const SpectrogramSettingsPanel = createAsyncPanel(() => import('./SpectrogramSettingsPanel.vue'))

function clampTrackHeight(aValue: number): number {
  return Math.max(SPECTROGRAM_TRACK_HEIGHT_MIN, Math.min(SPECTROGRAM_TRACK_HEIGHT_MAX, Math.round(aValue)))
}

function loadStoredSpectrogramTrackHeights(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_TRACKS_SPECTROGRAM_TRACK_HEIGHTS)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(clampTrackHeight)
  } catch {
    return []
  }
}

function persistSpectrogramTrackHeights(aHeights: readonly number[]): void {
  try {
    localStorage.setItem(STORAGE_TRACKS_SPECTROGRAM_TRACK_HEIGHTS, JSON.stringify(aHeights))
  } catch {
    // Ignore storage failures and keep the in-memory heights working.
  }
}

const { t } = useI18n()
const $q = useQuasar()
const audio = useAudioStore()
// GT10.32 (owner 2026-07-12): the Tracks playhead shows the real position while playing, else the
// persistent local cursor (handleSeek above). Declared here — the immediate watch getters need the
// audio store, so this must come AFTER `audio` is created (else a TDZ ReferenceError at setup).
const gtrackPlayheadSec = computed(() =>
  audio.transportState === 'playing' ? displayedPositionSec.value : (localPlayheadSec.value ?? displayedPositionSec.value),
)
watch(() => audio.transportState, (st) => { if (st === 'playing') localPlayheadSec.value = null })
watch(() => audio.displayFilePath, () => { localPlayheadSec.value = null })
const spectrogramStore = useSpectrogramStore()
// GT2.2: gtrack editor lanes for the open .gnaural, shown in the spectrogram stack alongside the
// waveform + spectrum (GT-D2). Lanes appear only for a gnaural file with a loaded schedule.
// PW5.6 (PW-D10): shared singleton so the AudioPage-hosted «Список треков» panel and this tab edit
// the SAME gtrack state.
const gtracks = useSharedGtrackLanes()
const showGtracks = computed(() => audio.displayMode === 'gnaural' && gtracks.visibleLanes.value.length > 0)
// PW5.2 (PW-D9): the schedule voice list is now the dockable/floating «Список треков» PanelWindow
// (@panel), hosted here so it shares this component's gtracks state. Floating teleports to <body>;
// docked reflows the tracks via the dock-wrap (see template + styles).
const tracksListPanel = useTracksListPanelState()
const tracksListFloating = computed(() => tracksListPanel.mode === 'floating')
const tracksListDockWrapClass = computed(() =>
  tracksListPanel.mode === 'top' || tracksListPanel.mode === 'bottom'
    ? 'tracks-panel__dock-wrap--col'
    : 'tracks-panel__dock-wrap--row',
)

// GT9.2 (owner req. 42, GT-D21): schedule-problems (lint) panel. Diagnostics are live from the
// composable (re-linted on every edit). Clicking one navigates to the offending point.
const diagnosticsOpen = ref(false)
const diagnosticsSeverity = computed<'error' | 'warning' | null>(() => {
  const ds = gtracks.diagnostics.value
  if (ds.some((d) => d.severity === 'error')) return 'error'
  return ds.length > 0 ? 'warning' : null
})
function navigateToDiagnostic(d: GTrackDiagnostic): void {
  const lane = gtracks.visibleLanes.value.find((l) => l.voiceIds.includes(d.voiceId))
  if (lane === undefined) {
    // The voice has no visible lane (e.g. an audiofile/noise voice not shown) — point the user there.
    $q.notify({ type: 'info', message: t('audio.gtrackProblemVoiceHidden') })
    return
  }
  if (!gtracks.isLanePointMode(lane.id)) gtracks.toggleLanePointMode(lane.id)
  if (d.pointIndex !== null) {
    gtracks.selectPoint(lane.id, { voiceId: d.voiceId, pointIndex: d.pointIndex })
    gtracks.clearMultiSelection()
  }
  diagnosticsOpen.value = false
}
// GT9.3 (owner req. 42, GT-D21): confirmed one-click fixes for the fixable diagnostics. The explicit
// button + full undo + the separate Ctrl+S Save are the safeguards (nothing persists until Save).
function isDiagFixable(d: GTrackDiagnostic): boolean {
  return d.rule === 'end-click' || d.rule === 'loop-click'
}
function fixDiagnostic(d: GTrackDiagnostic): void {
  const ok = d.rule === 'end-click' ? gtracks.fixEndClick(d.voiceId)
    : d.rule === 'loop-click' ? gtracks.fixLoopClick(d.voiceId)
    : false
  $q.notify(ok
    ? { type: 'positive', message: t('audio.gtrackDiagFixed') }
    : { type: 'negative', message: t('audio.gtrackDiagFixFailed') })
}

// GT3.3/GT3.12: the point inspector. Opened by double-clicking a vertex in point mode; edits
// every entry field in one undo unit (time uses crossover semantics — see applyPointEdit).
// GT3.12 (GT-D18) turns it into a non-modal LIVE inspector (owner reqs 26-29, 31-32):
//   - seamless (no backdrop; the tracks stay fully interactive) — plain v-if aside, no q-dialog.
//   - follows the selection: clicking (or dragging) a different vertex re-targets it.
//   - live values while dragging: re-synced from the model on every model change.
//   - "Autosave" (persisted): field edits apply immediately (on blur / slider release) instead of
//     requiring the Apply button.
//   - Delete-node and Add-node-to-the-right buttons.
const pointDialogTarget = ref<{ laneId: number; voiceId: number; pointIndex: number } | null>(null)
const pointForm = reactive({ timeSec: 0, baseFreq: 0, beatFreq: 0, volL: 0, volR: 0 })
const pointDialogVoiceName = computed(() => {
  const tgt = pointDialogTarget.value
  if (tgt === null) return ''
  const v = gtracks.getVoice(tgt.voiceId)
  if (v === undefined) return ''
  return v.description.trim() !== '' ? v.description : `#${v.id}`
})
const pointDialogVoiceMono = computed(() => {
  const tgt = pointDialogTarget.value
  return tgt !== null && (gtracks.getVoice(tgt.voiceId)?.mono ?? false)
})
/** Whether the inspected point has a right neighbour (Add-node-right needs one to interpolate into). */
const pointDialogHasNext = computed(() => {
  const tgt = pointDialogTarget.value
  if (tgt === null) return false
  const voice = gtracks.getVoice(tgt.voiceId)
  return voice !== undefined && tgt.pointIndex < voice.points.length - 1
})
function syncPointFormFromModel(): void {
  const tgt = pointDialogTarget.value
  if (tgt === null) return
  const voice = gtracks.getVoice(tgt.voiceId)
  if (voice === undefined) {
    pointDialogTarget.value = null // the voice is gone — nothing to show
    return
  }
  const point = voice.points[tgt.pointIndex] ?? null
  if (point === null) {
    // GT10.33 (owner 2026-07-12): if the voice was emptied (last point deleted), KEEP the dialog
    // open with the frozen values so the user can Undo. Otherwise the point was deleted elsewhere
    // while others remain — close.
    if (voice.points.length === 0) return
    pointDialogTarget.value = null
    return
  }
  pointForm.timeSec = Number(point.timeSec.toFixed(3))
  pointForm.baseFreq = Number(point.baseFreq.toFixed(3))
  pointForm.beatFreq = Number((point.beatFreqHalf * 2).toFixed(3)) // display = full beat (GT-D6)
  pointForm.volL = Number(point.volL.toFixed(3))
  pointForm.volR = Number(point.volR.toFixed(3))
}
function openPointDialog(laneId: number, p: GTrackPointRef): void {
  // GT3.7: a generated (preparse) voice is locked — offer to fix it instead of opening the editor
  // (its points can't be edited until baked into concrete entries).
  if (gtracks.isVoicePreparse(p.voiceId)) {
    promptFixPreparse(p.voiceId)
    return
  }
  pointDialogTarget.value = { laneId, voiceId: p.voiceId, pointIndex: p.pointIndex }
  // GT10.35 (owner 2026-07-12): move the visual focus (selected vertex / white circle) to the
  // clicked point too, so it doesn't stay on the previously added/selected node.
  gtracks.selectPoint(laneId, { voiceId: p.voiceId, pointIndex: p.pointIndex })
  syncPointFormFromModel()
}
// GT3.7 (owner req. 11 / R6): fixing bakes the generator's expansion into concrete points and
// loses the generator node on Save — irreversible, so confirm first.
function promptFixPreparse(voiceId: number): void {
  $q.dialog({
    title: t('audio.gtrackFixTitle'),
    message: t('audio.gtrackFixWarning'),
    ok: { label: t('audio.gtrackFix'), color: 'primary' },
    cancel: { label: t('audio.cancel'), flat: true }, // GT10.1 (owner req. 60): localized Cancel
    persistent: true,
  }).onOk(() => {
    if (gtracks.fixPreparseVoice(voiceId)) {
      $q.notify({ type: 'positive', message: t('audio.gtrackFixed') })
    }
  })
}
function closePointDialog(): void {
  pointDialogTarget.value = null
}
// GT3.16 (review #4): closing the inspector clears BOTH the multi-selection and the single
// target, so dismissing the table can't "reveal" a stale single inspector left over from before
// the multi-selection began.
function closeInspector(): void {
  gtracks.clearMultiSelection()
  pointDialogTarget.value = null
}

// GT3.21 (owner req. 41): drag the point inspector around by its title bar. Position is stored in
// the coordinates of its positioned ancestor (offsetParent) and clamped to that box; it resets to
// the default corner each time the inspector closes.
const inspectorEl = ref<HTMLElement | null>(null)
const inspectorPos = ref<{ left: number; top: number } | null>(null)
const inspectorStyle = computed(() =>
  inspectorPos.value === null
    ? undefined
    : { left: `${inspectorPos.value.left}px`, top: `${inspectorPos.value.top}px`, right: 'auto' },
)
let inspectorDrag: { px: number; py: number; left: number; top: number } | null = null
function onInspectorDragStart(event: PointerEvent): void {
  const el = inspectorEl.value
  if (event.button !== 0 || el === null) return
  // GT10.30: the inspector is position:fixed now, so drag in viewport coordinates (getBoundingClientRect).
  const r = el.getBoundingClientRect()
  inspectorDrag = { px: event.clientX, py: event.clientY, left: r.left, top: r.top }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function onInspectorDragMove(event: PointerEvent): void {
  if (inspectorDrag === null) return
  const el = inspectorEl.value
  const root = rootEl.value
  if (el === null || root === null) return
  // GT10.30: clamp to the editor's on-screen frame (viewport rect), matching the fixed pinning.
  const frame = root.getBoundingClientRect()
  const left = inspectorDrag.left + (event.clientX - inspectorDrag.px)
  const top = inspectorDrag.top + (event.clientY - inspectorDrag.py)
  inspectorPos.value = {
    left: Math.max(frame.left, Math.min(left, frame.right - el.offsetWidth)),
    top: Math.max(frame.top, Math.min(top, frame.bottom - el.offsetHeight)),
  }
}
function onInspectorDragEnd(event: PointerEvent): void {
  if (inspectorDrag === null) return
  inspectorDrag = null
  try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId) } catch { /* ignore */ }
}
// GT3.12 (owner req. 27+29): while the inspector is open, follow the selection (clicking or
// dragging a different vertex re-targets it) and keep the fields live during a drag. A single
// watch source combining both signals keeps a drag's crossover re-index and a plain click in
// perfect sync (both can happen in the same reactive flush).
watch(
  () => [gtracks.selection.value, gtracks.voices.value] as const,
  ([sel]) => {
    const tgt = pointDialogTarget.value
    if (tgt === null) return
    if (sel !== null && (sel.voiceId !== tgt.voiceId || sel.pointIndex !== tgt.pointIndex)) {
      pointDialogTarget.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: sel.pointIndex }
    }
    syncPointFormFromModel()
  },
)
// Derived controls (GT-D6): Volume scales L/R preserving balance; Balance re-splits the total.
const pointFormVolume = computed(() => (pointForm.volL + pointForm.volR) / 2)
const pointFormBalance = computed(() => {
  const s = pointForm.volL + pointForm.volR
  return s <= 0 ? 0 : (pointForm.volR - pointForm.volL) / s
})
// GT3.11 (owner req. 23): SLIDER edits round volumes to 3 decimals; typing into the L/R inputs
// stays free-form (no rounding there).
function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}
function setPointFormVolume(v: number): void {
  const clamp = (x: number): number => Math.max(0, Math.min(1, x))
  const cur = pointFormVolume.value
  if (pointDialogVoiceMono.value || cur <= 0) {
    pointForm.volL = round3(clamp(v))
    pointForm.volR = round3(clamp(v))
    return
  }
  const f = v / cur
  pointForm.volL = round3(clamp(pointForm.volL * f))
  pointForm.volR = round3(clamp(pointForm.volR * f))
}
function setPointFormBalance(b: number): void {
  const clamp = (x: number): number => Math.max(0, Math.min(1, x))
  const s = pointForm.volL + pointForm.volR
  if (s <= 0) return
  const bb = Math.max(-1, Math.min(1, b))
  pointForm.volL = round3(clamp((s * (1 - bb)) / 2))
  pointForm.volR = round3(clamp((s * (1 + bb)) / 2))
}
// GT3.12: Apply commits the form to the model — one undo unit — WITHOUT closing the inspector
// (req 26: only the user closes it; also required for autosave, which calls this repeatedly).
function applyPointDialog(): void {
  const tgt = pointDialogTarget.value
  if (tgt === null) return
  gtracks.applyPointEdit(
    { voiceId: tgt.voiceId, pointIndex: tgt.pointIndex },
    {
      timeSec: Math.max(0, Number(pointForm.timeSec) || 0),
      baseFreq: Math.max(0, Number(pointForm.baseFreq) || 0),
      beatFreqHalf: Math.max(0, Number(pointForm.beatFreq) || 0) / 2,
      volL: Math.max(0, Math.min(1, Number(pointForm.volL) || 0)),
      volR: Math.max(0, Math.min(1, Number(pointForm.volR) || 0)),
    },
  )
}
// GT3.12 (owner req. 28): field-level autosave trigger — blur/enter for text inputs, release for
// sliders (not every keystroke/drag pixel, to avoid one undo entry per character).
function maybeAutosave(): void {
  if (gtracks.pointAutosave.value) applyPointDialog()
}
// GT10.36 (owner 2026-07-12): after undo/redo, move the focus to the point that CHANGED — a
// restored (previously deleted) node becomes selected, wherever it landed. We diff the inspected
// voice's point times before/after: a time that (re)appears is the restored/added node.
function undoWithFocus(): void { withRestoredFocus(() => gtracks.undoEdit()) }
function redoWithFocus(): void { withRestoredFocus(() => gtracks.redoEdit()) }
function withRestoredFocus(op: () => void): void {
  const tgt = pointDialogTarget.value
  if (tgt === null) { op(); return }
  const { laneId, voiceId } = tgt
  const before = gtracks.getVoice(voiceId)?.points.map((p) => p.timeSec) ?? []
  op()
  const voice = gtracks.getVoice(voiceId)
  if (voice === undefined) return
  // Multiset of prior times; the first current point whose time isn't accounted for is the one
  // that (re)appeared (a restored/added node).
  const remaining = new Map<number, number>()
  for (const t of before) remaining.set(t, (remaining.get(t) ?? 0) + 1)
  let idx = -1
  for (let i = 0; i < voice.points.length; i += 1) {
    const t = voice.points[i]!.timeSec
    const n = remaining.get(t) ?? 0
    if (n > 0) { remaining.set(t, n - 1); continue }
    idx = i
    break
  }
  if (idx < 0) idx = Math.min(tgt.pointIndex, voice.points.length - 1) // no new node — keep/clamp
  if (idx < 0) return
  pointDialogTarget.value = { laneId, voiceId, pointIndex: idx }
  gtracks.selectPoint(laneId, { voiceId, pointIndex: idx })
}
// GT10.31 (owner req. 80): adding a point (Ctrl-click on a curve) opens its dialog immediately.
// insertPointAt selects the new point on success, so the dialog targets it from the selection.
function onAddPoint(laneId: number, e: GTrackAddPoint): void {
  if (!gtracks.insertPointAt(laneId, e.voiceId, e.timeSec)) return
  const sel = gtracks.selection.value
  if (sel !== null) openPointDialog(laneId, { voiceId: sel.voiceId, pointIndex: sel.pointIndex })
}
// GT3.12 (owner req. 31) / GT10.33 (owner req. 82, revised 2026-07-12): delete the inspected point
// and MOVE FOCUS — to the right neighbour (same index after the shift), else the previous point.
// Deleting the LAST point empties the voice but keeps the dialog OPEN (frozen values) so the user
// can Undo. No min-2 floor / no block.
function deleteCurrentPointFromDialog(): void {
  const tgt = pointDialogTarget.value
  if (tgt === null) return
  const voice = gtracks.getVoice(tgt.voiceId)
  if (voice === undefined) return
  const countBefore = voice.points.length
  const idx = tgt.pointIndex
  if (!gtracks.deletePointAt(tgt.laneId, { voiceId: tgt.voiceId, pointIndex: idx })) return
  const remaining = countBefore - 1
  if (remaining <= 0) return // voice emptied — leave the dialog open (frozen) for Undo
  // Right neighbour has shifted into `idx`; if we deleted the last point, fall back to the previous.
  const nextIndex = Math.min(idx, remaining - 1)
  const laneId = tgt.laneId
  const voiceId = tgt.voiceId
  pointDialogTarget.value = { laneId, voiceId, pointIndex: nextIndex }
  gtracks.selectPoint(laneId, { voiceId, pointIndex: nextIndex })
  syncPointFormFromModel()
}
// GT3.12 (owner req. 32): insert an interpolated point to the right, at the midpoint of the
// segment leading to the next point (disabled when this is the voice's last point).
function addPointToRight(): void {
  const tgt = pointDialogTarget.value
  if (tgt === null) return
  const voice = gtracks.getVoice(tgt.voiceId)
  const cur = voice?.points[tgt.pointIndex]
  const next = voice?.points[tgt.pointIndex + 1]
  if (voice === undefined || cur === undefined || next === undefined) return
  gtracks.insertPointAt(tgt.laneId, tgt.voiceId, (cur.timeSec + next.timeSec) / 2)
}

// GT3.15 (owner req. 30, GT-D18): the inspector shows the single-point form, or — once 2+ vertices
// are Ctrl/Shift-selected — a table (view/edit VALUE fields across all of them + bulk delete).
// Table mode takes priority whenever it applies.
const inspectorMode = computed<'single' | 'table' | 'none'>(() => {
  if (gtracks.multiSelection.value.size >= 2) return 'table'
  if (pointDialogTarget.value !== null) return 'single'
  return 'none'
})
// GT3.21: reset the dragged inspector to its default corner whenever it closes, so a stored
// position can't strand it off-screen after a layout change. (Declared here — after inspectorMode.)
watch(inspectorMode, (mode) => { if (mode === 'none') inspectorPos.value = null })
interface MultiFormRow {
  voiceId: number
  pointIndex: number
  /** GT10.40 (owner 2026-07-12): the point time, shown read-only (editing time needs crossover
   *  reindexing, which would desync the multi-selection keys — use the single-point dialog for that). */
  timeSec: number
  baseFreq: number
  beatFreq: number
  volL: number
  volR: number
  /** GT10.9 (owner req. 54): row selection for 'delete selected' (all checked by default). */
  checked: boolean
}
const multiForm = ref<MultiFormRow[]>([])
function modelRow(voiceId: number, pointIndex: number, point: { timeSec: number; baseFreq: number; beatFreqHalf: number; volL: number; volR: number }): MultiFormRow {
  return {
    voiceId,
    pointIndex,
    timeSec: Number(point.timeSec.toFixed(3)),
    baseFreq: Number(point.baseFreq.toFixed(3)),
    beatFreq: Number((point.beatFreqHalf * 2).toFixed(3)),
    volL: Number(point.volL.toFixed(3)),
    volR: Number(point.volR.toFixed(3)),
    checked: true, // GT10.9 (owner req. 54): rows are selected by default
  }
}
// GT10.41 (owner 2026-07-12): the table groups its rows by voice under a collapsible header (the
// separate voice-name column is gone). Group order follows first appearance in the selection.
interface MultiFormGroup { voiceId: number; name: string; rows: MultiFormRow[] }
const collapsedGroups = ref<Set<number>>(new Set())
function toggleGroup(voiceId: number): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(voiceId)) next.delete(voiceId)
  else next.add(voiceId)
  collapsedGroups.value = next
}
const groupedMultiForm = computed<MultiFormGroup[]>(() => {
  const groups = new Map<number, MultiFormGroup>()
  for (const row of multiForm.value) {
    let g = groups.get(row.voiceId)
    if (g === undefined) {
      g = { voiceId: row.voiceId, name: multiRowVoiceName(row.voiceId), rows: [] }
      groups.set(row.voiceId, g)
    }
    g.rows.push(row)
  }
  return [...groups.values()]
})
// GT3.16 (review #5): RECONCILE rather than rebuild — a row whose "voiceId:pointIndex" key is
// still selected KEEPS its current (possibly mid-edit) values, so accumulating another point
// (or an external model change) no longer discards uncommitted typing. Newly-selected keys are
// seeded from the model; deselected keys drop out. A drag can't happen in table mode (starting a
// drag clears the multi-selection), so nothing here needs to be "live" during a drag.
function reconcileMultiForm(): void {
  const existing = new Map(multiForm.value.map((r) => [`${r.voiceId}:${r.pointIndex}`, r]))
  multiForm.value = gtracks.multiSelectionPoints.value.map(({ voiceId, pointIndex, point }) =>
    existing.get(`${voiceId}:${pointIndex}`) ?? modelRow(voiceId, pointIndex, point),
  )
}
watch(() => [gtracks.multiSelection.value, gtracks.voices.value] as const, () => {
  reconcileMultiForm()
})
function multiRowVoiceName(voiceId: number): string {
  const v = gtracks.getVoice(voiceId)
  if (v === undefined) return `#${voiceId}`
  return v.description.trim() !== '' ? v.description : `#${v.id}`
}
function rowPatch(row: MultiFormRow): { baseFreq: number; beatFreqHalf: number; volL: number; volR: number } {
  return {
    baseFreq: Math.max(0, Number(row.baseFreq) || 0),
    beatFreqHalf: Math.max(0, Number(row.beatFreq) || 0) / 2,
    volL: Math.max(0, Math.min(1, Number(row.volL) || 0)),
    volR: Math.max(0, Math.min(1, Number(row.volR) || 0)),
  }
}
function maybeAutosaveMultiRow(row: MultiFormRow): void {
  // A single row blur is naturally its own undo unit.
  if (gtracks.pointAutosave.value) {
    gtracks.setPointValues({ voiceId: row.voiceId, pointIndex: row.pointIndex }, rowPatch(row))
  }
}
// GT10.6/GT10.22 (owner req. 50/71): Ctrl OR Alt + Arrow steps a numeric field by 1.0 (plain arrows
// keep the input's own fine step). Handled in the WINDOW keydown (handleTracksKeyDown) — that is the
// only listener proven to reliably carry the modifier while an inspector field is focused (same path
// as Ctrl+S / Ctrl+Z). The field is located from the focused element's data-step-field ancestor
// (data-step-row for the table row); the value is clamped per field via ctrlStepValue.
// GT10.22 (owner 2026-07-12): while Alt is held, a numeric field's native `step` becomes 1, so an
// Alt+click on the browser spinner arrows (and Alt+ArrowKey) steps by ±1 instead of the fine step.
// Kept in sync from the window key handlers + a blur reset (so a missed keyup can't strand it).
const altBigStep = ref(false)
function fieldStep(fine: string): string {
  return altBigStep.value ? '1' : fine
}
function applyFieldBigStep(el: HTMLElement, dir: 1 | -1): void {
  const field = el.getAttribute('data-step-field')
  if (field === null) return
  const rowKey = el.getAttribute('data-step-row')
  if (rowKey !== null) {
    const row = multiForm.value.find((r) => `${r.voiceId}:${r.pointIndex}` === rowKey)
    if (row === undefined) return
    const r = row as unknown as Record<string, number>
    r[field] = ctrlStepValue(Number(r[field]), field, dir)
    maybeAutosaveMultiRow(row)
    return
  }
  const form = pointForm as unknown as Record<string, number>
  form[field] = ctrlStepValue(Number(form[field]), field, dir)
  maybeAutosave()
}

// GT10.9 (owner req. 54): delete only the CHECKED table rows (one undo unit).
function removeCheckedRows(): void {
  gtracks.removePointsBulk(
    multiForm.value.filter((r) => r.checked).map((r) => ({ voiceId: r.voiceId, pointIndex: r.pointIndex })),
  )
}

// GT3.16 (review #1): "Apply all" is ONE undo unit — was one per row, so undoing needed N presses.
function applyAllMultiRows(): void {
  gtracks.setMultiplePointValues(
    multiForm.value.map((row) => ({ ref: { voiceId: row.voiceId, pointIndex: row.pointIndex }, patch: rowPatch(row) })),
  )
}

// Same fallback palette as GTrackView so the panel dots match the lane curves.
const VOICE_FALLBACK_COLORS = ['#67e8f9', '#fbbf24', '#a3be8c', '#f472b6', '#c084fc', '#f87171']
const VOICE_HEX = /^#[0-9a-fA-F]{6}$/
function voiceDotColor(v: GTrackVoice, index: number): string {
  return v.color !== null && VOICE_HEX.test(v.color)
    ? v.color
    : VOICE_FALLBACK_COLORS[index % VOICE_FALLBACK_COLORS.length]!
}
// GT2.6 fix: gtracks come from the schedule, not the rendered WAV — show them even when the
// spectrogram buffer is missing (e.g. AndromedaHell renders a 868 MB WAV from 4900 loops that the
// GT7.2/GT7.4 (thin client): spectrogram metadata (channel count, duration, ready gate) comes from
// the BACKEND analysis — the client WAV decode is gone (GT7.3 moved the wave overlay to getPeaks).
const metaSpec = useSpectrogram({ refetchDebounceMs: 400 })
const backendAnalysis = computed(() => metaSpec.analysis.value)
// GT7.4-R2 (owner 2026-07-13): bumped after a Save to force the spectrogram/waveform tracks to
// re-open (fresh render) so they reflect the just-saved edit.
const spectrogramReloadKey = ref(0)
async function openMetaAnalysis(path: string | null): Promise<void> {
  await metaSpec.close()
  if (path === null || path === '') return
  try {
    await metaSpec.open({ filePath: path, ...spectrogramStore.analysisParams, channel: 0 })
  } catch {
    // WS/analysis error -> no spectrogram (backend is the only source now)
  }
}
// GT7.4-R2 + owner 2026-07-13: a Save or a voice mute edits the CURRENT .gnaural in place — the
// schedule reloads but the path is unchanged, so the backend wave/spectrum (render cache is
// mtime-keyed) would stay stale. Bump the reload key + re-open the meta analysis on same-path
// schedule changes to force a fresh render (muted voices drop out of the mix). A file switch changes
// the path and is handled by the displayFilePath watch + each view's own filePath watch, so guard on
// the path to avoid a redundant double render on open.
let lastSchedulePath: string | null = audio.displayFilePath
watch(() => audio.gnauralSchedule, () => {
  const path = audio.displayFilePath
  if (path !== null && path === lastSchedulePath) {
    spectrogramReloadKey.value += 1
    void openMetaAnalysis(path)
  }
  lastSchedulePath = path
})
// Backend analysis is available -> render the stack.
const hasSpectrogramData = computed(() => backendAnalysis.value !== null)
// SF9.2: independent per-track heights; length is kept in sync with the track count
// (1 mono / 2 stereo) by a watch below. Resized by the divider + bottom handle.
const spectrogramTrackHeights = ref<number[]>(loadStoredSpectrogramTrackHeights())
// SF8.1: stacked spectrogram tracks (stereo L/R) share one time window + area
// selection so they zoom/pan/select together; reset per file so a new file starts full.
// GT-D10: this is the Tracks tab's OWN shared state (provided to ITS subtree only).
const spectrogramShared = {
  view: ref<TimeWindow | null>(null),
  selection: ref<SpectrogramSelection | null>(null),
  commitSeq: ref(0),
  // SF15.1: shared frequency window (bin-axis fractions) so stacked tracks freq-zoom together.
  freqView: ref<{ lo: number; hi: number } | null>(null),
}
provide('spectrogramShared', spectrogramShared)

watch(spectrogramTrackHeights, (value) => {
  persistSpectrogramTrackHeights(value)
}, { deep: true })

// GT2.6: the Треки tab auto-renders a gnaural for its spectrum (no playback), so it never shows
// the "press play to render" hint — a tracks-neutral message is used for every kind.
const noSpectrogramLabel = computed(() => t('audio.tracksNoData'))

// GT10.16 (owner req. 65): the stages of opening a file, shown as an event list while any is
// active. Wording is thin-client-correct: the browser doesn't "download the file" — the server
// renders/analyzes and the client only fetches views.
const openStages = computed<{ key: string; label: string; active: boolean }[]>(() => {
  const stages: { key: string; label: string; active: boolean }[] = []
  if (audio.displayFilePath === null) return stages
  if (audio.displayMode === 'gnaural') {
    stages.push({ key: 'schedule', label: t('audio.stageSchedule'), active: audio.gnauralScheduleLoading })
    stages.push({ key: 'render', label: t('audio.stageRender'), active: audio.spectrogramLoading })
  }
  stages.push({ key: 'analysis', label: t('audio.stageAnalysis'), active: metaSpec.preparing.value || metaSpec.loading.value })
  return stages.some((st) => st.active) ? stages : []
})

// GT7.2/GT7.4: channelCount from the backend analysis (client buffer decode removed).
const isSpectrogramStereo = computed(
  () => (backendAnalysis.value?.channelCount ?? 1) >= 2,
)

// SF22 + SF23: audio view prefs — Audacity-style view mode + waveform scale/colour/opacity.
type AudioViewMode = 'waveform' | 'spectrogram' | 'both' | 'overlay'
const AUDIO_VIEW_MODES: readonly AudioViewMode[] = ['both', 'overlay', 'spectrogram', 'waveform']
const STORAGE_TRACKS_WAVEFORM = 'mindwave-tracks-waveform'
function loadWaveformPrefs(): {
  mode?: string
  scale?: string // legacy scalar (pre-SF27) — migrated to scales[0]
  color?: string // legacy
  opacity?: number // legacy
  scales?: unknown
  colors?: unknown
  opacities?: unknown
  minimap?: string
} {
  try {
    const raw = localStorage.getItem(STORAGE_TRACKS_WAVEFORM)
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, never>) : {}
  } catch {
    return {}
  }
}
// SF26: minimap thumbnail content.
type MinimapMode = 'spectrogram' | 'waveform' | 'overlay'
const MINIMAP_MODES: readonly MinimapMode[] = ['spectrogram', 'waveform', 'overlay']
const wfPrefs = loadWaveformPrefs()
const viewMode = ref<AudioViewMode>(
  AUDIO_VIEW_MODES.includes(wfPrefs.mode as AudioViewMode) ? (wfPrefs.mode as AudioViewMode) : 'both',
)
// SF27: waveform colour / scale / overlay-opacity are now PER TRACK (per channel), so L and R
// can differ. Arrays are indexed by channel; legacy scalar prefs seed channel 0 on migration.
type WaveformScale = 'linear' | 'db'
const WAVEFORM_DEFAULT_COLORS = ['#67e8f9', '#fbbf24'] // L cyan, R amber
function seedArray<T>(saved: unknown, legacy: T, fallback: (ch: number) => T): T[] {
  if (Array.isArray(saved) && saved.length > 0) return saved.slice(0, 2) as T[]
  return [legacy ?? fallback(0), fallback(1)]
}
const waveformScales = ref<WaveformScale[]>(
  seedArray<WaveformScale>(wfPrefs.scales, wfPrefs.scale === 'db' ? 'db' : 'linear', () => 'linear'),
)
const waveformColors = ref<string[]>(
  seedArray<string>(
    wfPrefs.colors,
    typeof wfPrefs.color === 'string' ? wfPrefs.color : WAVEFORM_DEFAULT_COLORS[0],
    (ch) => WAVEFORM_DEFAULT_COLORS[ch] ?? WAVEFORM_DEFAULT_COLORS[0],
  ),
)
const waveformOpacities = ref<number[]>(
  seedArray<number>(wfPrefs.opacities, typeof wfPrefs.opacity === 'number' ? wfPrefs.opacity : 0.55, () => 0.55),
)
function wfScale(ch: number): WaveformScale {
  return waveformScales.value[ch] ?? waveformScales.value[0] ?? 'linear'
}
function wfColor(ch: number): string {
  return waveformColors.value[ch] ?? WAVEFORM_DEFAULT_COLORS[ch] ?? WAVEFORM_DEFAULT_COLORS[0]
}
function wfOpacity(ch: number): number {
  return waveformOpacities.value[ch] ?? waveformOpacities.value[0] ?? 0.55
}
// Per-track settings dialog: which channel's settings are open (null = closed).
const waveformSettingsChannel = ref<number | null>(null)
const waveformSettingsOpen = computed<boolean>({
  get: () => waveformSettingsChannel.value !== null,
  set: (v) => {
    if (!v) waveformSettingsChannel.value = null
  },
})
function openWaveformSettings(ch: number): void {
  waveformSettingsChannel.value = ch
}
const wfDlgChannel = computed(() => waveformSettingsChannel.value ?? 0)
const wfDlgLabel = computed(() =>
  isSpectrogramStereo.value ? (wfDlgChannel.value === 0 ? 'L' : 'R') : '',
)
const wfDlgScale = computed<WaveformScale>({
  get: () => wfScale(wfDlgChannel.value),
  set: (v) => {
    const a = waveformScales.value.slice()
    a[wfDlgChannel.value] = v
    waveformScales.value = a
  },
})
const wfDlgColor = computed<string>({
  get: () => wfColor(wfDlgChannel.value),
  set: (v) => {
    const a = waveformColors.value.slice()
    a[wfDlgChannel.value] = v
    waveformColors.value = a
  },
})
const wfDlgOpacity = computed<number>({
  get: () => wfOpacity(wfDlgChannel.value),
  set: (v) => {
    const a = waveformOpacities.value.slice()
    a[wfDlgChannel.value] = v
    waveformOpacities.value = a
  },
})
const minimapMode = ref<MinimapMode>(
  MINIMAP_MODES.includes(wfPrefs.minimap as MinimapMode) ? (wfPrefs.minimap as MinimapMode) : 'spectrogram',
)
const minimapSettingsOpen = ref(false)

// SF28 (SF-D66): per-kind track ORDER + independent HIDE set, so L/R can be reordered and hidden
// independently for the waveform and the spectrogram. `viewMode` stays a coarse visibility preset
// (which KINDS show); this layer decides order + which channels are hidden within a shown kind.
type TrackKind = 'waveform' | 'spectrogram'
const STORAGE_TRACKS_TRACK_LAYOUT = 'mindwave-tracks-track-layout'
function loadTrackLayout(): { order?: Record<string, unknown>; hidden?: unknown } {
  try {
    const raw = localStorage.getItem(STORAGE_TRACKS_TRACK_LAYOUT)
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
    return typeof parsed === 'object' && parsed !== null ? (parsed as { order?: Record<string, unknown>; hidden?: unknown }) : {}
  } catch {
    return {}
  }
}
function numArr(v: unknown, fallback: number[]): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : fallback
}
const savedLayout = loadTrackLayout()
const trackOrder = ref<Record<TrackKind, number[]>>({
  waveform: numArr(savedLayout.order?.waveform, [0, 1]),
  spectrogram: numArr(savedLayout.order?.spectrogram, [0, 1]),
})
const hiddenTracks = ref<Set<string>>(
  new Set(Array.isArray(savedLayout.hidden) ? savedLayout.hidden.filter((x): x is string => typeof x === 'string') : []),
)
function trackKey(kind: TrackKind, ch: number): string {
  return `${kind}:${ch}`
}
function isTrackHidden(kind: TrackKind, ch: number): boolean {
  return hiddenTracks.value.has(trackKey(kind, ch))
}
// Ordered, non-hidden channel list for a kind, given the available channel count. Unknown/new
// channels are appended so a mono→stereo file transition still surfaces the new channel.
function orderedChannels(kind: TrackKind, count: number): number[] {
  const ord = trackOrder.value[kind].filter((c) => c >= 0 && c < count)
  for (let c = 0; c < count; c++) if (!ord.includes(c)) ord.push(c)
  return ord.filter((c) => !isTrackHidden(kind, c))
}
watch([trackOrder, hiddenTracks], () => {
  try {
    localStorage.setItem(
      STORAGE_TRACKS_TRACK_LAYOUT,
      JSON.stringify({ order: trackOrder.value, hidden: Array.from(hiddenTracks.value) }),
    )
  } catch {
    // ignore
  }
}, { deep: true })
// SF28.2: hide/show a single track (independent per kind + channel). Reassign the Set so the
// persistence watch + computeds react.
function hideTrack(kind: TrackKind, ch: number): void {
  const s = new Set(hiddenTracks.value)
  s.add(trackKey(kind, ch))
  hiddenTracks.value = s
}
function showTrack(kind: TrackKind, ch: number): void {
  const s = new Set(hiddenTracks.value)
  s.delete(trackKey(kind, ch))
  hiddenTracks.value = s
}

// SF28.3: drag-and-drop reorder within a kind (swap L↔R). The grip in a track emits a pointerdown;
// we hit-test the track under the pointer (same kind) and swap their positions in trackOrder.
const trackDrag = ref<{ kind: TrackKind; channel: number } | null>(null)
function swapTrackOrder(kind: TrackKind, a: number, b: number): void {
  const ord = trackOrder.value[kind].slice()
  for (const c of [a, b]) if (!ord.includes(c)) ord.push(c)
  const ia = ord.indexOf(a)
  const ib = ord.indexOf(b)
  if (ia < 0 || ib < 0 || ia === ib) return
  ;[ord[ia], ord[ib]] = [ord[ib], ord[ia]]
  trackOrder.value = { ...trackOrder.value, [kind]: ord }
}
function onTrackGripMove(ev: PointerEvent): void {
  const d = trackDrag.value
  if (d === null) return
  const el = document.elementFromPoint(ev.clientX, ev.clientY)
  const trackEl = el === null ? null : (el.closest('[data-track-kind]') as HTMLElement | null)
  if (trackEl === null || trackEl.dataset.trackKind !== d.kind) return
  const targetCh = Number(trackEl.dataset.trackChannel)
  if (!Number.isInteger(targetCh) || targetCh === d.channel) return
  swapTrackOrder(d.kind, d.channel, targetCh)
}
function onTrackGripUp(): void {
  trackDrag.value = null
  window.removeEventListener('pointermove', onTrackGripMove)
  window.removeEventListener('pointerup', onTrackGripUp)
  window.removeEventListener('pointercancel', onTrackGripUp)
}
function onTrackGripDown(kind: TrackKind, channel: number, ev: PointerEvent): void {
  ev.preventDefault()
  trackDrag.value = { kind, channel }
  window.addEventListener('pointermove', onTrackGripMove)
  window.addEventListener('pointerup', onTrackGripUp)
  window.addEventListener('pointercancel', onTrackGripUp)
}

// --- GT2.2: gtrack lane chrome (label, settings dialog, drag reorder) ---
function gtrackModeLabel(mode: GTrackMode): string {
  return t(`audio.gtrackMode_${mode}`)
}
function gtrackLaneLabel(lane: { mode: GTrackMode; voices: readonly { id: number; description: string }[] }): string {
  const names = lane.voices.map((v) => (v.description.trim() !== '' ? v.description : `#${v.id}`))
  const voicePart = names.length === 0 ? t('audio.gtrackNoVoices') : names.join(', ')
  return `${gtrackModeLabel(lane.mode)} · ${voicePart}`
}
// GT3.18 (GT-D20): a single-voice lane takes its voice's accent colour (left stripe + tinted title)
// so all of a voice's lanes read as a group. Multi-voice lanes have no accent (colour is ambiguous).
// The colour matches the voices-panel dot (voice identity), so grouping is consistent across the UI.
function laneAccentColor(lane: { voices: readonly { id: number }[] }): string | null {
  if (lane.voices.length !== 1) return null
  const id = lane.voices[0]!.id
  const vi = gtracks.voices.value.findIndex((x) => x.id === id)
  const v = gtracks.voices.value[vi]
  return v === undefined ? null : voiceDotColor(v, vi)
}

// GT11.5 (owner 2026-07-14): colour of the per-track header stripe. Single-voice lanes reuse the
// accent (voice) colour; a combined (multi-voice) lane gets a neutral stripe (colour is ambiguous).
function laneHeaderColor(lane: { voices: readonly { id: number }[] }): string {
  return laneAccentColor(lane) ?? '#64748b'
}
// GT11.5: tint the header title with the voice colour for single-voice lanes only (combined = default).
function laneTitleStyle(lane: { voices: readonly { id: number }[] }): { color: string } | undefined {
  const c = laneAccentColor(lane)
  return c === null ? undefined : { color: c }
}
// GT11.5: the top time-axis rides the first UNFOLDED lane (folding the first lane hides its curve).
const firstUnfoldedGIndex = computed(() => gtracks.visibleLanes.value.findIndex((l) => !l.folded))

// GT10.2 (owner req. 44): the solo sub-lanes carry the lane's voice accent stripe too.
function sublaneAccentStyle(lane: { voices: readonly { id: number }[] }): Record<string, string> {
  const c = laneAccentColor(lane)
  return c === null ? {} : { borderLeft: `3px solid ${c}` }
}

// GT4.2 (GT-D17): solo-audio placement per lane. soloMode = what (wave/spectrum/both); soloInline =
// where (under the curves vs a sub-lane below). Inline shows ONE underlay (spectrum wins for 'both');
// for 'both' inline, the wave still appears as a sub-lane so nothing is lost.
interface LaneSoloShape { soloMode: GTrackSoloMode; soloInline: boolean; voiceIds: readonly number[] }
function laneSoloActive(lane: LaneSoloShape): boolean {
  return lane.soloMode !== 'off' && audio.displayMode === 'gnaural' && lane.voiceIds.length > 0
}
function laneInlineKind(lane: LaneSoloShape): 'wave' | 'spectrum' | null {
  if (!laneSoloActive(lane) || !lane.soloInline) return null
  return lane.soloMode === 'spectrum' || lane.soloMode === 'both' ? 'spectrum' : 'wave'
}
function laneWaveSublane(lane: LaneSoloShape): boolean {
  if (!laneSoloActive(lane)) return false
  if (lane.soloMode === 'both') return true // spectrum takes the inline/own slot; wave is always a sub-lane
  return lane.soloMode === 'wave' && !lane.soloInline
}
function laneSpectrumSublane(lane: LaneSoloShape): boolean {
  if (!laneSoloActive(lane)) return false
  return (lane.soloMode === 'spectrum' || lane.soloMode === 'both') && !lane.soloInline
}

// GT8.1 (GT-D19): a lane's solo spectrum/waveform uses its per-lane settings OVERRIDE if present,
// otherwise the global settings — so each spectrogram can be configured independently.
function laneSpectrogramAnalysis(laneId: number): SpectrogramAnalysisParams {
  const o = gtracks.getLaneSpectrum(laneId)
  return o !== null ? { ...toAnalysisParams(o), channel: 0 } : spectrogramLeftAnalysis.value
}
function laneSpectrogramRender(laneId: number): ReturnType<typeof toRenderOptions> {
  const o = gtracks.getLaneSpectrum(laneId)
  return o !== null ? toRenderOptions(o) : spectrogramStore.renderOptions
}
function toggleLaneSpectrumCustom(laneId: number, on: boolean): void {
  if (on) gtracks.ensureLaneSpectrum(laneId, { ...spectrogramStore.settings })
  else gtracks.clearLaneSpectrum(laneId)
}

const gtrackSettingsId = ref<number | null>(null)
const gtrackSettingsOpen = computed<boolean>({
  get: () => gtrackSettingsId.value !== null,
  set: (v) => { if (!v) gtrackSettingsId.value = null },
})
const gtrackSettingsLane = computed(() => gtracks.lanes.value.find((l) => l.id === gtrackSettingsId.value) ?? null)

// gtrack reorder: mirror the SF-D66 grip drag, but swap lanes in the composable via a hit-test.
const gtrackDrag = ref<number | null>(null)
function onGtrackGripMove(ev: PointerEvent): void {
  const dragId = gtrackDrag.value
  if (dragId === null) return
  const el = document.elementFromPoint(ev.clientX, ev.clientY)
  const laneEl = el === null ? null : (el.closest('[data-gtrack-lane]') as HTMLElement | null)
  if (laneEl === null) return
  const targetId = Number(laneEl.dataset.gtrackLane)
  if (!Number.isInteger(targetId) || targetId === dragId) return
  gtracks.swapLanes(dragId, targetId)
}
function onGtrackGripUp(): void {
  gtrackDrag.value = null
  window.removeEventListener('pointermove', onGtrackGripMove)
  window.removeEventListener('pointerup', onGtrackGripUp)
  window.removeEventListener('pointercancel', onGtrackGripUp)
}
function onGtrackGripDown(laneId: number, ev: PointerEvent): void {
  ev.preventDefault()
  gtrackDrag.value = laneId
  window.addEventListener('pointermove', onGtrackGripMove)
  window.addEventListener('pointerup', onGtrackGripUp)
  window.addEventListener('pointercancel', onGtrackGripUp)
}

// GT11.7 (owner 2026-07-14): per-graph resize — each gtrack graph (curve / solo wave / solo
// spectrum) has its OWN handle that resizes just that graph's height (clamped + persisted per file).
let graphResizeStartY = 0
let graphResizeStartH = 0
let graphResizeTarget: { laneId: number; which: 'curve' | 'wave' | 'spectrum' } | null = null
// GT11.7 (owner 2026-07-14): the modifier captured at drag start decides the SCOPE — plain = just
// this graph; Ctrl/⌘ = the voice's graphs (its group); Shift = ALL graphs everywhere. resizeModeOf +
// setAllGraphsHeight are shared with the overall wave/spectrum handles for uniform behaviour.
let graphResizeMode: ResizeMode = 'one'
function onGraphResizeDown(laneId: number, which: 'curve' | 'wave' | 'spectrum', startH: number, ev: PointerEvent): void {
  graphResizeStartY = ev.clientY
  graphResizeStartH = startH
  graphResizeTarget = { laneId, which }
  graphResizeMode = resizeModeOf(ev)
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  ev.preventDefault()
}
function onGraphResizeMove(ev: PointerEvent): void {
  if (graphResizeTarget === null) return
  const h = graphResizeStartH + (ev.clientY - graphResizeStartY)
  if (graphResizeMode === 'all') setAllGraphsHeight(h)
  else if (graphResizeMode === 'group') gtracks.setVoiceGraphsHeight(graphResizeTarget.laneId, h)
  else gtracks.setLaneGraphHeight(graphResizeTarget.laneId, graphResizeTarget.which, h)
}
function onGraphResizeUp(): void {
  graphResizeTarget = null
}
// The restore list carries a restore callback so waveform/spectrogram channels (SF-D66) and gtrack
// lanes (GT2.2) share one "hidden tracks" dropdown. Channels are listed only when their KIND is
// shown by the view-mode preset (restoring under a preset-hidden kind wouldn't surface it).
interface HiddenTrackEntry { readonly key: string; readonly label: string; readonly restore: () => void }
// SF-D66: the hidden CHANNELS of one kind (waveform/spectrogram), each with a restore callback.
// Shared by the global hidden-tracks dropdown and the per-group header eyes (GT11.11).
function hiddenChannelEntries(kind: TrackKind): HiddenTrackEntry[] {
  const count = isSpectrogramStereo.value ? 2 : 1
  const name = kind === 'waveform' ? t('audio.trackKindWaveform') : t('audio.trackKindSpectrogram')
  const out: HiddenTrackEntry[] = []
  for (let ch = 0; ch < count; ch++) {
    if (!isTrackHidden(kind, ch)) continue
    const chLabel = count > 1 ? (ch === 0 ? 'L' : 'R') : ''
    out.push({ key: trackKey(kind, ch), label: chLabel ? `${name} ${chLabel}` : name, restore: () => showTrack(kind, ch) })
  }
  return out
}
const hiddenTrackList = computed<HiddenTrackEntry[]>(() => {
  const out: HiddenTrackEntry[] = []
  // Channels are listed only when their KIND is shown by the view-mode preset (restoring under a
  // preset-hidden kind wouldn't surface it).
  if (showWaveform.value) out.push(...hiddenChannelEntries('waveform'))
  if (showSpectrogram.value) out.push(...hiddenChannelEntries('spectrogram'))
  // GT2.2: hidden gtrack lanes (only relevant while a gnaural is open).
  if (audio.displayMode === 'gnaural') {
    for (const lane of gtracks.hiddenLanes.value) {
      out.push({ key: `gtrack:${lane.id}`, label: gtrackLaneLabel(lane), restore: () => gtracks.setLaneHidden(lane.id, false) })
    }
  }
  return out
})
// GT11.11 (owner 2026-07-14): hidden-graph lists per OVERALL group, for the header-bar eye toggles.
const hiddenWaveList = computed<HiddenTrackEntry[]>(() => hiddenChannelEntries('waveform'))
const hiddenSpectrumList = computed<HiddenTrackEntry[]>(() => hiddenChannelEntries('spectrogram'))
// GT11.8: a gtrack lane's currently-hidden solo sub-graphs (wave/spectrum), for its header eye.
// "Hidden" = the sub-graph is configured to show (soloMode) but its per-lane hidden flag is set.
function laneHiddenGraphs(lane: LaneSoloShape & { id: number; soloWaveHidden: boolean; soloSpectrumHidden: boolean }): HiddenTrackEntry[] {
  const out: HiddenTrackEntry[] = []
  if (lane.soloWaveHidden && laneWaveSublane(lane)) {
    out.push({ key: `lane:${lane.id}:wave`, label: t('audio.gtrackSoloWave'), restore: () => gtracks.setLaneSoloGraphHidden(lane.id, 'wave', false) })
  }
  if (lane.soloSpectrumHidden && laneSpectrumSublane(lane)) {
    out.push({ key: `lane:${lane.id}:spectrum`, label: t('audio.gtrackSoloSpectrum'), restore: () => gtracks.setLaneSoloGraphHidden(lane.id, 'spectrum', false) })
  }
  return out
}

// SF23.3: the view mode drives which layers are shown.
const showWaveform = computed(() => viewMode.value === 'waveform' || viewMode.value === 'both')
const showSpectrogram = computed(() => viewMode.value !== 'waveform')
// GT11.2 fix (owner 2026-07-14): the mix-exclusion gate ("all voices excluded from the overall
// wave/spectrum") only applies to GNAURAL schedules, which have voices. A plain audio file
// (flac/wav/mp3/…) has NO voices, so hasMixVoices would be false and wrongly hide its wave+spectrum
// (leaving only the minimap + the "all excluded" message). Non-gnaural files always render.
const overallMixActive = computed(() => audio.displayMode !== 'gnaural' || gtracks.hasMixVoices.value)
const waveformOverlay = computed(() => viewMode.value === 'overlay')
const viewModeLabel = computed(() => t(`audio.viewMode_${viewMode.value}`))

// GT11.10 (owner 2026-07-14): fold the OVERALL waveform / spectrogram stacks from a header bar, like
// the per-track fold (GT11.5). Persisted globally, matching the other tracks-panel UI state (heights,
// view mode) which are also per-tab, not per-file.
const STORAGE_TRACKS_OVERALL_FOLDED = 'mindwave-tracks-overall-folded'
const overallWaveFolded = ref(false)
const overallSpectrumFolded = ref(false)
try {
  const raw = localStorage.getItem(STORAGE_TRACKS_OVERALL_FOLDED)
  if (raw !== null) {
    const parsed = JSON.parse(raw) as { wave?: boolean; spectrum?: boolean }
    overallWaveFolded.value = parsed.wave === true
    overallSpectrumFolded.value = parsed.spectrum === true
  }
} catch { /* ignore */ }
function persistOverallFolded(): void {
  try {
    localStorage.setItem(
      STORAGE_TRACKS_OVERALL_FOLDED,
      JSON.stringify({ wave: overallWaveFolded.value, spectrum: overallSpectrumFolded.value }),
    )
  } catch { /* ignore */ }
}
function toggleOverallWaveFolded(): void {
  overallWaveFolded.value = !overallWaveFolded.value
  persistOverallFolded()
}
function toggleOverallSpectrumFolded(): void {
  overallSpectrumFolded.value = !overallSpectrumFolded.value
  persistOverallFolded()
}
watch([viewMode, waveformScales, waveformColors, waveformOpacities, minimapMode], () => {
  try {
    localStorage.setItem(
      STORAGE_TRACKS_WAVEFORM,
      JSON.stringify({
        mode: viewMode.value,
        scales: waveformScales.value,
        colors: waveformColors.value,
        opacities: waveformOpacities.value,
        minimap: minimapMode.value,
      }),
    )
  } catch {
    // ignore
  }
}, { deep: true })
interface WaveformTrack {
  readonly key: string
  readonly channel: number
  readonly label?: string
}
// SF28.1: driven by the unified layout model — ordered + hidden-filtered per channel. Kept LIGHT
// (no analysis) so this getter — evaluated eagerly by the height watch during setup — does not call
// applyHighZoom() before its deps (spectrogramHighZoomActive) are initialised (TDZ). The template
// resolves the per-channel analysis at render time via spectrogramAnalysisForChannel().
const waveformTracks = computed<WaveformTrack[]>(() => {
  const stereo = isSpectrogramStereo.value
  return orderedChannels('waveform', stereo ? 2 : 1).map((ch) => ({
    key: stereo ? (ch === 0 ? 'wL' : 'wR') : 'wMono',
    channel: ch,
    label: stereo ? (ch === 0 ? 'L' : 'R') : undefined,
  }))
})

// SF25: waveform track heights — same mutual-divider + uniform-bottom resize as the spectrogram.
const WAVEFORM_TRACK_HEIGHT_DEFAULT = 110
const WAVEFORM_TRACK_HEIGHT_MIN = 48
const WAVEFORM_TRACK_HEIGHT_MAX = 800
const STORAGE_TRACKS_WAVEFORM_TRACK_HEIGHTS = 'mindwave-tracks-waveform-track-heights'
function clampWaveformHeight(aValue: number): number {
  return Math.max(WAVEFORM_TRACK_HEIGHT_MIN, Math.min(WAVEFORM_TRACK_HEIGHT_MAX, Math.round(aValue)))
}
function loadStoredWaveformTrackHeights(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_TRACKS_WAVEFORM_TRACK_HEIGHTS)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(clampWaveformHeight)
  } catch {
    return []
  }
}
const waveformTrackHeights = ref<number[]>(loadStoredWaveformTrackHeights())
watch(waveformTrackHeights, (v) => {
  try { localStorage.setItem(STORAGE_TRACKS_WAVEFORM_TRACK_HEIGHTS, JSON.stringify(v)) } catch { /* ignore */ }
}, { deep: true })
watch(() => waveformTracks.value.length, (aCount) => {
  const cur = waveformTrackHeights.value
  if (cur.length === aCount) return
  const base = cur[0] ?? WAVEFORM_TRACK_HEIGHT_DEFAULT
  const next: number[] = []
  for (let i = 0; i < aCount; i += 1) next.push(clampWaveformHeight(cur[i] ?? base))
  waveformTrackHeights.value = next
}, { immediate: true })

// Waveform resize handlers (mirror the spectrogram: mutual divider + uniform bottom handle).
// GT11.7 unified resize (owner 2026-07-14): every resize bar behaves the same — gtrack graphs AND the
// overall wave/spectrum channels. Plain drag = just that graph; Ctrl/⌘ = every graph in the same
// GROUP (a voice / the overall wave / the overall spectrum) to one height; Shift = ALL graphs
// everywhere to one height. Overall channels keep per-channel heights — the divider below a channel
// and the bottom handle below the last channel each resize the channel ABOVE them.
type ResizeMode = 'one' | 'group' | 'all'
function resizeModeOf(ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ResizeMode {
  return ev.shiftKey ? 'all' : ev.ctrlKey || ev.metaKey ? 'group' : 'one'
}
// Shift scope: set EVERY graph (all gtrack lanes + all overall wave/spectrum channels) to one height.
function setAllGraphsHeight(target: number): void {
  gtracks.setAllLanesGraphsHeight(target)
  if (waveformTrackHeights.value.length > 0) {
    const h = clampWaveformHeight(target)
    waveformTrackHeights.value = waveformTrackHeights.value.map(() => h)
  }
  if (spectrogramTrackHeights.value.length > 0) {
    const h = clampTrackHeight(target)
    spectrogramTrackHeights.value = spectrogramTrackHeights.value.map(() => h)
  }
}
let overallResize: { kind: 'waveform' | 'spectrogram'; index: number; startH: number; startY: number; mode: ResizeMode } | null = null
function onOverallResizeDown(kind: 'waveform' | 'spectrogram', index: number, ev: PointerEvent): void {
  const heights = kind === 'waveform' ? waveformTrackHeights.value : spectrogramTrackHeights.value
  const startH = heights[index]
  if (startH === undefined) return
  overallResize = { kind, index, startH, startY: ev.clientY, mode: resizeModeOf(ev) }
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  ev.preventDefault()
}
function onOverallResizeMove(ev: PointerEvent): void {
  if (overallResize === null) return
  const target = overallResize.startH + (ev.clientY - overallResize.startY)
  if (overallResize.mode === 'all') { setAllGraphsHeight(target); return }
  const { kind, index, mode } = overallResize
  if (kind === 'waveform') {
    const h = clampWaveformHeight(target)
    waveformTrackHeights.value = waveformTrackHeights.value.map((v, i) => (mode === 'group' || i === index ? h : v))
  } else {
    const h = clampTrackHeight(target)
    spectrogramTrackHeights.value = spectrogramTrackHeights.value.map((v, i) => (mode === 'group' || i === index ? h : v))
  }
}
function onOverallResizeUp(ev: PointerEvent): void {
  overallResize = null
  try { (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId) } catch { /* ignore */ }
}

// Reset the shared spectrogram view/selection when the file changes (fresh full view).
watch(() => audio.displayFilePath, () => {
  spectrogramShared.view.value = null
  spectrogramShared.selection.value = null
  spectrogramShared.freqView.value = null
})

// SF10.1: the shared time window (provide/inject) is driven from the common header above
// the stack. Duration comes from the decoded buffer (~ worker durationSec); good enough
// for zoom/fit view math (SpectrogramView clamps to the analysis anyway).
// Effective time span for the header zoom/fit math: the decoded WAV duration, or (when there is no
// WAV yet, e.g. gtracks-only) the schedule's single-loop duration so the shared view still works.
// GT7.2/GT7.4: duration from the backend analysis, then the gnaural schedule length (gtracks-only).
const spectrogramDuration = computed(
  () => backendAnalysis.value?.durationSec || gtracks.durationSec.value,
)

// SF17.3: high-zoom analysis profile. Above `highZoomThreshold` (with hysteresis to avoid
// re-analysis thrash at the boundary) switch to a smaller FFT window or the reassign data
// mode for sharper time detail; changing these params re-analyses via the composable.
const spectrogramZoomFactor = computed(() => {
  const v = spectrogramShared.view.value
  const dur = spectrogramDuration.value
  if (v === null || dur <= 0) return 1
  const span = v.endSec - v.startSec
  return span > 0 ? dur / span : 1
})
const spectrogramHighZoomActive = ref(false)
watch(
  () => [
    spectrogramZoomFactor.value,
    spectrogramStore.settings.highZoomMode,
    spectrogramStore.settings.highZoomThreshold,
  ] as const,
  ([zoom, mode, threshold]) => {
    if (mode === 'off') {
      spectrogramHighZoomActive.value = false
      return
    }
    if (!spectrogramHighZoomActive.value && zoom >= threshold) spectrogramHighZoomActive.value = true
    else if (spectrogramHighZoomActive.value && zoom < threshold * 0.75) spectrogramHighZoomActive.value = false
  },
  { immediate: true },
)
// SF17.4 (variant C): `smallWindow` no longer reconfigures the whole-track analysis; it is
// applied per-tile via `spectrogramWindowOverride` (the worker serves sharper tiles for the
// visible window only). Only `reassign` still overrides the analysis params (it is inherently
// whole-track — reassignment scatter-writes the whole file).
function applyHighZoom(aBase: SpectrogramAnalysisParams): SpectrogramAnalysisParams {
  const s = spectrogramStore.settings
  if (!spectrogramHighZoomActive.value || s.highZoomMode !== 'reassign') return aBase
  return { ...aBase, data: 'reassign' }
}

// The per-tile FFT window override for the `smallWindow` mode (0 = none / not active).
const spectrogramWindowOverride = computed(() =>
  spectrogramHighZoomActive.value && spectrogramStore.settings.highZoomMode === 'smallWindow'
    ? spectrogramStore.settings.highZoomWindow
    : 0,
)

const spectrogramLeftAnalysis = computed(() => ({ ...applyHighZoom(spectrogramStore.analysisParams), channel: 0 }))
const spectrogramRightAnalysis = computed(() => ({ ...applyHighZoom(spectrogramStore.analysisParams), channel: 1 }))
// SF28.1: analysis params for a given channel (used by both the spectrogram and waveform tracks so
// each track fetches its own channel regardless of display order). Mono uses the base params.
function spectrogramAnalysisForChannel(ch: number): SpectrogramAnalysisParams {
  if (!isSpectrogramStereo.value) return applyHighZoom(spectrogramStore.analysisParams)
  return ch === 0 ? spectrogramLeftAnalysis.value : spectrogramRightAnalysis.value
}

const spectrogramHasView = computed(() => spectrogramShared.view.value !== null)
// v-model bridge for the bottom minimap (SF10.4) onto the shared time window.
const spectrogramView = computed<TimeWindow | null>({
  get: () => spectrogramShared.view.value,
  set: (v) => {
    if (v !== null) spectrogramShared.view.value = v
  },
})
const spectrogramIsFull = computed(() =>
  spectrogramShared.view.value !== null &&
  isFullWindow(spectrogramShared.view.value, spectrogramDuration.value),
)
function spectrogramZoomIn(): void {
  const v = spectrogramShared.view.value
  if (v === null) return
  spectrogramShared.view.value = zoomWindow(v, 0.5, 0.5, spectrogramDuration.value)
}
function spectrogramZoomOut(): void {
  const v = spectrogramShared.view.value
  if (v === null) return
  spectrogramShared.view.value = zoomWindow(v, 2, 0.5, spectrogramDuration.value)
}
function spectrogramFit(): void {
  spectrogramShared.view.value = fullWindow(spectrogramDuration.value)
}

// SF3.1 (SF-D4/D5): the settings panel is a toggleable overlay over the plot (no
// main-content resize), opened from the common header; default closed.
const spectrogramSettingsOpen = ref(false)
function toggleSpectrogramSettings(): void {
  spectrogramSettingsOpen.value = !spectrogramSettingsOpen.value
}
function closeSpectrogramSettings(): void {
  spectrogramSettingsOpen.value = false
}

// SF9.2: the ordered list of spectrogram tracks (mono = 1, stereo L/R = 2). Drives the
// stack render (each track + a divider between adjacent tracks + a bottom handle).
interface SpectrogramTrack {
  readonly key: string
  readonly channel: number
  readonly analysis: SpectrogramAnalysisParams
  readonly label?: string
  readonly primary: boolean
}
// SF28.1: ordered + hidden-filtered per the unified layout model. The first VISIBLE track is
// primary (drives the shared view/keyboard focus).
const spectrogramTracks = computed<SpectrogramTrack[]>(() => {
  if (!isSpectrogramStereo.value) {
    return [{ key: 'mono', channel: 0, analysis: applyHighZoom(spectrogramStore.analysisParams), primary: true }]
  }
  return orderedChannels('spectrogram', 2).map((ch, i) => ({
    key: ch === 0 ? 'L' : 'R',
    channel: ch,
    analysis: ch === 0 ? spectrogramLeftAnalysis.value : spectrogramRightAnalysis.value,
    label: ch === 0 ? 'L' : 'R',
    primary: i === 0,
  }))
})

// Keep the per-track heights array length in sync with the track count; new tracks get
// the first track's height (or the Audacity default), preserving existing sizes.
watch(() => spectrogramTracks.value.length, (aCount) => {
  const cur = spectrogramTrackHeights.value
  if (cur.length === aCount) return
  const base = cur[0] ?? SPECTROGRAM_TRACK_HEIGHT_DEFAULT
  const next: number[] = []
  for (let i = 0; i < aCount; i += 1) next.push(clampTrackHeight(cur[i] ?? base))
  spectrogramTrackHeights.value = next
}, { immediate: true })

// GT11.7: the waveform + spectrogram channel resize bars are handled by the unified onOverallResize*
// above (per-channel drag; Ctrl = the whole stack; Shift = every graph). The old mutual divider +
// uniform bottom handle were removed so all resize bars behave like the gtrack graph handles.

// --- Keyboard: the Tracks tab owns the player hotkeys while it is mounted (AudioPage's frozen
// handler early-returns when this tab is active). Escape closes the settings overlay; nav keys
// go to the primary track editor; Space toggles playback via the parent (transport lives there).
function shouldIgnoreHotkey(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.closest('.audio-page__sidebar') !== null) {
    return true
  }

  if (target.isContentEditable) {
    return true
  }

  return target.closest('input, textarea, select, button, [role="button"], .cm-editor, .q-dialog, .q-menu') !== null
}

// SF21: the primary spectrogram track editor. Global keydown delegates navigation keys to it
// when focus isn't in another control, so arrows/Home/End work anywhere in the window.
interface SpectrogramNavHandle { handleNavKey: (event: KeyboardEvent) => void }
const spectrogramNavRef = ref<SpectrogramNavHandle | null>(null)
function setPrimarySpectrogramRef(el: unknown, index: number): void {
  if (index === 0) spectrogramNavRef.value = (el as SpectrogramNavHandle | null) ?? null
}
// SF23 follow-up: the waveform primary is the nav target when the spectrogram is hidden.
const waveformNavRef = ref<SpectrogramNavHandle | null>(null)
function setPrimaryWaveformRef(el: unknown, index: number): void {
  if (index === 0) waveformNavRef.value = (el as SpectrogramNavHandle | null) ?? null
}
const trackEditorNav = computed(() => spectrogramNavRef.value ?? waveformNavRef.value)
const SPECTROGRAM_NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

// GT3.4 (GT-D3/D4/D5): save the in-memory gtrack edits back to the .gnaural file.
//  1. fetch the CURRENT source XML (fresh mtime for optimistic concurrency + latest bytes),
//  2. patch only the edited voices' <entries> (GT-D5), preserving generator/preparse voices
//     detected from the XML — the client model doesn't flag them yet (that wiring is GT3.7), so
//     without this they'd be irreversibly baked,
//  3. save through the existing editor store (Gnaural.exe validation + atomic write + history),
//  4. reload the schedule (rebuilds the model from the freshly-dumped file → clears dirty/undo)
//     and force a WAV re-render so the waveform + spectrum reflect the saved edits.
const savingEdits = ref(false)

async function saveGtrackEdits(): Promise<void> {
  const model = gtracks.model.value
  const filePath = audio.displayFilePath
  if (model === null || filePath === null || audio.displayMode !== 'gnaural' || savingEdits.value) return
  if (!gtracks.dirty.value) {
    $q.notify({ type: 'info', message: t('audio.editorNoChanges') })
    return
  }
  savingEdits.value = true
  try {
    const doc = await audioApi.fetchEditorDocument(filePath)
    const patched = patchGnauralXml(doc.content, model.schedule, {
      preserveVoiceIds: findPreparseVoiceIds(doc.content),
    })
    const response = await audioApi.saveEditorDocument({
      path: filePath,
      content: patched,
      expectedModifiedAtMs: doc.modifiedAtMs,
    })
    // Rebuilds the model from the freshly-dumped file (dirty/undo reset to the saved baseline). The
    // same-path schedule change triggers the reload-key/meta re-open watch above (GT7.4-R2), so the
    // backend wave/spectrum re-render to the just-saved edit — no explicit bump needed here.
    await audio.loadGnauralSchedule(filePath, true)
    $q.notify({
      type: 'positive',
      message: response.changed ? t('audio.editorSaved') : t('audio.editorNoChanges'),
    })
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: error instanceof Error ? error.message : t('audio.gtrackSaveFailed'),
    })
  } finally {
    savingEdits.value = false
  }
}

// BK8a (owner 2026-07-13): per-voice playback mute, migrated from the removed "Воспроизведение"
// tab's GnauralScheduleView. The muted flag is persisted in the .gnaural (voice_mute); AudioPage owns
// the server patch + reload via patch-voice-state. Mute state is read from the dump — the editor
// model does not carry it (editableToSchedule drops mute/hidden).
function isVoiceMuted(aVoiceId: number): boolean {
  return audio.gnauralSchedule?.voices.find((v) => v.id === aVoiceId)?.muted ?? false
}
async function onToggleVoiceMuted(aVoiceId: number): Promise<void> {
  // A voice-state patch reloads the schedule, which rebuilds the editor model -> unsaved curve edits
  // would be lost. Persist them first (lossless); abort the mute if the save did not clear dirty.
  if (gtracks.dirty.value) {
    await saveGtrackEdits()
    if (gtracks.dirty.value) return
  }
  emit('patch-voice-state', { voiceId: aVoiceId, muted: !isVoiceMuted(aVoiceId) })
}

// BK8a (owner 2026-07-13): the same mute mirrored on each lane (button above the eye). A lane groups
// one or more voices; it counts as muted only when ALL are muted, and toggling flips them together in
// one batch patch (one server round-trip + reload).
function laneMuted(aLane: { voices: readonly { id: number }[] }): boolean {
  return aLane.voices.length > 0 && aLane.voices.every((v) => isVoiceMuted(v.id))
}
async function onToggleLaneMuted(aLane: { voices: readonly { id: number }[] }): Promise<void> {
  if (aLane.voices.length === 0) return
  const nextMuted = !laneMuted(aLane)
  if (gtracks.dirty.value) {
    await saveGtrackEdits()
    if (gtracks.dirty.value) return
  }
  emit('patch-voice-state-batch', aLane.voices.map((v) => ({ voiceId: v.id, muted: nextMuted })))
}

// owner 2026-07-13: overall-mix inclusion, mirrored on the lane (button under the eye). Purely a
// client display filter (no schedule patch/reload) — the overall wave/spectrum re-render because their
// soloVoiceIds (mixVoiceIds) change. A lane is "in mix" only when ALL its voices are.
function laneInMix(aLane: { voices: readonly { id: number }[] }): boolean {
  return aLane.voices.length === 0 || aLane.voices.every((v) => gtracks.isVoiceInMix(v.id))
}
function onToggleLaneInMix(aLane: { voices: readonly { id: number }[] }): void {
  const next = !laneInMix(aLane)
  for (const v of aLane.voices) gtracks.setVoiceInMix(v.id, next)
}

function handleTracksKeyDown(event: KeyboardEvent): void {
  altBigStep.value = event.altKey // GT10.22: keep the spinner big-step in sync with the Alt key
  // GT3.9: Escape closes the voice panel first, then the settings overlay.
  if (event.key === 'Escape' && tracksListPanel.open) {
    event.preventDefault()
    tracksListPanel.open = false
    return
  }
  // GT9.2: Escape closes the schedule-problems panel too.
  if (event.key === 'Escape' && diagnosticsOpen.value) {
    event.preventDefault()
    diagnosticsOpen.value = false
    return
  }
  // SF3.1: Escape closes the spectrogram settings overlay (before other hotkey guards).
  if (event.key === 'Escape' && spectrogramSettingsOpen.value) {
    event.preventDefault()
    closeSpectrogramSettings()
    return
  }
  // GT3.16 (review #2): Escape also closes the point inspector (single or table), matching the
  // other overlays' behaviour.
  if (event.key === 'Escape' && inspectorMode.value !== 'none') {
    event.preventDefault()
    closeInspector()
    return
  }
  // GT3.4: Ctrl/Cmd+S saves the gtrack edits (intercept before the typing guard so it also works
  // while an inspector field is focused, and to suppress the browser's Save-page dialog).
  if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
    event.preventDefault()
    void saveGtrackEdits()
    return
  }
  // GT3.2/GT10.24 (owner req. 73): undo/redo the gtrack edits (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or
  // Ctrl/Cmd+Y) — intercepted BEFORE the typing guard so Ctrl+Z undoes a just-added node even when
  // focus landed on a button (a lane gear, the point-mode toggle) or an inspector field. Model undo
  // is the editor's primary undo (field edits autosave into the same history).
  if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
    event.preventDefault()
    if (event.shiftKey) redoWithFocus()
    else undoWithFocus()
    return
  }
  if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || event.key === 'Y')) {
    event.preventDefault()
    redoWithFocus()
    return
  }
  // GT10.22 (owner req. 71, owner 2026-07-12): Alt+Arrow = big step (±1) on a focused numeric field.
  // BEFORE the typing guard (focus is inside the input) — the window keydown reliably carries the
  // modifier, unlike the QInput @keydown / a wrapper capture listener, which didn't fire the step.
  // (Alt+click on the native spinner is handled separately via the altBigStep `step` toggle.)
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    const fieldEl = (document.activeElement as HTMLElement | null)?.closest('[data-step-field]') as HTMLElement | null
    if (fieldEl !== null) {
      event.preventDefault()
      applyFieldBigStep(fieldEl, event.key === 'ArrowUp' ? 1 : -1)
      return
    }
  }

  if (shouldIgnoreHotkey(event)) {
    return
  }

  // GT3.6/GT3.16 (review #3): Delete removes the multi-selection when the table is active,
  // otherwise the single selected vertex (min-2-points guard lives in the model).
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (inspectorMode.value === 'table') {
      event.preventDefault()
      gtracks.removeMultiSelection()
      return
    }
    if (gtracks.selection.value !== null) {
      event.preventDefault()
      gtracks.removeSelectedPoint()
      return
    }
  }

  // SF21: route navigation keys to the primary track editor even if the canvas isn't focused.
  if (trackEditorNav.value !== null && SPECTROGRAM_NAV_KEYS.has(event.key)) {
    // SF23.1: preventDefault FIRST so Alt+Left/Right don't trigger the browser's history
    // back/forward (hash router) before the pan runs.
    event.preventDefault()
    trackEditorNav.value.handleNavKey(event)
    return
  }

  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    emit('toggle-play')
  }
}

// GT7.2: keep the backend metadata analysis open for the current display file. channelCount +
// durationSec don't depend on the FFT params, so it's opened once per file (no reconfigure needed).
watch(() => audio.displayFilePath, (path) => { void openMetaAnalysis(path) })

// GT10.27 (owner req. 76): the flyout panels (voices / problems / spectrum settings) live inside the
// scroll container, so as absolutely-positioned children they scroll AWAY with the lane stack and
// open off-screen when the editor is scrolled. Pin them to the container's on-screen frame instead:
// publish the container's viewport rect as CSS vars and switch the panels to position:fixed. The
// vars inherit down the DOM, so the fixed panels track the visible editor regardless of scroll.
const rootEl = ref<HTMLElement | null>(null)
const overlayFrame = ref<Record<string, string>>({})
// GT10.30 (owner req. 79): the point inspector is pinned to the same frame, so measure while it is open too.
// PW5.2: the «Список треков» panel is a PanelWindow (owns its own positioning), so it no longer
// uses the scroll-frame pinning (--tp-*) that the remaining fixed flyouts still need.
const anyOverlayOpen = computed(() => diagnosticsOpen.value || spectrogramSettingsOpen.value || inspectorMode.value !== 'none')
function measureOverlayFrame(): void {
  const el = rootEl.value
  if (el === null) return
  const r = el.getBoundingClientRect()
  overlayFrame.value = {
    '--tp-top': `${r.top}px`,
    '--tp-left': `${r.left}px`,
    '--tp-right': `${Math.max(0, window.innerWidth - r.right)}px`,
    '--tp-bottom': `${Math.max(0, window.innerHeight - r.bottom)}px`,
  }
}
watch(anyOverlayOpen, (open) => {
  if (open) {
    measureOverlayFrame()
    window.addEventListener('resize', measureOverlayFrame)
    window.addEventListener('scroll', measureOverlayFrame, true) // capture: also catches inner scrolls
  } else {
    window.removeEventListener('resize', measureOverlayFrame)
    window.removeEventListener('scroll', measureOverlayFrame, true)
  }
})

// GT10.22: track the Alt key so the spinner big-step (`fieldStep`) follows it; reset on blur so a
// missed keyup (e.g. Alt+Tab away) can't leave the fields stuck on step 1.
function syncAltBigStep(event: KeyboardEvent): void { altBigStep.value = event.altKey }
function clearAltBigStep(): void { altBigStep.value = false }

onMounted(() => {
  window.addEventListener('keydown', handleTracksKeyDown)
  window.addEventListener('keyup', syncAltBigStep)
  window.addEventListener('blur', clearAltBigStep)
  void openMetaAnalysis(audio.displayFilePath)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleTracksKeyDown)
  window.removeEventListener('keyup', syncAltBigStep)
  window.removeEventListener('blur', clearAltBigStep)
  window.removeEventListener('resize', measureOverlayFrame)
  window.removeEventListener('scroll', measureOverlayFrame, true)
  if (newLaneTimer !== null) clearTimeout(newLaneTimer)
  metaSpec.dispose()
})
</script>

<style scoped>
.audio-page__output-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px;
}

.audio-page__output-section--spectrogram {
  overflow: auto;
  position: relative;
}

/* PW5.2: «Список треков» dock host. The root stops being the scroll container (that moves down to
   .tracks-panel__dock-inner) so a DOCKED PanelWindow sits ABOVE the scroll and reflows the content
   instead of scrolling away with it. Two-class specificity overrides the --spectrogram overflow. */
.audio-page__output-section--spectrogram.tracks-panel__root {
  overflow: hidden;
}
.tracks-panel__dock-wrap {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.tracks-panel__dock-wrap--row { flex-direction: row; }
.tracks-panel__dock-wrap--col { flex-direction: column; }
.tracks-panel__dock-inner {
  order: 1;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
/* the panel body fills + scrolls inside the PanelWindow chrome (which is a flex column). */
.tracks-panel__list-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.audio-page__player-toolbar {
  display: flex;
  flex: 0 0 auto;
  margin-bottom: 12px;
}

/* GT10.16: staged open-progress list. */
.tracks-panel__stages {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tracks-panel__stage {
  align-items: center;
  display: flex;
}

.audio-page__empty {
  align-items: center;
  display: flex;
  height: 100%;
  justify-content: center;
  min-height: 120px;
  text-align: center;
}

.audio-page__async-placeholder {
  align-items: center;
  display: flex;
  height: 100%;
  justify-content: center;
  min-height: 160px;
}

/* SF10.1: common header above the whole spectrogram stack (all control buttons here). */
.audio-page__spectrogram-header {
  align-items: center;
  color: #94a3b8;
  display: flex;
  gap: 4px;
  padding: 0 4px 4px;
}

/* SF26: minimap gear (settings) overlaid in the top-right corner. */
.audio-page__minimap-wrap {
  position: relative;
}

.audio-page__minimap-gear {
  color: #cbd5e1;
  opacity: 0.7;
  position: absolute;
  right: 4px;
  top: 2px;
  z-index: 3;
}

.audio-page__minimap-gear:hover {
  opacity: 1;
}

.audio-page__minimap-dialog {
  min-width: 300px;
}

/* SF22: waveform tracks above the spectrogram. */
.audio-page__waveform-stack {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 2px;
}

/* GT2.2: gtrack editor lanes stack (above the waveform + spectrum). */
.audio-page__gtrack-stack {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 2px;
}

/* GT4.2 (GT-D17): inline solo underlay — the solo wave/spectrum sits BEHIND the curve lane, which
   punches a transparent hole in its plot so the underlay shows through under the curves. */
/* GT11.5 (owner 2026-07-14): per-track header bar above each lane's graphs
   (track-colour stripe + Fold/Unfold + wave name). */
.tracks-panel__gtrack-header {
  align-items: center;
  background: rgba(148, 163, 184, 0.08);
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  display: flex;
  gap: 2px;
  height: 22px;
  overflow: hidden;
  position: relative;
  width: 100%;
}
.tracks-panel__gtrack-header-stripe {
  align-self: stretch;
  flex: 0 0 4px;
  width: 4px;
}
.tracks-panel__gtrack-fold,
.tracks-panel__gtrack-header-eye {
  flex: 0 0 auto;
}
/* GT11.11: the eye reads as "there are hidden graphs here" — a soft accent so it stands out. */
.tracks-panel__gtrack-header-eye {
  color: #fbbf24;
}
.tracks-panel__gtrack-header-title {
  flex: 1 1 auto;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracks-panel__gtrack-inline {
  position: relative;
  width: 100%;
}
/* GT10.28 (owner req. 77): flash a highlight on a freshly added lane. */
.tracks-panel__gtrack-inline--new {
  animation: tracks-panel-new-lane 1.8s ease-out;
  outline: 2px solid rgba(103, 232, 249, 0.9);
  outline-offset: -2px;
  z-index: 2;
}
@keyframes tracks-panel-new-lane {
  0% { outline-color: rgba(103, 232, 249, 0.95); box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.35); }
  100% { outline-color: rgba(103, 232, 249, 0); box-shadow: 0 0 0 3px rgba(103, 232, 249, 0); }
}

.tracks-panel__gtrack-underlay {
  inset: 0;
  position: absolute;
  z-index: 0;
}

.tracks-panel__gtrack-over {
  position: relative;
  z-index: 1;
}

/* GT10.2 (owner req. 44): solo sub-lanes carry the lane's accent stripe. */
.tracks-panel__sublane {
  position: relative;
  width: 100%;
}

/* GT10.13 (owner req. 62): the header sticks while the lane stack scrolls under it. */
.audio-page__output-section--spectrogram .audio-page__spectrogram-header {
  background: #0f172a;
  padding-bottom: 4px;
  padding-top: 4px;
  position: sticky;
  top: -16px; /* compensates the section's 16px top padding */
  z-index: 40;
}

/* GT9.2: lint diagnostic messages wrap instead of truncating. */
.tracks-panel__diag-msg {
  white-space: normal;
}

.audio-page__gtrack-dialog {
  min-width: 320px;
}

/* SF28.3: the track currently being dragged for reorder. */
.audio-page__track--dragging {
  opacity: 0.6;
  outline: 2px dashed rgba(103, 232, 249, 0.7);
  outline-offset: -2px;
}

.audio-page__wf-color {
  background: none;
  border: none;
  cursor: pointer;
  height: 26px;
  padding: 0;
  width: 40px;
}

/* SF9.2: 2px mutual-resize divider between adjacent spectrogram tracks (SF-D19). */
.audio-page__spectrogram-divider {
  background: rgba(148, 163, 184, 0.35);
  cursor: ns-resize;
  flex: 0 0 auto;
  height: 2px;
  touch-action: none;
  width: 100%;
}

.audio-page__spectrogram-divider:hover {
  background: rgba(148, 163, 184, 0.7);
}

/* SF9.3: bottom handle below the last track — uniform resize of all tracks (SF-D20). */
/* SF26: the bottom resize handle matches the between-tracks divider (same 2px thickness + look). */
.audio-page__spectrogram-bottom-handle {
  background: rgba(148, 163, 184, 0.35);
  cursor: ns-resize;
  flex: 0 0 auto;
  height: 2px;
  touch-action: none;
  width: 100%;
}

.audio-page__spectrogram-bottom-handle:hover {
  background: rgba(148, 163, 184, 0.4);
}

/* SF3.1 (SF-D4): settings overlay "Параметры" over the plot (no main-content resize). */
.audio-page__spectrogram-settings-backdrop {
  background: rgba(2, 6, 23, 0.45);
  /* GT10.27 (owner req. 76): pinned to the editor's on-screen frame (position:fixed + the rect vars
     published by measureOverlayFrame), so the overlay stays visible at any scroll position. */
  position: fixed;
  top: var(--tp-top, 0px);
  left: var(--tp-left, 0px);
  right: var(--tp-right, 0px);
  bottom: var(--tp-bottom, 0px);
  /* GT10.19 (owner req. 68): above the sticky header (z-index 40) so flyout panels are not
     covered by the header's zoom buttons. */
  z-index: 50;
}

.audio-page__spectrogram-settings-panel {
  background: #0f172a;
  border-left: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: -18px 0 40px rgba(2, 6, 23, 0.45);
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 56px);
  /* GT10.27 (owner req. 76): pinned to the editor frame (see backdrop). */
  position: fixed;
  right: var(--tp-right, 0px);
  top: var(--tp-top, 0px);
  bottom: var(--tp-bottom, 0px);
  width: 300px;
  /* GT10.19 (owner req. 68): above the sticky header (z-index 40). */
  z-index: 60;
}

.audio-page__spectrogram-settings-header {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 10px 8px 10px 16px;
}

.audio-page__spectrogram-settings-title {
  color: #e2e8f0;
  font-size: 15px;
  font-weight: 700;
}

.audio-page__spectrogram-settings-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px;
}

.spectrogram-settings-backdrop-enter-active,
.spectrogram-settings-backdrop-leave-active {
  transition: opacity 0.18s ease;
}

.spectrogram-settings-backdrop-enter-from,
.spectrogram-settings-backdrop-leave-to {
  opacity: 0;
}

.spectrogram-settings-panel-enter-active,
.spectrogram-settings-panel-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.spectrogram-settings-panel-enter-from,
.spectrogram-settings-panel-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

/* GT3.9 (GT-D15): the schedule's voice panel — slides in over the tracks from the LEFT. */
.tracks-panel__voices-panel {
  background: #0f172a;
  border-right: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: 18px 0 40px rgba(2, 6, 23, 0.45);
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 56px);
  /* GT10.27 (owner req. 76): pinned to the editor frame (see backdrop). */
  position: fixed;
  left: var(--tp-left, 0px);
  top: var(--tp-top, 0px);
  bottom: var(--tp-bottom, 0px);
  width: 340px;
  /* GT10.19 (owner req. 68): above the sticky header (z-index 40). */
  z-index: 60;
}

.gtrack-voices-panel-enter-active,
.gtrack-voices-panel-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.gtrack-voices-panel-enter-from,
.gtrack-voices-panel-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

.tracks-panel__voices-bulk {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tracks-panel__voices-mode-all {
  flex: 1 1 auto;
  min-width: 140px;
}

.tracks-panel__voice-row {
  padding-left: 4px;
  padding-right: 4px;
}

.tracks-panel__voice-dot {
  border-radius: 50%;
  display: inline-block;
  height: 12px;
  width: 12px;
}

.tracks-panel__voice-mode {
  min-width: 96px;
}

/* GT3.11: volume L/R side by side without q-col-gutter's negative margins (req. 22). */
.tracks-panel__vol-row {
  display: flex;
  gap: 8px;
}

.tracks-panel__vol-row > * {
  flex: 1 1 0;
  min-width: 0;
}

/* GT3.12 (GT-D18): non-modal point inspector — a small floating panel (NOT edge-docked, so it
   doesn't cover the whole stack) with no backdrop element at all, so the tracks underneath stay
   fully clickable (owner req. 26). */
.tracks-panel__point-inspector {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(2, 6, 23, 0.55);
  display: flex;
  flex-direction: column;
  overflow: auto;
  /* GT10.30 (owner req. 79): pinned to the editor's on-screen frame (see GT10.27's --tp-* vars) so
     the dialog is not covered by the sticky header/toolbar and does not scroll away. Dragging sets
     inline left/top (viewport coords) which override the default corner. */
  position: fixed;
  top: calc(var(--tp-top, 0px) + 12px);
  right: calc(var(--tp-right, 0px) + 12px);
  max-height: calc(100vh - var(--tp-top, 0px) - var(--tp-bottom, 0px) - 24px);
  width: 300px;
  z-index: 45;
}

.gtrack-point-inspector-enter-active,
.gtrack-point-inspector-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.gtrack-point-inspector-enter-from,
.gtrack-point-inspector-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

.tracks-panel__point-inspector-actions {
  align-items: center;
  display: flex;
  gap: 4px;
  padding: 8px;
}

/* GT10.38 (owner 2026-07-12): inset the balance slider so its thumb at the extremes stays inside
   the dialog (otherwise it overflows and triggers a horizontal scrollbar). */
.tracks-panel__balance-slider {
  padding: 0 10px;
}

/* GT3.21 (owner req. 41): the inspector title bar is a drag handle (grows to fill the bar). */
.tracks-panel__inspector-drag {
  cursor: move;
  flex: 1 1 auto;
  touch-action: none;
  user-select: none;
}

/* GT3.15: table mode is wider (needs room for 5 columns) than the single-point form. */
.tracks-panel__point-inspector--table {
  /* GT10.9 (owner req. 53): grow to fit the table — no horizontal scrollbar. */
  max-width: calc(100vw - 48px);
  min-width: 420px;
  width: max-content;
}

.tracks-panel__multi-table-wrap {
  max-height: 260px;
  overflow: auto;
}

.tracks-panel__multi-table :deep(.q-field__control) {
  height: 32px;
}

.tracks-panel__multi-table th {
  font-size: 11px;
  white-space: nowrap;
}

.tracks-panel__multi-table td {
  min-width: 64px;
  padding: 2px 6px;
}

/* GT10.23 (owner req. 72): numeric headers + values are both right-aligned so the columns line up
   with their headers. The checkbox column is narrow. */
.tracks-panel__multi-table th.tracks-panel__col-num,
.tracks-panel__multi-table td.tracks-panel__col-num {
  text-align: right;
}
.tracks-panel__multi-table th.tracks-panel__col-chk,
.tracks-panel__multi-table td.tracks-panel__col-chk {
  min-width: 0;
  width: 28px;
  text-align: center;
}
/* GT10.20 (owner req. 69): clickable colour circle that opens the colour picker. */
.tracks-panel__color-swatch {
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(2, 6, 23, 0.5);
  cursor: pointer;
  height: 28px;
  width: 28px;
}
.tracks-panel__color-swatch:hover {
  border-color: rgba(255, 255, 255, 0.85);
}
.tracks-panel__color-popup {
  background: #1e293b;
  border-radius: 6px;
  padding: 2px;
}

/* GT10.43 (owner req.): the ordinal (#) column is narrow. */
.tracks-panel__multi-table th.tracks-panel__col-idx,
.tracks-panel__multi-table td.tracks-panel__col-idx {
  min-width: 0;
  width: 36px;
}

/* GT10.41 (owner req.): collapsible per-voice group header row. */
.tracks-panel__group-row {
  cursor: pointer;
  user-select: none;
}
.tracks-panel__group-row td {
  background: rgba(148, 163, 184, 0.12);
  font-weight: 600;
  padding: 4px 6px;
}
.tracks-panel__group-row:hover td {
  background: rgba(148, 163, 184, 0.2);
}
</style>
