<template>
  <q-page class="audio-page" :style-fn="pageStyle">
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
            <q-btn flat color="primary" icon="settings" :label="t('audio.openSettings')" @click="goToSettings" />
          </q-card-actions>

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
                  </q-tabs>
                </div>

                <q-separator />

                <q-tab-panels v-model="activePlayerViewTab" animated class="audio-page__player-view-panels">
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
                          <div class="audio-page__spectrogram-stack">
                          <template v-for="(track, index) in spectrogramTracks" :key="track.key">
                            <spectrogram-view
                              :file-path="audio.displayFilePath"
                              :analysis="track.analysis"
                              :render="spectrogramStore.renderOptions"
                              :window-override="spectrogramWindowOverride"
                              :playhead-sec="displayedPositionSec"
                              :seekable="canSeek"
                              :label="track.label"
                              :primary="track.primary"
                              :show-time-axis-top="index === 0"
                              :show-time-axis-bottom="index === spectrogramTracks.length - 1"
                              :height="spectrogramTrackHeights[index]"
                              @seek="handleSeek"
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
                          <spectrogram-minimap
                            :duration-sec="spectrogramDuration"
                            :file-path="audio.displayFilePath"
                            :analysis="spectrogramTracks[0]?.analysis"
                            :render="spectrogramStore.renderOptions"
                            v-model:view="spectrogramView"
                          />
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
import { useAudioTransport } from '../composables/use-audio-transport'
import { useWsService } from '../composables/use-ws'
import GnauralTransportControls from '../components/GnauralTransportControls.vue'
import { useAudioStore } from '../stores/audio'
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
const activePlayerViewTab = ref<'main' | 'spectrogram'>('main')
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
function ensureSpectrogramPrepared(): void {
  if (activePlayerViewTab.value !== 'spectrogram') {
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
  readonly analysis: SpectrogramAnalysisParams
  readonly label?: string
  readonly primary: boolean
}
const spectrogramTracks = computed<SpectrogramTrack[]>(() =>
  isSpectrogramStereo.value
    ? [
        { key: 'L', analysis: spectrogramLeftAnalysis.value, label: 'L', primary: true },
        { key: 'R', analysis: spectrogramRightAnalysis.value, label: 'R', primary: false },
      ]
    : [{ key: 'mono', analysis: applyHighZoom(spectrogramStore.analysisParams), primary: true }],
)

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
    activePlayerViewTab.value = 'spectrogram'
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

function handlePlayerKeyDown(event: KeyboardEvent): void {
  // SF3.1: Escape closes the spectrogram settings overlay (before other hotkey guards).
  if (event.key === 'Escape' && spectrogramSettingsOpen.value) {
    event.preventDefault()
    closeSpectrogramSettings()
    return
  }
  if (shouldIgnorePlayerHotkey(event)) {
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

function goToSettings() {
  void router.push('/settings')
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
.audio-page {
  min-height: 0;
  overflow: hidden;
}

.audio-page__inner {
  box-sizing: border-box;
  display: flex;
  gap: 5px;
  height: 100%;
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
.audio-page__spectrogram-bottom-handle {
  background: rgba(148, 163, 184, 0.14);
  cursor: ns-resize;
  flex: 0 0 auto;
  height: 8px;
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