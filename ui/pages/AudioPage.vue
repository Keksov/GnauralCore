<template>
  <q-page class="audio-page" :style-fn="pageStyle">
    <!-- FB4.1 (owner req. 12, FB-D12): the menu bar spans the whole Audio form — above the side
         panels (Presets, and any future panel) AND the content — like a classic app menu bar. -->
    <div class="audio-page__menubar row items-center no-wrap">
      <q-btn-dropdown flat dense no-caps :label="t('audio.menuFile')" class="audio-page__menu-file">
        <q-list dense>
          <q-item clickable v-close-popup @click="openFileDialog">
            <q-item-section avatar>
              <q-icon name="folder_open" />
            </q-item-section>
            <q-item-section>{{ t('audio.menuOpen') }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
    </div>

    <!-- FB4.3 (FB-D13): docked panel + editor reflow. Floating -> teleported to <body> (fixed
         overlay, no ancestor clipping); docked -> a flex sibling of the inner form. -->
    <div class="audio-page__dock-wrap" :class="dockWrapClass">
      <Teleport to="body" :disabled="!fsFloating">
        <FileOpenDialog
          v-if="fsBrowser.open"
          v-model="fsBrowser.open"
          :initial-path="fileDialogInitialPath"
          @open="handleExternalFileOpen"
        />
      </Teleport>

      <div class="audio-page__inner">
      <div v-if="filesPanelOpen" id="audio-page-sidebar" class="audio-page__sidebar">
        <q-card flat bordered class="audio-page__card">
          <q-card-section class="audio-page__sidebar-header">
            <div class="audio-page__sidebar-heading">
              <div class="text-h6">{{ t('audio.presetsTitle') }}</div>
              <div class="text-caption text-grey-7">{{ t('audio.presetsSubtitle') }}</div>
            </div>
            <q-btn
              flat
              round
              dense
              color="primary"
              icon="close"
              :aria-label="t('audio.filesHide')"
              @click="closeFilesPanel"
            />
          </q-card-section>

          <q-separator />

          <q-card-section>
            <q-banner v-if="audio.settings.presetsRoot === ''" dense rounded class="bg-orange-1 text-orange-10">
              {{ t('audio.configureRootHint') }}
            </q-banner>
            <q-banner v-else dense rounded class="bg-grey-2 text-grey-9">
              {{ audio.settings.presetsRoot }}
            </q-banner>
          </q-card-section>

          <q-card-actions align="between">
            <q-btn flat color="primary" icon="refresh" :label="t('audio.refresh')" :loading="audio.presetsLoading" @click="refreshPresets" />
            <!-- GT10.45 (owner req. 2026-07-13): "Edit" menu with Settings (Ctrl+P). -->
            <q-btn-dropdown flat no-caps color="primary" icon="edit" :label="t('audio.editMenu')">
              <q-list>
                <q-item clickable v-close-popup @click="goToSettings">
                  <q-item-section avatar><q-icon name="settings" /></q-item-section>
                  <q-item-section>{{ t('audio.openSettings') }}</q-item-section>
                  <q-item-section side><span class="text-caption text-grey">Ctrl+P</span></q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </q-card-actions>

          <!-- GT10.17 (owner req. 66): audio settings live on the Audio tab now. -->
          <!-- GT10.29 (owner req. 78): title + close (X) and a Close button.
               GT10.45 (owner 2026-07-13): two-pane — subsystem list (left) + its settings (right). -->
          <q-dialog v-model="settingsDialogOpen">
            <q-card class="audio-page__settings-dialog">
              <q-card-section class="row items-center q-py-sm">
                <div class="text-h6">{{ t('audio.openSettings') }}</div>
                <q-space />
                <q-btn flat round dense icon="close" v-close-popup :aria-label="t('audio.close')" />
              </q-card-section>
              <q-separator />
              <div class="audio-page__settings-dialog-body row no-wrap">
                <q-list class="audio-page__settings-nav">
                  <q-item
                    v-for="sub in settingsSubsystems"
                    :key="sub.id"
                    clickable
                    :active="settingsSubsystem === sub.id"
                    active-class="audio-page__settings-nav--active"
                    @click="settingsSubsystem = sub.id"
                  >
                    <q-item-section avatar><q-icon :name="sub.icon" /></q-item-section>
                    <q-item-section>{{ t(sub.labelKey) }}</q-item-section>
                  </q-item>
                </q-list>
                <q-separator vertical />
                <div class="audio-page__settings-content">
                  <GnauralSettingsTab v-if="settingsSubsystem === 'cache'" />
                </div>
              </div>
              <q-separator />
              <q-card-actions align="right">
                <q-btn flat no-caps :label="t('audio.close')" v-close-popup />
              </q-card-actions>
            </q-card>
          </q-dialog>

          <q-separator />

          <q-card-section class="audio-page__tree-section">
            <div v-if="audio.presetsLoading" class="audio-page__empty">
              <q-spinner-hourglass color="primary" size="28px" />
            </div>
            <div v-else-if="audio.presetsTree.length === 0" class="audio-page__empty text-grey-7">
              {{ t('audio.noPresets') }}
            </div>
            <q-tree
              v-else
              :nodes="treeNodes"
              node-key="path"
              label-key="name"
              children-key="children"
              selected-color="primary"
              v-model:expanded="expandedTreePaths"
              v-model:selected="selectedTreePath"
            >
              <template #default-header="treeNode">
                <div
                  class="audio-page__tree-node"
                  @click="handlePresetNodeClick(treeNode.node, $event)"
                >
                  <q-icon
                    :name="treeNode.node.icon"
                    size="18px"
                    class="audio-page__tree-node-icon"
                  />
                  <span class="audio-page__tree-node-label">{{ treeNode.node.name }}</span>
                </div>
              </template>
            </q-tree>
          </q-card-section>
        </q-card>
      </div>

      <div class="audio-page__content">
        <q-card flat bordered class="audio-page__card audio-page__content-card">
          <q-card-section v-if="audio.lastError !== null">
            <q-banner dense rounded class="bg-red-1 text-red-10">
              {{ audio.lastError }}
            </q-banner>
          </q-card-section>

          <div class="audio-page__tabs-bar">
            <q-btn
              flat
              no-caps
              color="primary"
              icon="folder"
              :label="t('audio.filesTab')"
              class="audio-page__files-toggle"
              :class="{ 'audio-page__files-toggle--active': filesPanelOpen }"
              :aria-label="filesPanelOpen ? t('audio.filesHide') : t('audio.filesShow')"
              :aria-expanded="filesPanelOpen"
              aria-controls="audio-page-sidebar"
              @click="toggleFilesPanel"
            />
            <q-tabs
              v-model="activeContentTab"
              align="left"
              active-color="primary"
              indicator-color="primary"
              inline-label
              no-caps
              class="audio-page__tabs"
            >
              <q-tab name="player" icon="volume_up" :label="t('audio.playerTab')" />
              <q-tab name="editor" icon="edit_document" :label="t('audio.editorTab')" />
            </q-tabs>

            <div class="audio-page__meta-strip">
              <!-- SF20: recent-files quick-pick dropdown replaces the static selected-file text. -->
              <div class="audio-page__meta-cell audio-page__meta-cell--file">
                <div class="text-caption text-grey-7 audio-page__meta-label">{{ t('audio.selectedFile') }}</div>
                <q-btn-dropdown
                  dense flat no-caps
                  class="audio-page__file-dropdown"
                  :label="selectedFileLabel"
                  :title="audio.selectedPath ?? ''"
                >
                  <q-list dense class="audio-page__recent-list">
                    <q-item v-if="audio.recentFiles.length === 0" disable>
                      <q-item-section class="text-grey-6">{{ t('audio.recentFilesEmpty') }}</q-item-section>
                    </q-item>
                    <q-item
                      v-for="path in audio.recentFiles"
                      :key="path"
                      clickable
                      v-close-popup
                      :active="path === audio.selectedPath"
                      @click="audio.selectPath(path)"
                    >
                      <q-item-section>
                        <q-item-label lines="1">{{ fileBasename(path) }}</q-item-label>
                        <q-item-label caption lines="1">{{ path }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-btn-dropdown>
              </div>
              <div class="audio-page__meta-cell audio-page__meta-cell--right audio-page__meta-cell--metric">
                <div class="text-caption text-grey-7 audio-page__meta-label">{{ t('audio.position') }}</div>
                <div class="text-body2 audio-page__meta-value">{{ positionLabel }}</div>
              </div>
              <div class="audio-page__meta-cell audio-page__meta-cell--right audio-page__meta-cell--metric">
                <div class="text-caption text-grey-7 audio-page__meta-label">{{ t('audio.duration') }}</div>
                <div class="text-body2 audio-page__meta-value">{{ durationLabel }}</div>
              </div>
            </div>
          </div>

          <q-separator />

          <q-tab-panels v-model="activeContentTab" animated class="audio-page__panels">
            <q-tab-panel name="player" class="audio-page__panel audio-page__panel--player q-pa-none">
              <div class="audio-page__player-body">
                <div class="audio-page__player-view-tabs-bar">
                  <q-tabs
                    v-model="activePlayerViewTab"
                    align="left"
                    active-color="primary"
                    indicator-color="primary"
                    inline-label
                    no-caps
                    class="audio-page__player-view-tabs"
                  >
                    <q-tab name="main" :icon="playerViewMainTabIcon" :label="playerViewMainTabLabel" />
                    <q-tab name="spectrogram" icon="graphic_eq" :label="t('audio.spectrogramTab')" />
                    <!-- GT2.4 (GT-D10): the "Треки" tab hosts ALL new track-stack functionality;
                         the Playback + Spectrogram tabs above stay frozen for debugging. -->
                    <q-tab name="tracks" icon="stacked_line_chart" :label="t('audio.tracksTab')" />
                  </q-tabs>
                </div>

                <q-separator />

                <!-- GT2.4: NOT `animated` — the Спектрограмма and Треки tabs render the SAME heavy
                     stack (each opens spectrogram analyses on the single serial worker). An animated
                     transition keeps BOTH mounted for ~300ms, so two stacks open/close analyses at
                     once and can thrash/crash the worker. Instant swap = the leaving stack fully
                     unmounts (closing its analyses) before the entering one opens. -->
                <q-tab-panels v-model="activePlayerViewTab" class="audio-page__player-view-panels">
                  <q-tab-panel name="main" class="audio-page__panel audio-page__player-view-panel q-pa-none">
                    <div
                      class="audio-page__output-section audio-page__output-section--main"
                      :class="{ 'audio-page__output-section--schedule': showEmbeddedScheduleView }"
                    >
                      <div v-if="showStandalonePlayerControls" class="audio-page__player-toolbar">
                        <gnaural-transport-controls
                          class="audio-page__player-controls"
                          :start-stop-icon="startStopButtonIcon"
                          :start-stop-label="startStopButtonLabel"
                          :start-stop-color="startStopButtonColor"
                          :start-stop-flat="startStopButtonFlat"
                          :start-stop-disabled="startStopDisabled"
                          :pause-resume-icon="pauseResumeButtonIcon"
                          :pause-resume-label="pauseResumeButtonLabel"
                          :pause-resume-disabled="pauseResumeDisabled"
                          :show-export="canExportCurrentFile"
                          :export-disabled="exportingFormat !== null"
                          :export-loading="exportingFormat !== null"
                          @start-stop="handleStartStop"
                          @pause-resume="handlePauseResume"
                          @export="downloadSelectedAudio"
                        />
                      </div>

                      <template v-if="audio.displayMode !== 'gnaural'">
                        <div class="audio-page__empty text-grey-7">
                          {{ t('audio.spectrogramTabHint') }}
                        </div>
                      </template>
                      <template v-else>
                        <div v-if="audio.gnauralScheduleLoading" class="audio-page__empty text-grey-7">
                          {{ t('audio.scheduleLoading') }}
                        </div>
                        <q-banner v-else-if="audio.gnauralScheduleError !== null" dense rounded class="bg-orange-1 text-orange-10 q-mb-md">
                          {{ audio.gnauralScheduleError }}
                        </q-banner>
                        <div v-else-if="audio.gnauralSchedule === null" class="audio-page__empty text-grey-7">
                          {{ t('audio.noSchedule') }}
                        </div>
                        <gnaural-schedule-view
                          ref="scheduleViewRef"
                          v-else
                          class="audio-page__schedule-view"
                          :schedule="audio.gnauralSchedule"
                          :file-path="audio.displayFilePath"
                          :position-sec="displayedPositionSec"
                          :transport-state="audio.transportState"
                          :track-state-busy="trackStateBusy"
                          :can-seek="canSeek"
                          ui-state-scope="audio-page"
                          @seek="handleSeek"
                          @patch-voice-state="handleScheduleVoiceStatePatch"
                          @patch-voice-state-batch="handleScheduleVoiceStateBatch"
                        >
                          <template #transportControls>
                            <gnaural-transport-controls
                              class="audio-page__player-controls"
                              :start-stop-icon="startStopButtonIcon"
                              :start-stop-label="startStopButtonLabel"
                              :start-stop-color="startStopButtonColor"
                              :start-stop-flat="startStopButtonFlat"
                              :start-stop-disabled="startStopDisabled"
                              :pause-resume-icon="pauseResumeButtonIcon"
                              :pause-resume-label="pauseResumeButtonLabel"
                              :pause-resume-disabled="pauseResumeDisabled"
                              :show-export="canExportCurrentFile"
                              :export-disabled="exportingFormat !== null"
                              :export-loading="exportingFormat !== null"
                              @start-stop="handleStartStop"
                              @pause-resume="handlePauseResume"
                              @export="downloadSelectedAudio"
                            />
                          </template>
                        </gnaural-schedule-view>
                      </template>
                    </div>
                  </q-tab-panel>

                  <q-tab-panel name="spectrogram" class="audio-page__panel audio-page__player-view-panel q-pa-none">
                    <div class="audio-page__output-section audio-page__output-section--spectrogram">
                      <div class="audio-page__player-toolbar">
                        <gnaural-transport-controls
                          class="audio-page__player-controls"
                          :start-stop-icon="startStopButtonIcon"
                          :start-stop-label="startStopButtonLabel"
                          :start-stop-color="startStopButtonColor"
                          :start-stop-flat="startStopButtonFlat"
                          :start-stop-disabled="startStopDisabled"
                          :pause-resume-icon="pauseResumeButtonIcon"
                          :pause-resume-label="pauseResumeButtonLabel"
                          :pause-resume-disabled="pauseResumeDisabled"
                          :show-export="canExportCurrentFile"
                          :export-disabled="exportingFormat !== null"
                          :export-loading="exportingFormat !== null"
                          @start-stop="handleStartStop"
                          @pause-resume="handlePauseResume"
                          @export="downloadSelectedAudio"
                        />
                      </div>

                      <q-banner v-if="audio.spectrogramError !== null" dense rounded class="bg-orange-1 text-orange-10 q-mb-md">
                        {{ audio.spectrogramError }}
                      </q-banner>
                      <div v-else-if="audio.spectrogramBuffer === null && !audio.spectrogramLoading" class="audio-page__empty text-grey-7">
                        {{ noSpectrogramLabel }}
                      </div>
                      <div v-else-if="audio.spectrogramBuffer !== null" class="row no-wrap items-start" style="gap: 16px;">
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
                                  @click="showTrack(h.kind, h.channel)"
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
                            <!-- SF27: waveform colour/scale moved to a per-track gear (see each track). -->
                            <q-btn
                              dense flat round size="sm"
                              icon="tune"
                              :color="spectrogramSettingsOpen ? 'primary' : undefined"
                              :aria-label="t('audio.spectrogramSettingsTitle')"
                              aria-controls="spectrogram-settings-panel"
                              :aria-expanded="spectrogramSettingsOpen"
                              @click="toggleSpectrogramSettings"
                            />
                          </div>
                          <!-- SF22: waveform tracks above the spectrogram (Audacity-style), sharing the view.
                               SF25: same resizers as the spectrogram (mutual divider + uniform bottom handle). -->
                          <div v-if="showWaveform" class="audio-page__waveform-stack">
                            <template v-for="(wtrack, wIndex) in waveformTracks" :key="wtrack.key">
                              <waveform-view
                                :ref="(el) => setPrimaryWaveformRef(el, wIndex)"
                                :file-path="audio.displayFilePath"
                                :analysis="spectrogramAnalysisForChannel(wtrack.channel)"
                                :channel="wtrack.channel"
                                :label="wtrack.label"
                                :scale="wfScale(wtrack.channel)"
                                :color="wfColor(wtrack.channel)"
                                :playhead-sec="displayedPositionSec"
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
                          <div v-if="showSpectrogram" class="audio-page__spectrogram-stack">
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
                              :playhead-sec="displayedPositionSec"
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
                          <div v-if="showSpectrogram" class="audio-page__minimap-wrap">
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
                          id="spectrogram-settings-panel"
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
                  </q-tab-panel>

                  <!-- GT2.4 (GT-D10): the "Треки" tab — the whole new track stack lives in
                       TracksPanel.vue (its own zoom/selection state + storage keys). Transport
                       stays here (same slot pattern as GnauralScheduleView). -->
                  <q-tab-panel name="tracks" class="audio-page__panel audio-page__player-view-panel q-pa-none">
                    <tracks-panel
                      :position-sec="displayedPositionSec"
                      :can-seek="canSeek"
                      @seek="handleSeek"
                      @toggle-play="handleTracksTogglePlay"
                    >
                      <template #toolbar>
                        <gnaural-transport-controls
                          class="audio-page__player-controls"
                          :start-stop-icon="startStopButtonIcon"
                          :start-stop-label="startStopButtonLabel"
                          :start-stop-color="startStopButtonColor"
                          :start-stop-flat="startStopButtonFlat"
                          :start-stop-disabled="startStopDisabled"
                          :pause-resume-icon="pauseResumeButtonIcon"
                          :pause-resume-label="pauseResumeButtonLabel"
                          :pause-resume-disabled="pauseResumeDisabled"
                          :show-export="canExportCurrentFile"
                          :export-disabled="exportingFormat !== null"
                          :export-loading="exportingFormat !== null"
                          @start-stop="handleStartStop"
                          @pause-resume="handlePauseResume"
                          @export="downloadSelectedAudio"
                        />
                      </template>
                    </tracks-panel>
                  </q-tab-panel>
                </q-tab-panels>
              </div>

            </q-tab-panel>

            <q-tab-panel name="editor" class="audio-page__panel q-pa-none">
              <gnaural-editor-panel
                ref="editorPanelRef"
                :selected-path="audio.selectedPath"
                :selected-file-kind="audio.selectedFileKind"
                :active-file-path="audio.activeFilePath"
                :active-playback-mode="audio.activePlaybackMode"
                :transport-state="audio.transportState"
                :render-state="audio.renderState"
              />
            </q-tab-panel>
          </q-tab-panels>
        </q-card>
      </div>
      </div>
    </div>

    <!-- SF7.1: small non-blocking load-progress dialog over the tracks screen. -->
    <q-dialog :model-value="audio.spectrogramLoading" persistent no-focus>
      <q-card class="audio-page__load-dialog">
        <q-card-section class="row items-center no-wrap q-gutter-md">
          <q-spinner-hourglass color="primary" size="28px" />
          <div class="text-body2">{{ spectrogramLoadingLabel }}</div>
        </q-card-section>
        <q-linear-progress indeterminate color="primary" />
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, type AsyncComponentLoader, type Component } from 'vue'
import SpectrogramMinimap from '../components/SpectrogramMinimap.vue'
import SpectrogramView from '../components/SpectrogramView.vue'
import WaveformView from '../components/WaveformView.vue'
import {
  fullWindow,
  isFullWindow,
  zoomWindow,
  type SpectrogramSelection,
  type TimeWindow,
} from '../composables/spectrogram-viewport'
import { QSpinnerHourglass, useQuasar, type QTreeNode } from 'quasar'
import type { AudioFileKind, PresetTreeNode, SpectrogramAnalysisParams } from '@protocol'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { audioApi } from '../audio-api'
import GnauralSettingsTab from '../settings/GnauralSettingsTab.vue'
import { useAudioTransport } from '../composables/use-audio-transport'
import { useWsService } from '../composables/use-ws'
import GnauralTransportControls from '../components/GnauralTransportControls.vue'
import FileOpenDialog from '../components/FileOpenDialog.vue'
import { useAudioStore } from '../stores/audio'
import { useFsBrowserStore } from '../stores/fs-browser'
import { useSpectrogramStore } from '../stores/spectrogram'

const STORAGE_AUDIO_EXPANDED_PATHS = 'mindwave-audio-expanded-paths'
const STORAGE_AUDIO_FILES_PANEL_OPEN = 'mindwave-audio-files-panel-open'
// SF9.2: per-track heights (array) — Audacity-style independent track heights,
// resized by a 2px mutual divider (SF-D19) and a uniform bottom handle (SF-D20).
const STORAGE_AUDIO_SPECTROGRAM_TRACK_HEIGHTS = 'mindwave-audio-spectrogram-track-heights'
// Audacity-like default spectrogram track height (per channel), in px (SF5.1).
const SPECTROGRAM_TRACK_HEIGHT_DEFAULT = 260
const SPECTROGRAM_TRACK_HEIGHT_MIN = 120
const SPECTROGRAM_TRACK_HEIGHT_MAX = 1200
type ExportAudioFileKind = Exclude<AudioFileKind, 'gnaural'>

interface GnauralEditorPanelHandle {
  prepareForPathChange(aNextPath: string | null, aNextFileKind: AudioFileKind | null): Promise<boolean>
  prepareForExternalMutation(aFilePath: string): Promise<boolean>
  reloadCurrentDocumentFromDisk(aFilePath: string): Promise<void>
}

interface GnauralScheduleViewHandle {
  resetView(): void
}

interface ScheduleVoiceStatePatch {
  readonly voiceId: number
  readonly hidden?: boolean
  readonly muted?: boolean
  readonly color?: string
}

const AsyncAudioPanelLoading = defineComponent({
  name: 'AsyncAudioPanelLoading',
  setup() {
    return () => h('div', { class: 'audio-page__async-placeholder' }, [
      h(QSpinnerHourglass, { color: 'primary', size: '28px' }),
    ])
  },
})

function createAsyncAudioPanel(loader: AsyncComponentLoader<Component>) {
  return defineAsyncComponent({
    loader,
    delay: 120,
    loadingComponent: AsyncAudioPanelLoading,
  })
}

const GnauralEditorPanel = createAsyncAudioPanel(() => import('../components/GnauralEditorPanel.vue'))
const GnauralScheduleView = createAsyncAudioPanel(() => import('../components/GnauralScheduleView.vue'))
const SpectrogramSettingsPanel = createAsyncAudioPanel(() => import('../components/SpectrogramSettingsPanel.vue'))
// GT2.4 (GT-D10): the "Треки" tab content — all new track-stack functionality lives there.
const TracksPanel = createAsyncAudioPanel(() => import('../components/TracksPanel.vue'))

const loadStoredExpandedPaths = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_EXPANDED_PATHS)
    if (raw === null) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && value !== ''))]
  } catch {
    return []
  }
}

function loadStoredFilesPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_FILES_PANEL_OPEN)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

function clampTrackHeight(aValue: number): number {
  return Math.max(SPECTROGRAM_TRACK_HEIGHT_MIN, Math.min(SPECTROGRAM_TRACK_HEIGHT_MAX, Math.round(aValue)))
}

function loadStoredSpectrogramTrackHeights(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_SPECTROGRAM_TRACK_HEIGHTS)
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
    localStorage.setItem(STORAGE_AUDIO_SPECTROGRAM_TRACK_HEIGHTS, JSON.stringify(aHeights))
  } catch {
    // Ignore storage failures and keep the in-memory heights working.
  }
}

const { t } = useI18n()
const $q = useQuasar()
const router = useRouter()
const audio = useAudioStore()
const spectrogramStore = useSpectrogramStore()
const activeContentTab = ref<'player' | 'editor'>('player')
const filesPanelOpen = ref(loadStoredFilesPanelOpen())
// SF9.2: independent per-track heights; length is kept in sync with the track count
// (1 mono / 2 stereo) by a watch below. Resized by the divider + bottom handle.
const spectrogramTrackHeights = ref<number[]>(loadStoredSpectrogramTrackHeights())
// SF8.1: stacked spectrogram tracks (stereo L/R) share one time window + area
// selection so they zoom/pan/select together; reset per file so a new file starts full.
const spectrogramShared = {
  view: ref<TimeWindow | null>(null),
  selection: ref<SpectrogramSelection | null>(null),
  commitSeq: ref(0),
  // SF15.1: shared frequency window (bin-axis fractions) so stacked tracks freq-zoom together.
  freqView: ref<{ lo: number; hi: number } | null>(null),
}
provide('spectrogramShared', spectrogramShared)
const activePlayerViewTab = ref<'main' | 'spectrogram' | 'tracks'>('main')
const expandedTreePaths = ref<string[]>(loadStoredExpandedPaths())
const treeSelectionAutoPlayRequested = ref(false)
const editorPanelRef = ref<GnauralEditorPanelHandle | null>(null)
const scheduleViewRef = ref<GnauralScheduleViewHandle | null>(null)
const trackStateBusy = ref(false)
const exportingFormat = ref<ExportAudioFileKind | null>(null)
const {
  canStart,
  canSeek,
  startStopButtonLabel,
  startStopButtonIcon,
  startStopButtonColor,
  startStopButtonFlat,
  startStopDisabled,
  pauseResumeButtonLabel,
  pauseResumeButtonIcon,
  pauseResumeDisabled,
  displayedPositionSec,
  positionLabel,
  durationLabel,
  sendAudioMessage,
  pausePlayback,
  resumePlayback,
  stopPlayback,
  handlePauseResume,
  handleSeek,
} = useAudioTransport()

const wsService = useWsService()

let selectionChangeToken = 0

// FB3.1/FB3.2 (file-browser): the classic File -> Open menu opens the universal dialog; a chosen file
// (which lives outside presetsTree) is fed into the editor's open path via audio.selectExternalPath,
// reusing the unsaved-changes guard + view switching from the tree-selection flow.
// FB5.2 (FB-D19): the open/closed flag lives in the fs-browser store (persisted), so a docked or
// floating panel that was open at shutdown reappears at its saved place on the next launch.
const fileDialogInitialPath = computed<string | undefined>(() => {
  const root = audio.settings.presetsRoot
  return root !== '' ? root : undefined
})

// FB4.3 (FB-D13): the open dialog is a dockable panel. When floating it teleports to <body>; when
// docked it is a flex sibling of the page inner, and the form reflows around it.
const fsBrowser = useFsBrowserStore()
const fsFloating = computed<boolean>(() => fsBrowser.windowMode === 'floating')
const dockWrapClass = computed<string>(() =>
  fsBrowser.windowMode === 'top' || fsBrowser.windowMode === 'bottom'
    ? 'audio-page__dock-wrap--col'
    : 'audio-page__dock-wrap--row',
)

function openFileDialog(): void {
  fsBrowser.open = true
}

async function handleExternalFileOpen(path: string, fileKind: AudioFileKind): Promise<void> {
  const selectionToken = selectionChangeToken + 1
  selectionChangeToken = selectionToken

  if (editorPanelRef.value !== null) {
    const canProceed = await editorPanelRef.value.prepareForPathChange(path, fileKind)
    if (selectionChangeToken !== selectionToken || !canProceed) {
      return
    }
  }

  if (audio.canStop) {
    stopPlayback()
  }

  audio.selectExternalPath(path, fileKind)
  syncRestoredTreeState()

  if (isLocalAudioFileKind(fileKind)) {
    activeContentTab.value = 'player'
    if (activePlayerViewTab.value !== 'tracks') {
      activePlayerViewTab.value = 'spectrogram'
    }
    void audio.ensureLocalAudioReady(path, fileKind)
  }
}

function isLocalAudioFileKind(fileKind: AudioFileKind | null): fileKind is Exclude<AudioFileKind, 'gnaural'> {
  return fileKind === 'wav' || fileKind === 'flac'
}

function getTreeNodeIcon(node: PresetTreeNode): string {
  if (node.isDir) {
    return 'folder'
  }

  return node.fileKind === 'gnaural' ? 'graphic_eq' : 'audiotrack'
}

function toTreeNodes(nodes: readonly PresetTreeNode[]): QTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    icon: getTreeNodeIcon(node),
    selectable: !node.isDir,
    children: node.children !== undefined ? toTreeNodes(node.children) : undefined,
  }))
}

function findPresetNodeByPath(nodes: readonly PresetTreeNode[], path: string): PresetTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node
    }

    if (node.children !== undefined) {
      const child = findPresetNodeByPath(node.children, path)
      if (child !== null) {
        return child
      }
    }
  }

  return null
}

const treeNodes = computed(() => {
  return toTreeNodes(audio.presetsTree)
})

watch(expandedTreePaths, (value) => {
  try {
    localStorage.setItem(STORAGE_AUDIO_EXPANDED_PATHS, JSON.stringify(value))
  } catch {
    // Ignore storage failures and keep the in-memory tree state working.
  }
}, { deep: true, immediate: true })

watch(filesPanelOpen, (value) => {
  try {
    localStorage.setItem(STORAGE_AUDIO_FILES_PANEL_OPEN, value ? 'true' : 'false')
  } catch {
    // Ignore storage failures and keep the in-memory panel state working.
  }
})

watch(spectrogramTrackHeights, (value) => {
  persistSpectrogramTrackHeights(value)
}, { deep: true })

function toggleFilesPanel(): void {
  filesPanelOpen.value = !filesPanelOpen.value
}

function closeFilesPanel(): void {
  filesPanelOpen.value = false
}

// Opening the Spectrogram view for a selected local audio file that isn't decoded
// yet prepares it (same non-playback decode as selecting from the tree), instead of
// leaving the stale "start playback" message with nothing happening.
// GT2.4: the Треки tab shows the same stack, so it needs the same preparation.
function ensureSpectrogramPrepared(): void {
  if (activePlayerViewTab.value !== 'spectrogram' && activePlayerViewTab.value !== 'tracks') {
    return
  }

  // GT2.6: on the Треки tab, auto-render a gnaural to WAV for its spectrum (no playback needed).
  // The frozen Спектрограмма tab keeps its "press play to render" behaviour.
  if (activePlayerViewTab.value === 'tracks' && audio.displayMode === 'gnaural' && audio.displayFilePath !== null) {
    void audio.ensureGnauralSpectrogram(audio.displayFilePath)
    // GT2.2 fix: the gtrack lanes come from the schedule DUMP, which is loaded on file selection —
    // not on tab activation. Ensure it's loaded here too so an already-selected gnaural shows its
    // gtrack curves when the Треки tab is opened (idempotent — no-op if already cached).
    void audio.loadGnauralSchedule(audio.displayFilePath)
    return
  }

  const path = audio.selectedPath
  const kind = audio.selectedFileKind
  if (path === null || !isLocalAudioFileKind(kind)) {
    return
  }

  if (audio.spectrogramBuffer !== null || audio.spectrogramLoading) {
    return
  }

  void audio.ensureLocalAudioReady(path, kind)
}

function collectDirectoryPaths(nodes: readonly PresetTreeNode[], result = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (!node.isDir) {
      continue
    }

    result.add(node.path)

    if (node.children !== undefined) {
      collectDirectoryPaths(node.children, result)
    }
  }

  return result
}

function findAncestorDirectoryPaths(
  nodes: readonly PresetTreeNode[],
  targetPath: string,
  parents: readonly string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return [...parents]
    }

    if (node.children === undefined) {
      continue
    }

    const nextParents = node.isDir ? [...parents, node.path] : parents
    const childResult = findAncestorDirectoryPaths(node.children, targetPath, nextParents)
    if (childResult !== null) {
      return childResult
    }
  }

  return null
}

function syncRestoredTreeState(): void {
  const availableDirectoryPaths = collectDirectoryPaths(audio.presetsTree)
  const nextExpandedPaths = expandedTreePaths.value.filter((path, index, paths) => {
    return availableDirectoryPaths.has(path) && paths.indexOf(path) === index
  })

  if (audio.selectedPath !== null) {
    const ancestorPaths = findAncestorDirectoryPaths(audio.presetsTree, audio.selectedPath) ?? []
    for (const path of ancestorPaths) {
      if (!nextExpandedPaths.includes(path)) {
        nextExpandedPaths.push(path)
      }
    }
  }

  expandedTreePaths.value = nextExpandedPaths
}

const selectedTreePath = computed<string | null>({
  get() {
    return audio.selectedPath
  },
  set(path) {
    void handleSelectedPathChange(path ?? null)
  },
})

// SF20: toolbar quick-pick — basename for the dropdown label/items, full path in the caption.
function fileBasename(aPath: string): string {
  return aPath.split(/[\\/]/u).pop() ?? aPath
}
const selectedFileLabel = computed(() =>
  audio.selectedPath !== null ? fileBasename(audio.selectedPath) : t('audio.noFileSelected'),
)

function buildExportFileName(filePath: string, format: ExportAudioFileKind): string {
  const sourceName = filePath.split(/[\\/]/).pop() ?? filePath
  const sourceExt = sourceName.match(/\.[^.]+$/u)?.[0] ?? ''
  return `${sourceName.slice(0, Math.max(0, sourceName.length - sourceExt.length))}.${format}`
}

const canExportCurrentFile = computed(() => {
  return audio.selectedPath !== null && audio.selectedFileKind === 'gnaural'
})

const showStandalonePlayerControls = computed(() => {
  if (audio.displayMode !== 'gnaural') {
    return true
  }

  return audio.gnauralScheduleLoading || audio.gnauralScheduleError !== null || audio.gnauralSchedule === null
})

const playerViewMainTabLabel = computed(() => {
  return audio.displayMode === 'gnaural' ? t('audio.scheduleTab') : t('audio.playbackTab')
})

const playerViewMainTabIcon = computed(() => {
  return audio.displayMode === 'gnaural' ? 'view_stream' : 'volume_up'
})

const spectrogramLoadingLabel = computed(() => {
  return audio.displayMode === 'gnaural' ? t('audio.gnauralSpectrogramLoading') : t('audio.spectrogramLoading')
})

const noSpectrogramLabel = computed(() => {
  return audio.displayMode === 'gnaural' ? t('audio.noGnauralSpectrogram') : t('audio.noSpectrogram')
})

const isSpectrogramStereo = computed(() => (audio.spectrogramBuffer?.numberOfChannels ?? 1) >= 2)

// SF22 + SF23: audio view prefs — Audacity-style view mode + waveform scale/colour/opacity.
type AudioViewMode = 'waveform' | 'spectrogram' | 'both' | 'overlay'
const AUDIO_VIEW_MODES: readonly AudioViewMode[] = ['both', 'overlay', 'spectrogram', 'waveform']
const STORAGE_AUDIO_WAVEFORM = 'mindwave-audio-waveform'
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
    const raw = localStorage.getItem(STORAGE_AUDIO_WAVEFORM)
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
const STORAGE_AUDIO_TRACK_LAYOUT = 'mindwave-audio-track-layout'
function loadTrackLayout(): { order?: Record<string, unknown>; hidden?: unknown } {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_TRACK_LAYOUT)
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
      STORAGE_AUDIO_TRACK_LAYOUT,
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
// The restore strip lists hidden tracks whose KIND is currently shown by the view-mode preset
// (restoring a track under a preset-hidden kind wouldn't surface it).
interface HiddenTrackEntry { readonly key: string; readonly kind: TrackKind; readonly channel: number; readonly label: string }
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
      out.push({ key: trackKey(kind, ch), kind, channel: ch, label: chLabel ? `${name} ${chLabel}` : name })
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
      STORAGE_AUDIO_WAVEFORM,
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
const STORAGE_AUDIO_WAVEFORM_TRACK_HEIGHTS = 'mindwave-audio-waveform-track-heights'
function clampWaveformHeight(aValue: number): number {
  return Math.max(WAVEFORM_TRACK_HEIGHT_MIN, Math.min(WAVEFORM_TRACK_HEIGHT_MAX, Math.round(aValue)))
}
function loadStoredWaveformTrackHeights(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIO_WAVEFORM_TRACK_HEIGHTS)
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
  try { localStorage.setItem(STORAGE_AUDIO_WAVEFORM_TRACK_HEIGHTS, JSON.stringify(v)) } catch { /* ignore */ }
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
const spectrogramDuration = computed(() => audio.spectrogramBuffer?.duration ?? 0)

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

const showEmbeddedScheduleView = computed(() => {
  return audio.displayMode === 'gnaural'
    && !audio.gnauralScheduleLoading
    && audio.gnauralScheduleError === null
    && audio.gnauralSchedule !== null
})

function pageStyle(offset: number, height: number) {
  const pageHeight = Math.max(0, height - offset)

  return {
    height: `${pageHeight}px`,
    minHeight: `${pageHeight}px`,
  }
}

async function refreshPresets() {
  await audio.refreshPresets()
  syncRestoredTreeState()
}

function handlePresetNodeClick(node: PresetTreeNode, event: MouseEvent): void {
  if (node.isDir) {
    treeSelectionAutoPlayRequested.value = false
    return
  }

  const shouldAutoPlay = event.ctrlKey
  treeSelectionAutoPlayRequested.value = shouldAutoPlay

  if (shouldAutoPlay && audio.selectedPath === node.path && audio.canStart) {
    startPlayback()
  }
}

async function handleSelectedPathChange(path: string | null): Promise<void> {
  const shouldAutoPlay = treeSelectionAutoPlayRequested.value
  treeSelectionAutoPlayRequested.value = false
  const previousSelectedPath = audio.selectedPath
  if (path === previousSelectedPath) {
    return
  }

  const nextFileKind = path === null ? null : findPresetNodeByPath(audio.presetsTree, path)?.fileKind ?? null
  const selectionToken = selectionChangeToken + 1
  selectionChangeToken = selectionToken

  if (editorPanelRef.value !== null) {
    const canProceed = await editorPanelRef.value.prepareForPathChange(path, nextFileKind)
    if (selectionChangeToken !== selectionToken || !canProceed) {
      return
    }
  }

  if (path !== null && shouldAutoPlay === false && audio.canStop) {
    stopPlayback()
  }

  audio.selectPath(path)
  syncRestoredTreeState()

  // Selecting a local audio file (wav/flac) shows its spectrum right away: switch
  // to the player's spectrogram view and decode the file without waiting for playback.
  if (path !== null && isLocalAudioFileKind(nextFileKind)) {
    activeContentTab.value = 'player'
    // GT2.4: if the user is on the Треки tab, stay there (it shows the same stack).
    if (activePlayerViewTab.value !== 'tracks') {
      activePlayerViewTab.value = 'spectrogram'
    }
    if (!shouldAutoPlay) {
      void audio.ensureLocalAudioReady(path, nextFileKind)
    }
  }

  if (path === null || !audio.canStart || shouldAutoPlay === false) {
    return
  }

  startPlayback()
}

function shouldIgnorePlayerHotkey(event: KeyboardEvent): boolean {
  if (activeContentTab.value !== 'player') {
    return true
  }

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

// GT2.4: Space from the Треки tab (TracksPanel owns its hotkeys; transport lives here).
function handleTracksTogglePlay(): void {
  if (audio.canPause || audio.canResume) {
    handlePauseResume()
  } else if (canStart.value) {
    startPlayback()
  }
}

function handlePlayerKeyDown(event: KeyboardEvent): void {
  // GT10.45 (owner 2026-07-13): Ctrl/Cmd+P opens the settings dialog (Edit menu) on ANY tab —
  // handled before the tracks-tab early return, and preventDefault overrides the browser's Print.
  if ((event.ctrlKey || event.metaKey) && (event.key === 'p' || event.key === 'P')) {
    event.preventDefault()
    goToSettings()
    return
  }
  // GT2.4 (GT-D10): while the Треки tab is active, TracksPanel owns the player hotkeys
  // (its own window listener); skip entirely so the two handlers never double-act.
  if (activePlayerViewTab.value === 'tracks') {
    return
  }
  // SF3.1: Escape closes the spectrogram settings overlay (before other hotkey guards).
  if (event.key === 'Escape' && spectrogramSettingsOpen.value) {
    event.preventDefault()
    closeSpectrogramSettings()
    return
  }
  if (shouldIgnorePlayerHotkey(event)) {
    return
  }

  // SF21: when the spectrogram (track editor) view is active, route navigation keys to it
  // even if the canvas isn't focused — the window is treated as the track editor's.
  if (
    activePlayerViewTab.value === 'spectrogram' &&
    trackEditorNav.value !== null &&
    SPECTROGRAM_NAV_KEYS.has(event.key)
  ) {
    // SF23.1: preventDefault FIRST so Alt+Left/Right don't trigger the browser's history
    // back/forward (hash router) before the pan runs.
    event.preventDefault()
    trackEditorNav.value.handleNavKey(event)
    return
  }

  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    if (audio.canPause || audio.canResume) {
      handlePauseResume()
    } else if (canStart.value) {
      startPlayback()
    }
    return
  }

  if (event.key === 'Home') {
    event.preventDefault()
    scheduleViewRef.value?.resetView()
    handleSeek(0)
  }
}

async function applyScheduleVoiceStatePatches(aPatches: readonly ScheduleVoiceStatePatch[]): Promise<void> {
  const filePath = audio.displayFilePath
  if (trackStateBusy.value || audio.displayMode !== 'gnaural' || filePath === null) {
    return
  }

  const normalizedPatches = aPatches.filter((patch) => {
    return patch.hidden !== undefined || patch.muted !== undefined || patch.color !== undefined
  })
  if (normalizedPatches.length === 0) {
    return
  }

  if (editorPanelRef.value !== null) {
    const canProceed = await editorPanelRef.value.prepareForExternalMutation(filePath)
    if (!canProceed) {
      return
    }
  }

  trackStateBusy.value = true
  let shouldReload = false

  try {
    if (normalizedPatches.length === 1) {
      const patch = normalizedPatches[0]
      await audioApi.patchScheduleVoiceState({
        path: filePath,
        voiceId: patch.voiceId,
        hidden: patch.hidden,
        muted: patch.muted,
        color: patch.color,
      })
      shouldReload = true
    } else {
      await audioApi.patchScheduleVoiceStates(filePath, normalizedPatches)
      shouldReload = true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('audio.scheduleTrackPatchFailed')
    audio.setClientError(message)
    $q.notify({ type: 'negative', message })
  } finally {
    if (shouldReload) {
      await audio.loadGnauralSchedule(filePath, true)
      await editorPanelRef.value?.reloadCurrentDocumentFromDisk(filePath)
    }

    trackStateBusy.value = false
  }
}

async function downloadSelectedAudio(format: ExportAudioFileKind): Promise<void> {
  const filePath = audio.selectedPath
  if (filePath === null || audio.selectedFileKind !== 'gnaural' || exportingFormat.value !== null) {
    return
  }

  if (editorPanelRef.value !== null) {
    const canProceed = await editorPanelRef.value.prepareForExternalMutation(filePath)
    if (!canProceed) {
      return
    }
  }

  exportingFormat.value = format

  try {
    const blob = await audioApi.fetchAudioFileBlob(filePath, undefined, { format })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = buildExportFileName(filePath, format)
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : t('audio.exportFailed')
    audio.setClientError(message)
    $q.notify({ type: 'negative', message })
  } finally {
    exportingFormat.value = null
  }
}

async function handleScheduleVoiceStatePatch(aPatch: ScheduleVoiceStatePatch): Promise<void> {
  await applyScheduleVoiceStatePatches([aPatch])
}

async function handleScheduleVoiceStateBatch(aPatches: readonly ScheduleVoiceStatePatch[]): Promise<void> {
  await applyScheduleVoiceStatePatches(aPatches)
}

function handleStartStop() {
  if (audio.canStop) {
    stopPlayback()
    return
  }

  startPlayback()
}

function startPlayback() {
  if (audio.selectedPath === null) {
    return
  }

  if (isLocalAudioFileKind(audio.selectedFileKind)) {
    if (audio.remoteTransportState !== 'idle') {
      audio.queueLocalStartAfterRemoteStop(audio.selectedPath)
      sendAudioMessage({ type: 'audio_stop' }, t('audio.wsSendFailed'))
      return
    }

    void audio.startLocalPlayback(audio.selectedPath, audio.selectedFileKind)
    return
  }

  audio.cancelPendingLocalStart()
  audio.stopLocalPlayback()
  sendAudioMessage({ type: 'audio_start', filePath: audio.selectedPath }, t('audio.wsSendFailed'))
}

// GT10.17 (owner req. 66): audio settings open right here (a dialog on the Audio tab) instead of
// navigating to the general Settings page (the audio tab was removed from there).
const settingsDialogOpen = ref(false)
// GT10.45 (owner 2026-07-13): settings dialog is two-pane — a subsystem list on the left drives the
// content on the right. Only "Cache" for now; the list is set up to grow.
const settingsSubsystems = [{ id: 'cache' as const, icon: 'storage', labelKey: 'audio.settingsSubsystemCache' }]
const settingsSubsystem = ref<'cache'>('cache')
function goToSettings() {
  settingsDialogOpen.value = true
}

onMounted(async () => {
  await audio.loadSettings()
  await refreshPresets()
  await nextTick()
})

onMounted(() => {
  window.addEventListener('keydown', handlePlayerKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePlayerKeyDown)
  wsService.send({ type: 'audio_subscribe_schedule', filePath: null })
})

watch(() => audio.selectedFileKind === 'gnaural' ? audio.selectedPath : null, (gnauralPath, previousGnauralPath) => {
  if (gnauralPath === previousGnauralPath) return
  wsService.send({ type: 'audio_subscribe_schedule', filePath: gnauralPath })
})

watch(() => wsService.connectionState.value, (state) => {
  if (state !== 'connected') return
  wsService.send({ type: 'audio_subscribe_schedule', filePath: audio.selectedFileKind === 'gnaural' ? audio.selectedPath : null })
}, { immediate: true })

watch(() => audio.displayMode, (displayMode, previousDisplayMode) => {
  if (displayMode === previousDisplayMode) {
    return
  }

  // GT2.4: the Треки tab handles every file kind (audio + gnaural), so keep the user on it
  // instead of yanking them to Воспроизведение/Спектрограмма on a selection change.
  if (activePlayerViewTab.value === 'tracks') {
    return
  }

  activePlayerViewTab.value = isLocalAudioFileKind(displayMode) ? 'spectrogram' : 'main'
})

// SF8.3: build the spectrum only on an explicit user action -- switching to the
// Спектрограмма view or selecting a file -- NOT on mount for a restored selection
// (no `immediate`, so opening the Audio tab with a pre-selected file won't auto-build).
watch([activePlayerViewTab, activeContentTab, () => audio.selectedPath], () => {
  if (activeContentTab.value !== 'player') {
    return
  }

  ensureSpectrogramPrepared()
})
</script>

<style scoped>
/* GT10.17: the audio-settings dialog wrapper (hosts the settings card). */
.audio-page__settings-dialog {
  display: flex;
  flex-direction: column;
  max-height: 85vh;
  max-width: 820px;
  width: 92vw;
}
/* GT10.29/GT10.45: the body (two panes) scrolls; header (X) and footer (Close) stay visible. */
.audio-page__settings-dialog-body {
  min-height: 320px;
  overflow: hidden;
}
.audio-page__settings-nav {
  flex: 0 0 200px;
  overflow: auto;
  padding: 4px 0;
}
.audio-page__settings-nav--active {
  background: rgba(25, 118, 210, 0.12);
  color: var(--q-primary);
  font-weight: 600;
}
.audio-page__settings-content {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  padding: 4px 8px;
}

.audio-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* FB4.1 (FB-D12): form-wide classic menu bar above the sidebar + content. */
.audio-page__menubar {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

/* FB4.3 (FB-D13): wraps the docked file panel + the form inner; reflows around the dock side. */
.audio-page__dock-wrap {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.audio-page__dock-wrap--row { flex-direction: row; }
.audio-page__dock-wrap--col { flex-direction: column; }

.audio-page__inner {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  order: 1;
  gap: 5px;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.audio-page__files-toggle {
  flex: 0 0 auto;
}

.audio-page__sidebar-header {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.audio-page__sidebar-heading {
  min-width: 0;
}

.audio-page__load-dialog {
  border-radius: 8px;
  min-width: 320px;
  overflow: hidden;
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

/* SF23.2: waveform style popover (colour + overlay opacity). */
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

.audio-page__files-toggle--active {
  background: rgba(25, 118, 210, 0.12);
}

.audio-page__sidebar {
  flex: 0 0 360px;
  min-width: 280px;
}

.audio-page__content {
  flex: 1 1 auto;
  min-width: 0;
}

.audio-page__card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.audio-page__content-card {
  min-height: 0;
}

.audio-page__tree-section,
.audio-page__output-section {
  flex: 1 1 auto;
  min-height: 0;
}

.audio-page__tree-section {
  overflow: auto;
}

.audio-page__tree-node {
  align-items: center;
  display: inline-flex;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}

.audio-page__tree-node-icon {
  flex: 0 0 auto;
}

.audio-page__tree-node-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-page__output-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px;
}

.audio-page__output-section--main {
  overflow: hidden;
}

.audio-page__output-section--schedule {
  padding: 0;
}

.audio-page__output-section--spectrogram {
  overflow: auto;
  position: relative;
}

/* SF3.1 (SF-D4): settings overlay "Параметры" over the plot (no main-content resize). */
.audio-page__spectrogram-settings-backdrop {
  background: rgba(2, 6, 23, 0.45);
  inset: 0;
  position: absolute;
  z-index: 20;
}

.audio-page__spectrogram-settings-panel {
  background: #0f172a;
  border-left: 1px solid rgba(148, 163, 184, 0.24);
  bottom: 0;
  box-shadow: -18px 0 40px rgba(2, 6, 23, 0.45);
  display: flex;
  flex-direction: column;
  max-width: calc(100% - 56px);
  position: absolute;
  right: 0;
  top: 0;
  width: 300px;
  z-index: 30;
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

.audio-page__schedule-view {
  flex: 1 1 auto;
  min-height: 0;
}

.audio-page__player-toolbar {
  display: flex;
  flex: 0 0 auto;
  margin-bottom: 12px;
}

.audio-page__player-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.audio-page__tabs-bar {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 16px;
  min-width: 0;
  padding-right: 16px;
}

.audio-page__meta-strip {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: 12px;
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  justify-content: flex-end;
}

.audio-page__meta-cell {
  min-width: 0;
}

.audio-page__meta-cell--file {
  flex: 1 1 min(42vw, 560px);
  max-width: min(42vw, 560px);
}

.audio-page__meta-cell--metric {
  flex: 0 0 84px;
  overflow: hidden;
}

.audio-page__meta-cell--right {
  text-align: right;
}

.audio-page__meta-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-page__meta-value {
  white-space: nowrap;
}

.audio-page__meta-value--file {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* SF20: recent-files quick-pick dropdown in the meta strip. */
.audio-page__file-dropdown {
  margin-left: -8px;
  max-width: 100%;
}

.audio-page__recent-list {
  max-width: 520px;
  min-width: 240px;
}

.audio-page__tabs {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 12px;
}

.audio-page__panels {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.audio-page__panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.audio-page__panel--player {
  overflow: hidden;
}

.audio-page__player-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.audio-page__player-view-tabs-bar {
  flex: 0 0 auto;
  padding: 0 16px;
}

.audio-page__player-view-tabs {
  min-width: 0;
}

.audio-page__player-view-panels {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.audio-page__player-view-panel {
  overflow: hidden;
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

.audio-page__output {
  background: #111827;
  border-radius: 8px;
  color: #e5e7eb;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  margin: 0;
  min-height: 100%;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 960px) {
  .audio-page__inner {
    flex-direction: column;
    padding: 0;
  }

  .audio-page__sidebar {
    flex-basis: auto;
    min-width: 0;
  }

  .audio-page__meta-strip {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .audio-page__meta-cell--metric {
    flex-basis: 78px;
  }

  .audio-page__player-view-tabs-bar {
    padding: 0 12px;
  }
}

@media (max-width: 1180px) {
  .audio-page__tabs-bar {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding-right: 0;
  }

  .audio-page__meta-strip {
    justify-content: flex-end;
    padding: 0 16px 8px;
    width: 100%;
  }

  .audio-page__meta-cell--file {
    flex-basis: min(100%, 440px);
    max-width: min(100%, 440px);
  }
}
</style>