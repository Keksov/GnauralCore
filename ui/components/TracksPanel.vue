<template>
  <div ref="rootEl" :style="overlayFrame" class="audio-page__output-section audio-page__output-section--spectrogram">
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
            :color="voicesPanelOpen ? 'primary' : undefined"
            :aria-label="t('audio.gtrackVoicesPanel')"
            :aria-expanded="voicesPanelOpen"
            @click="voicesPanelOpen = !voicesPanelOpen"
          >
            <q-tooltip>{{ t('audio.gtrackVoicesPanel') }}</q-tooltip>
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
            @click="gtracks.addLane()"
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
            <!-- GT4.2 (GT-D17): a curve lane sits over an optional inline solo-audio underlay -->
            <div class="tracks-panel__gtrack-inline" :style="{ height: `${gtracks.laneHeight.value}px` }">
              <waveform-view
                v-if="laneInlineKind(lane) === 'wave'"
                class="tracks-panel__gtrack-underlay"
                :style="{ opacity: lane.soloWaveOpacity }"
                :file-path="audio.displayFilePath"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :color="lane.soloWaveColor"
                :seekable="false"
                :height="gtracks.laneHeight.value"
                :show-time-axis-top="gIndex === 0"
                :show-time-axis-bottom="false"
              />
              <spectrogram-view
                v-else-if="laneInlineKind(lane) === 'spectrum'"
                class="tracks-panel__gtrack-underlay"
                :file-path="audio.displayFilePath"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :render="laneSpectrogramRender(lane.id)"
                :seekable="false"
                :primary="false"
                :height="gtracks.laneHeight.value"
                :show-time-axis-top="gIndex === 0"
                :show-time-axis-bottom="false"
              />
              <GTrackView
                class="tracks-panel__gtrack-over"
                :inline-underlay="laneInlineKind(lane) !== null"
                :data-gtrack-lane="lane.id"
                :voices="lane.voices"
                :mode="lane.mode"
                :duration-sec="gtracks.durationSec.value"
                :label="gtrackLaneLabel(lane)"
                :height="gtracks.laneHeight.value"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="true"
                :show-time-axis-top="gIndex === 0"
                :show-time-axis-bottom="false"
                :point-mode="gtracks.isLanePointMode(lane.id)"
                :selection="gtracks.selectionForLane(lane.id)"
                :point-tool="gtracks.pointTool.value"
                :multi-selected="gtracks.multiSelection.value"
                :accent-color="laneAccentColor(lane)"
                :class="{ 'audio-page__track--dragging': gtrackDrag === lane.id }"
                @seek="handleSeek"
                @open-settings="gtrackSettingsId = lane.id"
                @hide="gtracks.setLaneHidden(lane.id, true)"
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
            <!-- GT4.3/GT4.1: solo audio shown as sub-lane(s) below (when not inline). -->
            <div v-if="laneWaveSublane(lane)" class="tracks-panel__sublane" :style="sublaneAccentStyle(lane)">
              <waveform-view
                :file-path="audio.displayFilePath"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :color="lane.soloWaveColor"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="false"
                :label="`◑ ${gtrackLaneLabel(lane)}`"
                :height="Math.round(gtracks.laneHeight.value * 0.7)"
                :show-time-axis-top="false"
                :show-time-axis-bottom="false"
                @open-settings="gtrackSettingsId = lane.id"
              />
            </div>
            <div v-if="laneSpectrumSublane(lane)" class="tracks-panel__sublane" :style="sublaneAccentStyle(lane)">
              <spectrogram-view
                :file-path="audio.displayFilePath"
                :solo-voice-ids="lane.voiceIds"
                :analysis="laneSpectrogramAnalysis(lane.id)"
                :render="laneSpectrogramRender(lane.id)"
                :playhead-sec="gtrackPlayheadSec"
                :seekable="false"
                :primary="false"
                :show-settings-gear="true"
                :label="`◐ ${gtrackLaneLabel(lane)}`"
                :height="Math.round(gtracks.laneHeight.value * 0.9)"
                :show-time-axis-top="false"
                :show-time-axis-bottom="false"
                @open-settings="gtrackSettingsId = lane.id"
              />
            </div>
          </template>
          <div
            class="audio-page__spectrogram-bottom-handle"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onGtrackBottomPointerDown"
            @pointermove="onGtrackBottomPointerMove"
            @pointerup="onGtrackBottomPointerUp"
            @pointercancel="onGtrackBottomPointerUp"
          />
        </div>
        <!-- SF22: waveform tracks above the spectrogram (Audacity-style), sharing the view.
             SF25: same resizers as the spectrogram (mutual divider + uniform bottom handle). -->
        <div v-if="showWaveform && hasSpectrogramData" class="audio-page__waveform-stack">
          <template v-for="(wtrack, wIndex) in waveformTracks" :key="wtrack.key">
            <waveform-view
              :ref="(el) => setPrimaryWaveformRef(el, wIndex)"
              :file-path="audio.displayFilePath"
              :analysis="spectrogramAnalysisForChannel(wtrack.channel)"
              :channel="wtrack.channel"
              :label="wtrack.label"
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
              @pointerdown="onWaveformDividerPointerDown($event, wIndex)"
              @pointermove="onWaveformDividerPointerMove"
              @pointerup="onWaveformDividerPointerUp"
              @pointercancel="onWaveformDividerPointerUp"
            />
          </template>
          <div
            class="audio-page__spectrogram-bottom-handle"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onWaveformBottomPointerDown"
            @pointermove="onWaveformBottomPointerMove"
            @pointerup="onWaveformBottomPointerUp"
            @pointercancel="onWaveformBottomPointerUp"
          />
        </div>
        <div v-if="showSpectrogram && hasSpectrogramData" class="audio-page__spectrogram-stack">
        <template v-for="(track, index) in spectrogramTracks" :key="track.key">
          <spectrogram-view
            :ref="(el) => setPrimarySpectrogramRef(el, index)"
            :file-path="audio.displayFilePath"
            :analysis="track.analysis"
            :render="spectrogramStore.renderOptions"
            :window-override="spectrogramWindowOverride"
            :waveform-overlay="waveformOverlay"
            :waveform-buffer="audio.spectrogramBuffer"
            :waveform-scale="wfScale(track.channel)"
            :waveform-color="wfColor(track.channel)"
            :waveform-opacity="wfOpacity(track.channel)"
            :waveform-channel="track.channel"
            :playhead-sec="gtrackPlayheadSec"
            :seekable="canSeek"
            :label="track.label"
            :primary="track.primary"
            :show-time-axis-top="index === 0 && !showWaveform"
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
            @pointerdown="onSpectrogramDividerPointerDown($event, index)"
            @pointermove="onSpectrogramDividerPointerMove"
            @pointerup="onSpectrogramDividerPointerUp"
            @pointercancel="onSpectrogramDividerPointerUp"
          />
        </template>
          <!-- SF9.3: bottom handle resizes ALL tracks uniformly (SF-D20) -->
          <div
            class="audio-page__spectrogram-bottom-handle"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t('audio.spectrogramResizeHandle')"
            @pointerdown="onSpectrogramBottomPointerDown"
            @pointermove="onSpectrogramBottomPointerMove"
            @pointerup="onSpectrogramBottomPointerUp"
            @pointercancel="onSpectrogramBottomPointerUp"
          />
        </div>
        <!-- SF10.4: fixed bottom minimap-overview / timespan selector (SF-D24).
             B7: also renders a whole-clip spectrogram thumbnail (primary channel). -->
        <div v-if="showSpectrogram && hasSpectrogramData" class="audio-page__minimap-wrap">
          <spectrogram-minimap
            :duration-sec="spectrogramDuration"
            :file-path="audio.displayFilePath"
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
                    <q-input
                      dense outlined
                      :model-value="gtrackSettingsLane.soloWaveColor ?? '#f59e0b'"
                      :label="t('audio.gtrackSoloWaveColor')"
                      @update:model-value="(v) => gtracks.setLaneSoloWaveStyle(gtrackSettingsLane!.id, String(v ?? '#f59e0b'), gtrackSettingsLane!.soloWaveOpacity ?? 0.6)"
                    >
                      <template #append>
                        <q-badge rounded :style="{ background: gtrackSettingsLane.soloWaveColor ?? '#f59e0b' }" />
                      </template>
                    </q-input>
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

    <!-- GT3.9 (GT-D15): the schedule's voice panel slides in OVER the tracks (left side). -->
    <transition name="spectrogram-settings-backdrop">
      <div
        v-if="voicesPanelOpen"
        class="audio-page__spectrogram-settings-backdrop"
        aria-hidden="true"
        @click="voicesPanelOpen = false"
      />
    </transition>
    <transition name="gtrack-voices-panel">
      <aside
        v-if="voicesPanelOpen"
        class="tracks-panel__voices-panel"
        role="dialog"
        aria-modal="false"
        :aria-label="t('audio.gtrackVoicesPanel')"
      >
        <div class="audio-page__spectrogram-settings-header">
          <div class="audio-page__spectrogram-settings-title">{{ t('audio.gtrackVoicesPanel') }}</div>
          <q-btn
            flat round dense
            icon="close"
            :aria-label="t('audio.spectrogramSettingsClose')"
            @click="voicesPanelOpen = false"
          />
        </div>
        <div class="audio-page__spectrogram-settings-body">
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
      </aside>
    </transition>

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
          <div class="audio-page__spectrogram-settings-body tracks-panel__multi-table-wrap">
            <q-markup-table dense flat dark class="tracks-panel__multi-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{{ t('audio.gtrackVoicesPanel') }}</th>
                  <th>{{ t('audio.gtrackPointBase') }}</th>
                  <th>{{ t('audio.gtrackPointBeat') }}</th>
                  <th>{{ t('audio.gtrackPointVolL') }}</th>
                  <th>{{ t('audio.gtrackPointVolR') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in multiForm" :key="`${row.voiceId}:${row.pointIndex}`">
                  <td><q-checkbox v-model="row.checked" dense /></td>
                  <td>{{ multiRowVoiceName(row.voiceId) }}</td>
                  <td>
                    <q-input
                      v-model.number="row.baseFreq" dense borderless type="number" @keydown="ctrlStep($event, row, 'baseFreq')" step="0.1" min="0"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td>
                    <q-input
                      v-model.number="row.beatFreq" dense borderless type="number" @keydown="ctrlStep($event, row, 'beatFreq')" step="0.1" min="0"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td>
                    <q-input
                      v-model.number="row.volL" dense borderless type="number" @keydown="ctrlStep($event, row, 'volL')" step="0.01" min="0" max="1"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td>
                    <q-input
                      v-model.number="row.volR" dense borderless type="number" @keydown="ctrlStep($event, row, 'volR')" step="0.01" min="0" max="1"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                </tr>
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
          <div class="audio-page__spectrogram-settings-body q-gutter-sm">
            <q-input
              v-model.number="pointForm.timeSec" dense outlined type="number" @keydown="ctrlStep($event, pointForm, 'timeSec')" step="0.01" min="0"
              :label="t('audio.gtrackPointTime')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
            <q-input
              v-model.number="pointForm.baseFreq" dense outlined type="number" @keydown="ctrlStep($event, pointForm, 'baseFreq')" step="0.1" min="0"
              :label="t('audio.gtrackPointBase')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
            <q-input
              v-model.number="pointForm.beatFreq" dense outlined type="number" @keydown="ctrlStep($event, pointForm, 'beatFreq')" step="0.1" min="0"
              :label="t('audio.gtrackPointBeat')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
            <!-- GT3.11 (owner req. 22): plain flex gap — q-col-gutter's negative margins made
                 these overlap the beat-frequency field inside a q-gutter parent. -->
            <div class="tracks-panel__vol-row">
              <q-input
                v-model.number="pointForm.volL" dense outlined type="number" @keydown="ctrlStep($event, pointForm, 'volL')" step="0.01" min="0" max="1"
                :label="t('audio.gtrackPointVolL')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
              />
              <q-input
                v-model.number="pointForm.volR" dense outlined type="number" @keydown="ctrlStep($event, pointForm, 'volR')" step="0.01" min="0" max="1"
                :label="t('audio.gtrackPointVolR')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
              />
            </div>
            <!-- Derived controls (GT-D6): editing them maps back onto volL/volR. -->
            <!-- GT10.37 (owner 2026-07-12): Volume is a numeric field with steppers (was a slider). -->
            <q-input
              :model-value="Number(pointFormVolume.toFixed(3))" dense outlined type="number" step="0.01" min="0" max="1"
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

import { computed, defineAsyncComponent, defineComponent, h, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type AsyncComponentLoader, type Component } from 'vue'
import { QSpinnerHourglass, useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'

import type { SpectrogramAnalysisParams } from '@protocol'

import { audioApi } from '../audio-api'
import SpectrogramMinimap from './SpectrogramMinimap.vue'
import SpectrogramView from './SpectrogramView.vue'
import WaveformView from './WaveformView.vue'
import GTrackView from './GTrackView.vue'
import GTrackSpectrumSettings from './GTrackSpectrumSettings.vue'
import { findPreparseVoiceIds, patchGnauralXml } from '../composables/gtrack-xml'
import { toAnalysisParams, toRenderOptions } from '../composables/spectrogram-settings'
import { useSpectrogram } from '../composables/use-spectrogram'
import { useGtrackLanes, type GTrackAddPoint, type GTrackDragMove, type GTrackPointDragMode, type GTrackPointRef, type GTrackSoloMode } from '../composables/use-gtrack-lanes'
import type { GTrackDiagnostic } from '../composables/gtrack-lint'
import type { GTrackVoice } from '../composables/gtrack-model'
import { GTRACK_MODES, type GTrackMode } from '../composables/gtrack-render'
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
}>()

// Aliases keep the moved template byte-identical to the frozen original.
const displayedPositionSec = computed(() => props.positionSec)
const canSeek = computed(() => props.canSeek)
// GT10.32 (owner 2026-07-12): the Tracks editor keeps a PERSISTENT local playhead so clicking a
// curve (or arrow-key seek) places a visible position cursor even when the transport is STOPPED —
// the shared optimistic seek reverts to 0 once the transport is idle, which made the cursor snap
// back to 0. (gtrackPlayheadSec + the reactivity live after the audio store is created below.)
const localPlayheadSec = ref<number | null>(null)
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
const gtracks = useGtrackLanes(
  computed(() => audio.gnauralSchedule),
  computed(() => audio.displayFilePath),
)
const showGtracks = computed(() => audio.displayMode === 'gnaural' && gtracks.visibleLanes.value.length > 0)
// GT3.9 (GT-D15): the schedule's voice panel (slide-over, left).
const voicesPanelOpen = ref(false)

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
  baseFreq: number
  beatFreq: number
  volL: number
  volR: number
  /** GT10.9 (owner req. 54): row selection for 'delete selected' (all checked by default). */
  checked: boolean
}
const multiForm = ref<MultiFormRow[]>([])
function modelRow(voiceId: number, pointIndex: number, point: { baseFreq: number; beatFreqHalf: number; volL: number; volR: number }): MultiFormRow {
  return {
    voiceId,
    pointIndex,
    baseFreq: Number(point.baseFreq.toFixed(3)),
    beatFreq: Number((point.beatFreqHalf * 2).toFixed(3)),
    volL: Number(point.volL.toFixed(3)),
    volR: Number(point.volR.toFixed(3)),
    checked: true, // GT10.9 (owner req. 54): rows are selected by default
  }
}
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
// GT10.6 (owner req. 50, owner's chosen variant): Ctrl+Arrow steps a numeric field by 1.0
// (plain arrows keep the input's own fine step).
function ctrlStep(e: KeyboardEvent, obj: Record<string, unknown>, key: string): void {
  if (!e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const cur = Number(obj[key])
  obj[key] = (Number.isFinite(cur) ? cur : 0) + (e.key === 'ArrowUp' ? 1 : -1)
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
// browser can't decode). The waveform/spectrum lanes stay gated on the decoded buffer.
const hasBuffer = computed(() => audio.spectrogramBuffer !== null)

// GT7.2 (GT-D12, thin client): source spectrogram metadata (channel count, duration, ready gate)
// from the BACKEND analysis instead of the decoded client WAV buffer. A lightweight analysis opened
// for the display file yields channelCount + durationSec (GT7.1). The client buffer is kept only as
// a fallback (and, until GT7.3, for the waveform overlay), so this change is non-regressive.
const metaSpec = useSpectrogram({ refetchDebounceMs: 400 })
const backendAnalysis = computed(() => metaSpec.analysis.value)
async function openMetaAnalysis(path: string | null): Promise<void> {
  await metaSpec.close()
  if (path === null || path === '') return
  try {
    await metaSpec.open({ filePath: path, ...spectrogramStore.analysisParams, channel: 0 })
  } catch {
    // WS/analysis error -> fall back to the client buffer metadata
  }
}
// Backend analysis is available -> we can render the stack even without a decoded client buffer.
const hasSpectrogramData = computed(() => hasBuffer.value || backendAnalysis.value !== null)
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

// GT7.2: prefer the backend analysis' channelCount; fall back to the decoded buffer.
const isSpectrogramStereo = computed(
  () => (backendAnalysis.value?.channelCount ?? audio.spectrogramBuffer?.numberOfChannels ?? 1) >= 2,
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

// Uniform gtrack lane height with a single bottom handle (like the spectrogram bottom handle).
let gtrackBottomStartY = 0
let gtrackBottomStartH = 0
function onGtrackBottomPointerDown(ev: PointerEvent): void {
  gtrackBottomStartY = ev.clientY
  gtrackBottomStartH = gtracks.laneHeight.value
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  ev.preventDefault()
}
function onGtrackBottomPointerMove(ev: PointerEvent): void {
  if (gtrackBottomStartY === 0) return
  gtracks.setLaneHeight(gtrackBottomStartH + (ev.clientY - gtrackBottomStartY))
}
function onGtrackBottomPointerUp(): void {
  gtrackBottomStartY = 0
}
// The restore list carries a restore callback so waveform/spectrogram channels (SF-D66) and gtrack
// lanes (GT2.2) share one "hidden tracks" dropdown. Channels are listed only when their KIND is
// shown by the view-mode preset (restoring under a preset-hidden kind wouldn't surface it).
interface HiddenTrackEntry { readonly key: string; readonly label: string; readonly restore: () => void }
const hiddenTrackList = computed<HiddenTrackEntry[]>(() => {
  const count = isSpectrogramStereo.value ? 2 : 1
  const out: HiddenTrackEntry[] = []
  const kinds: ReadonlyArray<{ kind: TrackKind; shown: boolean; name: string }> = [
    { kind: 'waveform', shown: showWaveform.value, name: t('audio.trackKindWaveform') },
    { kind: 'spectrogram', shown: showSpectrogram.value, name: t('audio.trackKindSpectrogram') },
  ]
  for (const { kind, shown, name } of kinds) {
    if (!shown) continue
    for (let ch = 0; ch < count; ch++) {
      if (!isTrackHidden(kind, ch)) continue
      const chLabel = count > 1 ? (ch === 0 ? 'L' : 'R') : ''
      out.push({ key: trackKey(kind, ch), label: chLabel ? `${name} ${chLabel}` : name, restore: () => showTrack(kind, ch) })
    }
  }
  // GT2.2: hidden gtrack lanes (only relevant while a gnaural is open).
  if (audio.displayMode === 'gnaural') {
    for (const lane of gtracks.hiddenLanes.value) {
      out.push({ key: `gtrack:${lane.id}`, label: gtrackLaneLabel(lane), restore: () => gtracks.setLaneHidden(lane.id, false) })
    }
  }
  return out
})

// SF23.3: the view mode drives which layers are shown.
const showWaveform = computed(() => viewMode.value === 'waveform' || viewMode.value === 'both')
const showSpectrogram = computed(() => viewMode.value !== 'waveform')
const waveformOverlay = computed(() => viewMode.value === 'overlay')
const viewModeLabel = computed(() => t(`audio.viewMode_${viewMode.value}`))
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
let wfDividerIndex = -1
let wfDividerStartY = 0
let wfDividerTopStart = 0
let wfDividerBottomStart = 0
function onWaveformDividerPointerDown(aEvent: PointerEvent, aIndex: number): void {
  const hs = waveformTrackHeights.value
  if (aIndex < 0 || aIndex + 1 >= hs.length) return
  wfDividerIndex = aIndex
  wfDividerStartY = aEvent.clientY
  wfDividerTopStart = hs[aIndex]
  wfDividerBottomStart = hs[aIndex + 1]
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}
function onWaveformDividerPointerMove(aEvent: PointerEvent): void {
  if (wfDividerIndex < 0) return
  const total = wfDividerTopStart + wfDividerBottomStart
  let top = wfDividerTopStart + (aEvent.clientY - wfDividerStartY)
  top = Math.max(WAVEFORM_TRACK_HEIGHT_MIN, Math.min(total - WAVEFORM_TRACK_HEIGHT_MIN, top))
  const next = waveformTrackHeights.value.slice()
  next[wfDividerIndex] = Math.round(top)
  next[wfDividerIndex + 1] = Math.round(total - top)
  waveformTrackHeights.value = next
}
function onWaveformDividerPointerUp(aEvent: PointerEvent): void {
  if (wfDividerIndex < 0) return
  wfDividerIndex = -1
  try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
}
let wfBottomResizing = false
let wfBottomStartY = 0
let wfBottomStartHeights: number[] = []
function onWaveformBottomPointerDown(aEvent: PointerEvent): void {
  if (waveformTrackHeights.value.length === 0) return
  wfBottomResizing = true
  wfBottomStartY = aEvent.clientY
  wfBottomStartHeights = waveformTrackHeights.value.slice()
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}
function onWaveformBottomPointerMove(aEvent: PointerEvent): void {
  if (!wfBottomResizing) return
  const minH = Math.min(...wfBottomStartHeights)
  const maxH = Math.max(...wfBottomStartHeights)
  const lo = WAVEFORM_TRACK_HEIGHT_MIN - minH
  const hi = WAVEFORM_TRACK_HEIGHT_MAX - maxH
  const dy = Math.max(lo, Math.min(hi, aEvent.clientY - wfBottomStartY))
  waveformTrackHeights.value = wfBottomStartHeights.map((h) => Math.round(h + dy))
}
function onWaveformBottomPointerUp(aEvent: PointerEvent): void {
  if (!wfBottomResizing) return
  wfBottomResizing = false
  try { (aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId) } catch { /* ignore */ }
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
// GT7.2: duration from the backend analysis, then the buffer, then the gnaural schedule length.
const spectrogramDuration = computed(
  () => backendAnalysis.value?.durationSec || audio.spectrogramBuffer?.duration || gtracks.durationSec.value,
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

// --- Track resize: 2px mutual divider (SF-D19) + uniform bottom handle (SF-D20) ---
let dividerIndex = -1
let dividerStartY = 0
let dividerTopStart = 0
let dividerBottomStart = 0

function onSpectrogramDividerPointerDown(aEvent: PointerEvent, aIndex: number): void {
  const hs = spectrogramTrackHeights.value
  if (aIndex < 0 || aIndex + 1 >= hs.length) return
  dividerIndex = aIndex
  dividerStartY = aEvent.clientY
  dividerTopStart = hs[aIndex]
  dividerBottomStart = hs[aIndex + 1]
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}

function onSpectrogramDividerPointerMove(aEvent: PointerEvent): void {
  if (dividerIndex < 0) return
  const total = dividerTopStart + dividerBottomStart
  // Drag down -> the track above grows, the one below shrinks; combined height is fixed.
  let top = dividerTopStart + (aEvent.clientY - dividerStartY)
  top = Math.max(SPECTROGRAM_TRACK_HEIGHT_MIN, Math.min(total - SPECTROGRAM_TRACK_HEIGHT_MIN, top))
  const next = spectrogramTrackHeights.value.slice()
  next[dividerIndex] = Math.round(top)
  next[dividerIndex + 1] = Math.round(total - top)
  spectrogramTrackHeights.value = next
}

function onSpectrogramDividerPointerUp(aEvent: PointerEvent): void {
  if (dividerIndex < 0) return
  dividerIndex = -1
  try {
    ;(aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId)
  } catch {
    // pointer capture may already be released
  }
}

// SF9.3: the bottom handle (below the last track) resizes ALL tracks by the SAME
// amount (equal delta), unlike the divider which is mutual (SF-D20).
let bottomResizing = false
let bottomStartY = 0
let bottomStartHeights: number[] = []

function onSpectrogramBottomPointerDown(aEvent: PointerEvent): void {
  if (spectrogramTrackHeights.value.length === 0) return
  bottomResizing = true
  bottomStartY = aEvent.clientY
  bottomStartHeights = spectrogramTrackHeights.value.slice()
  ;(aEvent.currentTarget as HTMLElement).setPointerCapture(aEvent.pointerId)
  aEvent.preventDefault()
}

function onSpectrogramBottomPointerMove(aEvent: PointerEvent): void {
  if (!bottomResizing) return
  // Clamp the shared delta so no track leaves [MIN, MAX] — keeps the change equal.
  const minH = Math.min(...bottomStartHeights)
  const maxH = Math.max(...bottomStartHeights)
  const lo = SPECTROGRAM_TRACK_HEIGHT_MIN - minH
  const hi = SPECTROGRAM_TRACK_HEIGHT_MAX - maxH
  const dy = Math.max(lo, Math.min(hi, aEvent.clientY - bottomStartY))
  spectrogramTrackHeights.value = bottomStartHeights.map((h) => Math.round(h + dy))
}

function onSpectrogramBottomPointerUp(aEvent: PointerEvent): void {
  if (!bottomResizing) return
  bottomResizing = false
  try {
    ;(aEvent.currentTarget as HTMLElement).releasePointerCapture(aEvent.pointerId)
  } catch {
    // pointer capture may already be released
  }
}

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
    // Rebuilds the model from the freshly-dumped file (dirty/undo reset to the saved baseline).
    await audio.loadGnauralSchedule(filePath, true)
    if (response.changed) {
      await audio.ensureGnauralSpectrogram(filePath, true)
    }
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

function handleTracksKeyDown(event: KeyboardEvent): void {
  // GT3.9: Escape closes the voice panel first, then the settings overlay.
  if (event.key === 'Escape' && voicesPanelOpen.value) {
    event.preventDefault()
    voicesPanelOpen.value = false
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
const anyOverlayOpen = computed(() => voicesPanelOpen.value || diagnosticsOpen.value || spectrogramSettingsOpen.value || inspectorMode.value !== 'none')
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

onMounted(() => {
  window.addEventListener('keydown', handleTracksKeyDown)
  void openMetaAnalysis(audio.displayFilePath)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleTracksKeyDown)
  window.removeEventListener('resize', measureOverlayFrame)
  window.removeEventListener('scroll', measureOverlayFrame, true)
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
.tracks-panel__gtrack-inline {
  position: relative;
  width: 100%;
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
</style>
