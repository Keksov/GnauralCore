<template>
  <q-page class="audio-page" :style-fn="pageStyle">
    <div class="audio-page__inner">
      <div class="audio-page__sidebar">
        <q-card flat bordered class="audio-page__card">
          <q-card-section>
            <div class="text-h6">{{ t('audio.presetsTitle') }}</div>
            <div class="text-caption text-grey-7">{{ t('audio.presetsSubtitle') }}</div>
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
              <div class="audio-page__meta-cell audio-page__meta-cell--file" :title="sessionFilePath">
                <div class="text-caption text-grey-7 audio-page__meta-label">{{ t('audio.selectedFile') }}</div>
                <div class="text-body2 audio-page__meta-value audio-page__meta-value--file">{{ sessionFilePath }}</div>
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
                        <div class="audio-page__player-controls">
                          <q-btn
                            :color="startStopButtonColor"
                            :flat="startStopButtonFlat"
                            :icon="startStopButtonIcon"
                            :label="startStopButtonLabel"
                            :disable="startStopDisabled"
                            @click="handleStartStop"
                          />
                          <q-btn
                            color="primary"
                            flat
                            :icon="pauseResumeButtonIcon"
                            :label="pauseResumeButtonLabel"
                            :disable="pauseResumeDisabled"
                            @click="handlePauseResume"
                          />
                          <q-btn-dropdown
                            v-if="canExportCurrentFile"
                            color="primary"
                            flat
                            icon="download"
                            :label="t('audio.export')"
                            :disable="exportingFormat !== null"
                            :loading="exportingFormat !== null"
                          >
                            <q-list dense>
                              <q-item clickable v-close-popup @click="downloadSelectedAudio('wav')">
                                <q-item-section>{{ t('audio.exportWav') }}</q-item-section>
                              </q-item>
                              <q-item clickable v-close-popup @click="downloadSelectedAudio('flac')">
                                <q-item-section>{{ t('audio.exportFlac') }}</q-item-section>
                              </q-item>
                            </q-list>
                          </q-btn-dropdown>
                        </div>
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
                          @seek="handleSeek"
                          @patch-voice-state="handleScheduleVoiceStatePatch"
                          @patch-voice-state-batch="handleScheduleVoiceStateBatch"
                        >
                          <template #transportControls>
                            <div class="audio-page__player-controls">
                              <q-btn
                                :color="startStopButtonColor"
                                :flat="startStopButtonFlat"
                                :icon="startStopButtonIcon"
                                :label="startStopButtonLabel"
                                :disable="startStopDisabled"
                                @click="handleStartStop"
                              />
                              <q-btn
                                color="primary"
                                flat
                                :icon="pauseResumeButtonIcon"
                                :label="pauseResumeButtonLabel"
                                :disable="pauseResumeDisabled"
                                @click="handlePauseResume"
                              />
                              <q-btn-dropdown
                                v-if="canExportCurrentFile"
                                color="primary"
                                flat
                                icon="download"
                                :label="t('audio.export')"
                                :disable="exportingFormat !== null"
                                :loading="exportingFormat !== null"
                              >
                                <q-list dense>
                                  <q-item clickable v-close-popup @click="downloadSelectedAudio('wav')">
                                    <q-item-section>{{ t('audio.exportWav') }}</q-item-section>
                                  </q-item>
                                  <q-item clickable v-close-popup @click="downloadSelectedAudio('flac')">
                                    <q-item-section>{{ t('audio.exportFlac') }}</q-item-section>
                                  </q-item>
                                </q-list>
                              </q-btn-dropdown>
                            </div>
                          </template>
                        </gnaural-schedule-view>
                      </template>
                    </div>
                  </q-tab-panel>

                  <q-tab-panel name="spectrogram" class="audio-page__panel audio-page__player-view-panel q-pa-none">
                    <div class="audio-page__output-section audio-page__output-section--spectrogram">
                      <div class="audio-page__player-toolbar">
                        <div class="audio-page__player-controls">
                          <q-btn
                            :color="startStopButtonColor"
                            :flat="startStopButtonFlat"
                            :icon="startStopButtonIcon"
                            :label="startStopButtonLabel"
                            :disable="startStopDisabled"
                            @click="handleStartStop"
                          />
                          <q-btn
                            color="primary"
                            flat
                            :icon="pauseResumeButtonIcon"
                            :label="pauseResumeButtonLabel"
                            :disable="pauseResumeDisabled"
                            @click="handlePauseResume"
                          />
                          <q-btn-dropdown
                            v-if="canExportCurrentFile"
                            color="primary"
                            flat
                            icon="download"
                            :label="t('audio.export')"
                            :disable="exportingFormat !== null"
                            :loading="exportingFormat !== null"
                          >
                            <q-list dense>
                              <q-item clickable v-close-popup @click="downloadSelectedAudio('wav')">
                                <q-item-section>{{ t('audio.exportWav') }}</q-item-section>
                              </q-item>
                              <q-item clickable v-close-popup @click="downloadSelectedAudio('flac')">
                                <q-item-section>{{ t('audio.exportFlac') }}</q-item-section>
                              </q-item>
                            </q-list>
                          </q-btn-dropdown>
                        </div>
                      </div>

                      <div class="text-subtitle2 q-mb-sm">{{ t('audio.spectrogramTitle') }}</div>
                      <div v-if="audio.spectrogramLoading" class="audio-page__empty text-grey-7">
                        {{ spectrogramLoadingLabel }}
                      </div>
                      <q-banner v-else-if="audio.spectrogramError !== null" dense rounded class="bg-orange-1 text-orange-10 q-mb-md">
                        {{ audio.spectrogramError }}
                      </q-banner>
                      <div v-else-if="audio.spectrogramBuffer === null" class="audio-page__empty text-grey-7">
                        {{ noSpectrogramLabel }}
                      </div>
                      <spectrogram-view v-else :audio-buffer="audio.spectrogramBuffer" />
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
  </q-page>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useQuasar, type QTreeNode } from 'quasar'
import type { AudioFileKind, PresetTreeNode } from '@protocol'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import GnauralEditorPanel from 'components/GnauralEditorPanel.vue'
import GnauralScheduleView from 'components/GnauralScheduleView.vue'
import SpectrogramView from 'components/SpectrogramView.vue'
import { audioApi } from 'src/services/audio-api'
import { wsService } from 'src/services/ws'
import { useAudioStore } from 'stores/audio'

const STORAGE_AUDIO_EXPANDED_PATHS = 'mindwave-audio-expanded-paths'
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

const { t } = useI18n()
const $q = useQuasar()
const router = useRouter()
const audio = useAudioStore()
const activeContentTab = ref<'player' | 'editor'>('player')
const activePlayerViewTab = ref<'main' | 'spectrogram'>('main')
const expandedTreePaths = ref<string[]>(loadStoredExpandedPaths())
const treeSelectionAutoPlayRequested = ref(false)
const editorPanelRef = ref<GnauralEditorPanelHandle | null>(null)
const scheduleViewRef = ref<GnauralScheduleViewHandle | null>(null)
const trackStateBusy = ref(false)
const optimisticSeekPositionSec = ref<number | null>(null)
const exportingFormat = ref<ExportAudioFileKind | null>(null)

let selectionChangeToken = 0
let optimisticSeekResetTimer: ReturnType<typeof setTimeout> | null = null

const canStart = computed(() => {
  if (!audio.canStart) {
    return false
  }

  if (audio.selectedFileKind === 'gnaural') {
    return wsService.connectionState.value === 'connected'
  }

  return true
})

function isLocalAudioFileKind(fileKind: AudioFileKind | null): fileKind is Exclude<AudioFileKind, 'gnaural'> {
  return fileKind === 'wav' || fileKind === 'flac'
}

const canSeek = computed(() => {
  if (!audio.canSeek) {
    return false
  }

  if (audio.activePlaybackMode === 'gnaural' || (audio.activePlaybackMode === null && audio.displayMode === 'gnaural')) {
    return wsService.connectionState.value === 'connected'
  }

  return true
})

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

const sessionFilePath = computed(() => {
  return audio.selectedPath ?? audio.displayFilePath ?? t('audio.noFileSelected')
})

const startStopButtonLabel = computed(() => {
  return audio.canStop ? t('audio.stop') : t('audio.start')
})

const startStopButtonIcon = computed(() => {
  return audio.canStop ? 'stop' : 'play_arrow'
})

const startStopButtonColor = computed(() => {
  return audio.canStop ? 'negative' : 'primary'
})

const startStopButtonFlat = computed(() => {
  return audio.canStop
})

const startStopDisabled = computed(() => {
  return audio.canStop === false && canStart.value === false
})

const pauseResumeButtonLabel = computed(() => {
  return audio.canResume ? t('audio.resume') : t('audio.pause')
})

const pauseResumeButtonIcon = computed(() => {
  return audio.canResume ? 'play_circle' : 'pause'
})

const pauseResumeDisabled = computed(() => {
  return audio.canPause === false && audio.canResume === false
})

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '00:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildExportFileName(filePath: string, format: ExportAudioFileKind): string {
  const sourceName = filePath.split(/[\\/]/).pop() ?? filePath
  const sourceExt = sourceName.match(/\.[^.]+$/u)?.[0] ?? ''
  return `${sourceName.slice(0, Math.max(0, sourceName.length - sourceExt.length))}.${format}`
}

const displayedPositionSec = computed(() => optimisticSeekPositionSec.value ?? audio.positionSec)

const positionLabel = computed(() => formatTime(displayedPositionSec.value))

const durationLabel = computed(() => formatTime(audio.durationSec))

const canExportCurrentFile = computed(() => {
  return audio.selectedPath !== null && audio.selectedFileKind === 'gnaural'
})

const sliderMax = computed(() => {
  return audio.durationSec > 0 ? audio.durationSec : 1
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

const showEmbeddedScheduleView = computed(() => {
  return audio.displayMode === 'gnaural'
    && !audio.gnauralScheduleLoading
    && audio.gnauralScheduleError === null
    && audio.gnauralSchedule !== null
})

function clearOptimisticSeekResetTimer(): void {
  if (optimisticSeekResetTimer !== null) {
    clearTimeout(optimisticSeekResetTimer)
    optimisticSeekResetTimer = null
  }
}

function clearOptimisticSeekPosition(): void {
  clearOptimisticSeekResetTimer()
  optimisticSeekPositionSec.value = null
}

function clampSeekValue(value: number): number {
  return Math.max(0, Math.min(value, sliderMax.value))
}

function setOptimisticSeekPosition(value: number): void {
  clearOptimisticSeekResetTimer()
  optimisticSeekPositionSec.value = clampSeekValue(value)
  optimisticSeekResetTimer = setTimeout(() => {
    optimisticSeekPositionSec.value = null
    optimisticSeekResetTimer = null
  }, 1500)
}

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

  if (path === null || !audio.canStart || shouldAutoPlay === false) {
    return
  }

  startPlayback()
}

function sendAudioMessage(message: Parameters<typeof wsService.send>[0], fallbackMessage: string) {
  if (!wsService.send(message)) {
    audio.setClientError(fallbackMessage)
    return false
  }

  return true
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

function handlePauseResume() {
  if (audio.canResume) {
    resumePlayback()
    return
  }

  pausePlayback()
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

function pausePlayback() {
  if (isLocalAudioFileKind(audio.activePlaybackMode)) {
    audio.pauseLocalPlayback()
    return
  }

  sendAudioMessage({ type: 'audio_pause' }, t('audio.wsSendFailed'))
}

function resumePlayback() {
  if (isLocalAudioFileKind(audio.activePlaybackMode)) {
    void audio.resumeLocalPlayback()
    return
  }

  sendAudioMessage({ type: 'audio_resume' }, t('audio.wsSendFailed'))
}

function stopPlayback() {
  if (isLocalAudioFileKind(audio.activePlaybackMode)) {
    audio.stopLocalPlayback()
    return
  }

  sendAudioMessage({ type: 'audio_stop' }, t('audio.wsSendFailed'))
}

function handleSeek(value: number | null) {
  if (value === null) {
    return
  }

  const nextPositionSec = clampSeekValue(value)
  setOptimisticSeekPosition(nextPositionSec)

  if (isLocalAudioFileKind(audio.activePlaybackMode) || isLocalAudioFileKind(audio.displayMode)) {
    audio.seekLocalPlayback(nextPositionSec)
    return
  }

  if (!sendAudioMessage({ type: 'audio_seek', positionSec: nextPositionSec }, t('audio.wsSendFailed'))) {
    clearOptimisticSeekPosition()
  }
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
  clearOptimisticSeekPosition()
  window.removeEventListener('keydown', handlePlayerKeyDown)
})

watch(() => audio.positionSec, (positionSec) => {
  if (optimisticSeekPositionSec.value === null) {
    return
  }

  if (Math.abs(positionSec - optimisticSeekPositionSec.value) <= 0.25) {
    clearOptimisticSeekPosition()
  }
})

watch(() => [audio.displayFilePath, audio.transportState] as const, ([filePath, transportState]) => {
  if (filePath === null || transportState === 'idle') {
    clearOptimisticSeekPosition()
  }
})

watch(() => audio.displayMode, (displayMode, previousDisplayMode) => {
  if (displayMode === previousDisplayMode) {
    return
  }

  activePlayerViewTab.value = isLocalAudioFileKind(displayMode) ? 'spectrogram' : 'main'
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
  gap: 16px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
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
    padding: 12px;
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