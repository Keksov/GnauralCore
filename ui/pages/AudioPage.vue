<template>
  <q-page class="audio-page" :style-fn="pageStyle">
    <!-- FB4.1 (owner req. 12, FB-D12): the menu bar spans the whole Audio form — above the side
         panels (Presets, and any future panel) AND the content — like a classic app menu bar. -->
    <div class="audio-page__menubar row items-center no-wrap">
      <!-- MR1.1 (menu-redesign): a single «Меню» dropdown, data-driven from menuModel with sideways
           submenus (owner reqs 1,2,3,5). Replaces the former «Файл»/«Правка» dropdowns. -->
      <q-btn-dropdown ref="menuDropdownRef" flat dense no-caps :label="t('audio.menuRoot')" class="audio-page__menu-file">
        <AppMenuList :nodes="menuModel" @select="onMenuSelect" />
        <!-- MR3.1: last-5 used commands under a divider after «Выход» (owner req. 4). -->
        <template v-if="mruNodes.length > 0">
          <q-separator />
          <AppMenuList :nodes="mruNodes" @select="onMenuSelect" />
        </template>
      </q-btn-dropdown>

      <!-- MR5.1 (owner req. 9): the «Выбранный файл» control, moved here from the tabs-bar meta-strip
           to the right of «Меню». Behavior identical (label + recent-files quick-pick). -->
      <div class="audio-page__menubar-file row items-center no-wrap q-ml-sm">
        <span class="text-caption text-grey-7 q-mr-sm">{{ t('audio.currentFile') }}</span>
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
    </div>

    <!-- GT10.29 (owner 2026-07-13): settings dialog at PAGE level so Меню→Настройки can open it
         regardless of which panels are shown (it used to live inside the Presets sidebar, which is
         v-if="filesPanelOpen" — so it wouldn't open with that panel closed). Two-pane: subsystem
         list (left) + the selected subsystem's settings (right). (MR1.1 replaced the Edit menu with
         «Меню»; MR4.1 dropped the Ctrl+P binding — that shortcut belongs to Print.) -->
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
            <SpectrogramSettingsTab v-if="settingsSubsystem === 'spectrogram'" />
          </div>
        </div>
        <q-separator />
        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('audio.close')" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- MR2.1 (menu-redesign): export dialog (Меню → Файл → Экспорт) — pick the file type + name. -->
    <q-dialog v-model="exportDialog.open">
      <q-card class="audio-page__export-dialog">
        <q-card-section class="row items-center q-py-sm">
          <div class="text-h6">{{ t('audio.exportDialogTitle') }}</div>
          <q-space />
          <q-btn flat round dense icon="close" v-close-popup :aria-label="t('audio.exportCancel')" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-gutter-md">
          <div>
            <div class="text-caption text-grey-7 q-mb-xs">{{ t('audio.exportFormat') }}</div>
            <q-option-group
              v-model="exportDialog.format"
              inline
              :options="[
                { label: 'WAV', value: 'wav' },
                { label: 'FLAC', value: 'flac' },
              ]"
            />
          </div>
          <q-input
            v-model="exportDialog.fileName"
            dense
            outlined
            :label="t('audio.exportFileName')"
            @keyup.enter="confirmExport"
          />
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn flat no-caps :label="t('audio.exportCancel')" v-close-popup />
          <q-btn
            color="primary"
            no-caps
            icon="download"
            :label="t('audio.exportAction')"
            :disable="exportDialog.fileName.trim() === '' || exportingFormat !== null"
            :loading="exportingFormat !== null"
            @click="confirmExport"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- FB4.3 (FB-D13): docked panel + editor reflow. Floating -> teleported to <body> (fixed
         overlay, no ancestor clipping); docked -> a flex sibling of the inner form. -->
    <div class="audio-page__dock-wrap" :class="dockWrapClass">
      <Teleport to="body" :disabled="!fsFloating">
        <FileOpenDialog
          v-if="filePanel.open"
          :initial-path="fileDialogInitialPath"
          @open="handleExternalFileOpen"
        />
      </Teleport>

      <!-- PW5.6c: «Список треков» docks in the SAME wrap as «Открыть файл» (full editor height). -->
      <Teleport to="body" :disabled="!tracksListFloating">
        <TrackListDialog
          v-if="tracksListPanel.open"
          @patch-voice-state="handleScheduleVoiceStatePatch"
          @patch-voice-state-batch="handleScheduleVoiceStateBatch"
        />
      </Teleport>

      <!-- SS1.1 (SS-D1): «Параметры» — same wrap again. It needs nothing from this page: the panel
           talks to the global spectrogram Pinia store directly, so there is no state to plumb. -->
      <Teleport to="body" :disabled="!spectrumSettingsFloating">
        <SpectrumSettingsDialog v-if="spectrumSettingsPanel.open" />
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
            <!-- MR5.1 (owner req. 9): the «Выбранный файл» meta-strip moved up to the menubar (right
                 of «Меню»). SB2.8 had already moved Position/Duration to the Tracks status bar. -->
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
                    <!-- GT7.5 (owner 2026-07-13): the Спектрограмма tab was removed (its view lives
                         in Треки). GT2.4: the "Треки" tab hosts ALL new track-stack functionality. -->
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
                          @start-stop="handleStartStop"
                          @pause-resume="handlePauseResume"
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
                              @start-stop="handleStartStop"
                              @pause-resume="handlePauseResume"
                            />
                          </template>
                        </gnaural-schedule-view>
                      </template>
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
                      @patch-voice-state="handleScheduleVoiceStatePatch"
                      @patch-voice-state-batch="handleScheduleVoiceStateBatch"
                    >
                      <template #toolbar>
                        <gnaural-transport-controls
                          toolbar
                          :start-stop-icon="startStopButtonIcon"
                          :start-stop-label="startStopButtonLabel"
                          :start-stop-color="startStopButtonColor"
                          :start-stop-flat="startStopButtonFlat"
                          :start-stop-disabled="startStopDisabled"
                          :pause-resume-icon="pauseResumeButtonIcon"
                          :pause-resume-label="pauseResumeButtonLabel"
                          :pause-resume-disabled="pauseResumeDisabled"
                          @start-stop="handleStartStop"
                          @pause-resume="handlePauseResume"
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
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type AsyncComponentLoader, type Component } from 'vue'
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
import { QSpinnerHourglass, useQuasar, type QBtnDropdown, type QTreeNode } from 'quasar'
import type { AudioFileKind, PresetTreeNode, SpectrogramAnalysisParams } from '@protocol'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { audioApi } from '../audio-api'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import GnauralSettingsTab from '../settings/GnauralSettingsTab.vue'
import { useAudioTransport } from '../composables/use-audio-transport'
import { useWsService } from '../composables/use-ws'
import GnauralTransportControls from '../components/GnauralTransportControls.vue'
import FileOpenDialog from '../components/FileOpenDialog.vue'
import { bindProjectViewState } from '../composables/use-project-view-state'
import { writeVoiceStatePatches } from '../composables/use-voice-state'
import { useAudioStore } from '../stores/audio'
import { useFileOpenPanelState } from '../stores/file-open-panel'
import { useTracksListPanelState } from '../stores/track-list-panel'
import TrackListDialog from '../components/TrackListDialog.vue'
import { useSpectrumSettingsPanelState } from '../stores/spectrum-settings-panel'
import SpectrumSettingsDialog from '../components/SpectrumSettingsDialog.vue'
import AppMenuList from '../components/app-menu/AppMenuList.vue'
import type { MenuNode } from '../components/app-menu/menu-node'
import { menuNodeDisabled } from '../components/app-menu/menu-node'
import { useMenuMru } from '../composables/use-menu-mru'
import { useSpectrogramStore } from '../stores/spectrogram'

const STORAGE_AUDIO_EXPANDED_PATHS = 'mindwave-audio-expanded-paths'
const STORAGE_AUDIO_FILES_PANEL_OPEN = 'mindwave-audio-files-panel-open'
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




const { t } = useI18n()
const $q = useQuasar()
const router = useRouter()
const audio = useAudioStore()
// PW5.6 (PW-D10): the shared gtrack model (same instance the Треки tab + «Список треков» panel edit),
// used by the voice-patch save-first guard below.
const gtracks = useSharedGtrackLanes()
const activeContentTab = ref<'player' | 'editor'>('player')
const filesPanelOpen = ref(loadStoredFilesPanelOpen())
// SF8.1: stacked spectrogram tracks (stereo L/R) share one time window + area
// selection so they zoom/pan/select together; reset per file so a new file starts full.
const spectrogramShared = {
  view: ref<TimeWindow | null>(null),
  selection: ref<SpectrogramSelection | null>(null),
  commitSeq: ref(0),
  // SF15.1: shared frequency window (bin-axis fractions) so stacked tracks freq-zoom together.
  freqView: ref<{ lo: number; hi: number } | null>(null),
}
// GT7.5 (owner 2026-07-13): the Спектрограмма sub-tab was removed — its visualization lives in the
// Треки tab now.
const activePlayerViewTab = ref<'main' | 'tracks'>('main')
const expandedTreePaths = ref<string[]>(loadStoredExpandedPaths())
const treeSelectionAutoPlayRequested = ref(false)
const editorPanelRef = ref<GnauralEditorPanelHandle | null>(null)
const scheduleViewRef = ref<GnauralScheduleViewHandle | null>(null)
const trackStateBusy = ref(false)
const exportingFormat = ref<ExportAudioFileKind | null>(null)
// MR2.1 (menu-redesign): export dialog state (type + filename), opened from Меню → Файл → Экспорт.
const exportDialog = reactive({
  open: false,
  format: 'wav' as ExportAudioFileKind,
  fileName: '',
})
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
// PW1.2: the window model lives in the universal panel state (@panel), not the fs-browser store.
const filePanel = useFileOpenPanelState()
const fsFloating = computed<boolean>(() => filePanel.mode === 'floating')
// PW5.6c: «Список треков» shares this same AudioPage dock-wrap with «Открыть файл», so it docks the
// FULL editor height and persists across tabs (its toggle button lives in the Треки tab header).
const tracksListPanel = useTracksListPanelState()
const tracksListFloating = computed<boolean>(() => tracksListPanel.mode === 'floating')
// SS1.1 (SS-D1): «Параметры» joins the same dock-wrap for the same reasons — full editor height,
// one dock shared with the other two, and survival across tab switches (the q-tab-panels have no
// keep-alive, so TracksPanel — where its toolbar button lives — is destroyed on every switch).
const spectrumSettingsPanel = useSpectrumSettingsPanelState()
const spectrumSettingsFloating = computed<boolean>(() => spectrumSettingsPanel.mode === 'floating')
const dockWrapClass = computed<string>(() => {
  const anyVertical =
    filePanel.mode === 'top' || filePanel.mode === 'bottom' ||
    tracksListPanel.mode === 'top' || tracksListPanel.mode === 'bottom' ||
    spectrumSettingsPanel.mode === 'top' || spectrumSettingsPanel.mode === 'bottom'
  return anyVertical ? 'audio-page__dock-wrap--col' : 'audio-page__dock-wrap--row'
})

function openFileDialog(): void {
  filePanel.open = true
}

// MR1.1 (menu-redesign): the single «Меню» dropdown, its data-driven model, and the leaf-invoke
// wrapper. invokeMenuCommand is the ONE code path for running a leaf; MRU recording (MR3.1) hangs
// off it. exitApp closes the AppCore host window (owner req. 6; in a dev browser window.close()
// only affects script-opened windows -> effectively a no-op there).
const menuDropdownRef = ref<QBtnDropdown | null>(null)

function exitApp(): void {
  // AppCore binds window.__appcoreExit() to terminate its run loop — window.close() alone only
  // raises WindowCloseRequested, which the AppCore webview library ignores (so it does nothing).
  const appcoreExit = (window as unknown as { __appcoreExit?: () => void }).__appcoreExit
  if (typeof appcoreExit === 'function') {
    appcoreExit()
    return
  }
  // Dev browser (no native host): best-effort — only works for script-opened windows.
  window.close()
}

const menuModel = computed<MenuNode[]>(() => [
  {
    id: 'file',
    labelKey: 'audio.menuFile',
    icon: 'insert_drive_file',
    children: [
      { id: 'file.open', labelKey: 'audio.menuOpen', icon: 'folder_open', run: openFileDialog },
      {
        id: 'file.export',
        labelKey: 'audio.export',
        icon: 'download',
        run: openExportDialog,
        disabled: () => !canExportCurrentFile.value,
      },
    ],
  },
  // MR4.1 (owner 2026-07-15): no Ctrl+P shortcut — that combination belongs to the print dialog.
  { id: 'settings', labelKey: 'audio.openSettings', icon: 'settings', run: goToSettings },
  { id: 'exit', labelKey: 'audio.menuExit', icon: 'logout', run: exitApp, noMru: true },
])

const menuMru = useMenuMru()

// Flat registry of invocable leaves (by id), used to render the MRU rows from stored ids.
function collectMenuLeaves(nodes: readonly MenuNode[], acc: Map<string, MenuNode>): void {
  for (const node of nodes) {
    if (node.children !== undefined) {
      collectMenuLeaves(node.children, acc)
    }
    if (node.run !== undefined) {
      acc.set(node.id, node)
    }
  }
}

const menuLeafById = computed(() => {
  const map = new Map<string, MenuNode>()
  collectMenuLeaves(menuModel.value, map)
  return map
})

// MR3.1: the last-5 used commands, resolved back to their leaf nodes (dropping any stale id).
const mruNodes = computed<MenuNode[]>(() => {
  const byId = menuLeafById.value
  return menuMru.ids.value
    .map((id) => byId.get(id))
    .filter((node): node is MenuNode => node !== undefined && node.noMru !== true)
})

function invokeMenuCommand(node: MenuNode): void {
  if (node.run === undefined || menuNodeDisabled(node)) {
    return
  }
  node.run()
  if (node.noMru !== true) {
    menuMru.record(node.id)
  }
}

function onMenuSelect(node: MenuNode): void {
  invokeMenuCommand(node)
  menuDropdownRef.value?.hide()
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
      activePlayerViewTab.value = 'tracks' // GT7.5: Спектрограмма removed — Треки shows the spectrum
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
  if (activePlayerViewTab.value !== 'tracks') {
    return
  }

  // A gnaural needs nothing decoded here: the tab's waveform/spectrum come from the SpectrumCore
  // backend analysis, which TracksPanel opens itself. (GT2.6 used to fetch + decode a single-loop
  // WAV render on every tab open for a client-side buffer nothing displayed; removed 2026-07-15
  // together with that buffer.) Only the schedule is needed, for the gtrack curves.
  if (activePlayerViewTab.value === 'tracks' && audio.displayMode === 'gnaural' && audio.displayFilePath !== null) {
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
  // Only local wav/flac decode through the store, so only they can raise this overlay — a gnaural
  // has no client-side buffer (its spectrum is the backend analysis, opened by TracksPanel).
  return t('audio.spectrogramLoading')
})

// Reset the shared spectrogram view/selection when the file changes (fresh full view).
watch(() => audio.displayFilePath, () => {
  spectrogramShared.view.value = null
  spectrogramShared.selection.value = null
  spectrogramShared.freqView.value = null
})
// project-store PR2.3 (PR-D13): the time/freq windows are per-file project state — restored on
// open, written back debounced. Registered right after the reset watch (ordering contract).
bindProjectViewState({
  sectionName: 'viewAudio',
  filePath: () => audio.displayFilePath,
  view: spectrogramShared.view,
  freqView: spectrogramShared.freqView,
})

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
    // GT2.4/GT7.5: if the user is on the Треки tab, stay there (it shows the same stack); otherwise
    // land on Треки (the Спектрограмма tab was removed).
    if (activePlayerViewTab.value !== 'tracks') {
      activePlayerViewTab.value = 'tracks'
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
// SF23 follow-up: the waveform primary is the nav target when the spectrogram is hidden.
const waveformNavRef = ref<SpectrogramNavHandle | null>(null)
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
  // MR4.1 (owner 2026-07-15): the GT10.45 Ctrl/Cmd+P -> settings binding is REMOVED. It called
  // preventDefault to override the browser's Print, i.e. it silently stole the print shortcut;
  // Ctrl+P now reaches the print dialog again and Settings is opened from Меню (or its MRU entry).
  // GT2.4 (GT-D10): while the Треки tab is active, TracksPanel owns the player hotkeys
  // (its own window listener); skip entirely so the two handlers never double-act.
  if (activePlayerViewTab.value === 'tracks') {
    return
  }
  if (shouldIgnorePlayerHotkey(event)) {
    return
  }

  // SF21: when the spectrogram (track editor) view is active, route navigation keys to it
  // even if the canvas isn't focused — the window is treated as the track editor's.
  if (
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

  // PW5.6: updating the cached schedule rebuilds the gtrack editor model and would drop unsaved
  // curve edits. Persist them first — the extracted «Список треков» panel no longer saves before
  // muting, so this central guard covers every voice-patch caller.
  if (gtracks.dirty.value) {
    try {
      await gtracks.saveEdits()
    } catch (error) {
      $q.notify({ type: 'negative', message: error instanceof Error ? error.message : t('audio.gtrackSaveFailed') })
      return
    }
  }

  trackStateBusy.value = true

  try {
    // project-store PR2.4 (owner req 9): colour/hidden/muted go to the project's voiceState
    // section — the .gnaural file itself is no longer rewritten for view state, so there is no
    // editor-panel mutation guard and no reload-from-disk here anymore.
    const currentSchedule = audio.gnauralSchedule
    await writeVoiceStatePatches(filePath, normalizedPatches, currentSchedule)
    audio.applyVoiceStateLocally(filePath, normalizedPatches)

    // Live playback: mute changes are pushed into the running engine by voice INDEX (dump order).
    const voices = currentSchedule?.voices ?? []
    const muteItems = normalizedPatches
      .filter((patch) => patch.muted !== undefined)
      .map((patch) => ({ voiceIndex: voices.findIndex((v) => v.id === patch.voiceId), muted: patch.muted === true }))
      .filter((item) => item.voiceIndex >= 0)
    if (muteItems.length > 0) {
      await audioApi.applyLiveVoiceMute(filePath, muteItems).catch(() => undefined)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('audio.scheduleTrackPatchFailed')
    audio.setClientError(message)
    $q.notify({ type: 'negative', message })
  } finally {
    trackStateBusy.value = false
  }
}

async function downloadSelectedAudio(format: ExportAudioFileKind, fileName?: string): Promise<void> {
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
    link.download = fileName !== undefined && fileName.trim() !== '' ? fileName.trim() : buildExportFileName(filePath, format)
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

// MR2.1 (menu-redesign): open the export dialog (Меню → Файл → Экспорт). Prefills the filename from
// the source, gnaural-only (same gate as the old toolbar button).
function openExportDialog(): void {
  const filePath = audio.selectedPath
  if (filePath === null || !canExportCurrentFile.value) {
    return
  }
  exportDialog.format = 'wav'
  exportDialog.fileName = buildExportFileName(filePath, 'wav')
  exportDialog.open = true
}

// Swap the trailing extension of the (possibly user-edited) name when the export type changes.
function swapExportExtension(name: string, format: ExportAudioFileKind): string {
  const ext = name.match(/\.[^.\\/]+$/u)?.[0] ?? ''
  return `${name.slice(0, Math.max(0, name.length - ext.length))}.${format}`
}

watch(() => exportDialog.format, (format) => {
  exportDialog.fileName = swapExportExtension(exportDialog.fileName, format)
})

async function confirmExport(): Promise<void> {
  const fileName = exportDialog.fileName.trim()
  if (fileName === '') {
    return
  }
  const format = exportDialog.format
  exportDialog.open = false
  await downloadSelectedAudio(format, fileName)
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
// content on the right. Subsystems: «Кеш» and «Спектрограмма» (SG1.1); the list is set up to grow.
const settingsSubsystems = [
  { id: 'cache' as const, icon: 'storage', labelKey: 'audio.settingsSubsystemCache' },
  { id: 'spectrogram' as const, icon: 'tune', labelKey: 'audio.settingsSubsystemSpectrogram' },
]
const settingsSubsystem = ref<'cache' | 'spectrogram'>('cache')
// SG1.1 (SG-D1 rev): the spectrogram subsystem pane, lazy so the 18-field form + preset manager
// stay out of AudioPage's eager chunk until Меню→Настройки opens it.
const SpectrogramSettingsTab = defineAsyncComponent(() => import('../components/SpectrogramSettingsTab.vue'))
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

  activePlayerViewTab.value = isLocalAudioFileKind(displayMode) ? 'tracks' : 'main'
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

/* MR5.1: the «Выбранный файл» control relocated into the menubar — clamp its width so a long file
   name never stretches the bar (mirrors the old meta-strip clamp). */
.audio-page__menubar-file {
  min-width: 0;
  max-width: min(48vw, 560px);
  overflow: hidden;
}

/* MR5.1: neutralize the old stacked-cell nudge (-8px) so the label and the file name keep the
   q-mr-sm gap between them instead of touching. */
.audio-page__menubar-file .audio-page__file-dropdown {
  margin-left: 0;
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