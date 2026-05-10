<template>
  <div class="gnaural-editor-panel">
    <div class="gnaural-editor-panel__toolbar">
      <div class="gnaural-editor-panel__tabs" role="tablist" :aria-label="t('audio.editorTab')">
        <button
          type="button"
          role="tab"
          class="gnaural-editor-panel__tab"
          :class="{ 'gnaural-editor-panel__tab--active': activeDocumentId === 'current' }"
          :aria-selected="activeDocumentId === 'current'"
          @click="activateDocument('current')"
        >
          <span class="gnaural-editor-panel__tab-label">{{ currentTabLabel }}</span>
        </button>
        <button
          v-for="previewTab in previewTabs"
          :key="previewTab.id"
          type="button"
          role="tab"
          class="gnaural-editor-panel__tab"
          :class="{ 'gnaural-editor-panel__tab--active': activeDocumentId === previewTab.id }"
          :aria-selected="activeDocumentId === previewTab.id"
          @click="activateDocument(previewTab.id)"
        >
          <span class="gnaural-editor-panel__tab-label">{{ previewTab.title }}</span>
          <q-btn
            flat
            dense
            round
            size="sm"
            icon="close"
            class="gnaural-editor-panel__tab-close"
            @click.stop="closePreviewTab(previewTab.id)"
          />
        </button>
      </div>

      <div class="gnaural-editor-panel__toolbar-actions">
        <q-badge v-if="activePreviewTab !== null" color="blue-grey-8" text-color="white" rounded>
          {{ t('audio.editorReadOnly') }}
        </q-badge>
        <q-btn
          flat
          color="primary"
          icon="history"
          :label="t('audio.editorToggleHistory')"
          @click="historyDrawerOpen = !historyDrawerOpen"
        />
        <q-btn
          v-if="activePreviewTab !== null"
          color="primary"
          :label="t('audio.editorRestore')"
          :disable="currentFilePath === null || isRestoring"
          :loading="isRestoring"
          @click="handleRestoreClick"
        />
        <q-btn
          v-else
          color="primary"
          :label="t('audio.editorSave')"
          :disable="!canSaveCurrent"
          :loading="isSaving"
          @click="handleSaveClick"
        />
      </div>
    </div>

    <div class="gnaural-editor-panel__body">
      <div class="gnaural-editor-panel__main">
        <q-banner v-if="selectedPath === null" dense rounded class="bg-grey-2 text-grey-9">
          {{ t('audio.editorNoFile') }}
        </q-banner>
        <q-banner v-else-if="selectedFileKind !== 'gnaural'" dense rounded class="bg-blue-1 text-blue-10">
          {{ t('audio.editorUnsupported') }}
        </q-banner>
        <q-banner v-else-if="currentLoading" dense rounded class="bg-grey-2 text-grey-9">
          {{ t('audio.editorLoading') }}
        </q-banner>
        <q-banner v-else-if="currentError !== null" dense rounded class="bg-red-1 text-red-10">
          {{ currentError }}
        </q-banner>
        <q-banner v-else-if="editorRuntimeLoading" dense rounded class="bg-grey-2 text-grey-9">
          {{ t('audio.editorLoading') }}
        </q-banner>
        <q-banner v-else-if="editorRuntimeError !== null" dense rounded class="bg-red-1 text-red-10">
          {{ editorRuntimeError }}
        </q-banner>
        <template v-else-if="currentFilePath !== null">
          <div class="gnaural-editor-panel__status-row">
            <span class="gnaural-editor-panel__path">{{ currentFilePath }}</span>
            <q-badge v-if="activePreviewTab?.isAutosave" color="amber-8" text-color="white" rounded>
              {{ t('audio.editorAutosave') }}
            </q-badge>
          </div>
          <div ref="editorHostEl" class="gnaural-editor-panel__editor" />
        </template>
      </div>

      <aside
        class="gnaural-editor-panel__history"
        :class="{ 'gnaural-editor-panel__history--open': historyDrawerOpen }"
      >
        <div class="gnaural-editor-panel__history-header">
          <div class="text-subtitle2">{{ t('audio.editorHistoryTitle') }}</div>
        </div>
        <div class="gnaural-editor-panel__history-body">
          <div v-if="historyLoading" class="gnaural-editor-panel__history-empty text-grey-7">
            {{ t('audio.editorHistoryLoading') }}
          </div>
          <q-banner v-else-if="historyError !== null" dense rounded class="bg-red-1 text-red-10 q-ma-sm">
            {{ historyError }}
          </q-banner>
          <div v-else-if="historyEntries.length === 0" class="gnaural-editor-panel__history-empty text-grey-7">
            {{ t('audio.editorHistoryEmpty') }}
          </div>
          <q-list v-else separator class="gnaural-editor-panel__history-list">
            <q-item
              v-for="entry in historyEntries"
              :key="entry.fileName"
              clickable
              :active="activeDocumentId === `history:${entry.fileName}`"
              active-class="gnaural-editor-panel__history-item--active"
              @click="openHistoryEntry(entry)"
            >
              <q-item-section>
                <q-item-label lines="1">{{ entry.fileName }}</q-item-label>
                <q-item-label caption>{{ formatHistoryDate(entry.modifiedAtMs) }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge v-if="entry.isAutosave" color="amber-8" text-color="white" rounded>
                  {{ t('audio.editorAutosave') }}
                </q-badge>
                <q-spinner-hourglass v-else-if="historyLoadingName === entry.fileName" color="primary" size="18px" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </aside>
    </div>

    <q-dialog v-model="leaveDialog.isOpen" persistent>
      <q-card style="min-width: 360px">
        <q-card-section>
          <div class="text-h6">{{ t('audio.editorUnsavedTitle') }}</div>
          <div class="text-body2 q-mt-sm">{{ t('audio.editorUnsavedBody') }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat color="primary" :label="t('audio.editorUnsavedCancel')" @click="resolveLeaveDialog('cancel')" />
          <q-btn flat color="negative" :label="t('audio.editorUnsavedDiscard')" @click="resolveLeaveDialog('discard')" />
          <q-btn color="primary" :label="t('audio.editorUnsavedSave')" :loading="isSaving" @click="resolveLeaveDialog('save')" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="restoreDialog.isOpen" persistent>
      <q-card style="min-width: 380px">
        <q-card-section>
          <div class="text-h6">{{ t('audio.editorRestoreTitle') }}</div>
          <div class="text-body2 q-mt-sm">{{ t('audio.editorRestoreBody') }}</div>
          <div v-if="currentDirty" class="text-caption text-negative q-mt-sm">{{ t('audio.editorRestoreDirty') }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat color="primary" :label="t('audio.editorUnsavedCancel')" @click="resolveRestoreDialog(false)" />
          <q-btn color="primary" :label="t('audio.editorRestoreConfirm')" @click="resolveRestoreDialog(true)" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="playbackDialog.isOpen" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <div class="text-h6">{{ t('audio.editorPlaybackTitle') }}</div>
          <div class="text-body2 q-mt-sm">{{ t('audio.editorPlaybackBody') }}</div>
          <div v-if="playbackDialog.countdownActive" class="text-caption text-primary q-mt-sm">
            {{ t('audio.editorPlaybackCountdown', { seconds: playbackDialog.countdownSeconds }) }}
          </div>
          <q-checkbox v-model="playbackDialog.remember" class="q-mt-md" :label="t('audio.editorPlaybackRemember')" />
        </q-card-section>
        <q-card-actions align="between" class="q-px-md q-pb-md">
          <div>
            <q-btn
              v-if="playbackDialog.countdownActive"
              flat
              color="primary"
              :label="t('audio.editorPlaybackCancelTimer')"
              @click="cancelPlaybackCountdown"
            />
          </div>
          <div class="gnaural-editor-panel__playback-actions">
            <q-btn flat color="primary" :label="t('audio.editorPlaybackContinue')" @click="confirmPlaybackAction('continue')" />
            <q-btn flat color="primary" :label="t('audio.editorPlaybackPause')" @click="confirmPlaybackAction('pause')" />
            <q-btn color="primary" :label="t('audio.editorPlaybackRestart')" @click="confirmPlaybackAction('restart')" />
          </div>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import type { AudioEditorHistoryEntry, AudioFileKind, AudioRenderState, AudioTransportState } from '@protocol'
import { useQuasar } from 'quasar'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { audioApi } from '../audio-api'
import { useWsService } from '../composables/use-ws'
import { useAudioStore } from '../stores/audio'
import type { GnauralEditorRuntime } from './gnaural-editor-runtime'

type LeaveDecision = 'cancel' | 'discard' | 'save'
type PlaybackAction = 'continue' | 'pause' | 'restart'

interface HistoryPreviewTab {
  readonly id: string
  readonly content: string
  readonly fileName: string
  readonly isAutosave: boolean
  readonly modifiedAtMs: number
  readonly title: string
}

interface EditorScrollPosition {
  readonly left: number
  readonly top: number
}

interface EditorPanelExposed {
  prepareForPathChange: (aNextPath: string | null, aNextFileKind: AudioFileKind | null) => Promise<boolean>
  prepareForExternalMutation: (aFilePath: string) => Promise<boolean>
  reloadCurrentDocumentFromDisk: (aFilePath: string) => Promise<void>
}

type EditorViewInstance = InstanceType<GnauralEditorRuntime['EditorView']>

const STORAGE_PLAYBACK_ACTION = 'mindwave-audio-editor-playback-action'
const AUTOSAVE_INTERVAL_MS = 30_000

const props = defineProps<{
  readonly selectedPath: string | null
  readonly selectedFileKind: AudioFileKind | null
  readonly activeFilePath: string | null
  readonly activePlaybackMode: AudioFileKind | null
  readonly transportState: AudioTransportState
  readonly renderState: AudioRenderState
}>()

const { t } = useI18n()
const wsService = useWsService()
const $q = useQuasar()
const audio = useAudioStore()

const editorHostEl = ref<HTMLDivElement | null>(null)
const activeDocumentId = ref('current')
const currentFilePath = ref<string | null>(null)
const currentContent = ref('')
const lastSavedContent = ref('')
const currentModifiedAtMs = ref<number | null>(null)
const currentDirty = ref(false)
const currentLoading = ref(false)
const currentError = ref<string | null>(null)
const editorRuntimeLoading = ref(false)
const editorRuntimeError = ref<string | null>(null)
const historyEntries = ref<readonly AudioEditorHistoryEntry[]>([])
const historyLoading = ref(false)
const historyLoadingName = ref<string | null>(null)
const historyError = ref<string | null>(null)
const historyDrawerOpen = ref(false)
const previewTabs = ref<readonly HistoryPreviewTab[]>([])
const isSaving = ref(false)
const isRestoring = ref(false)
const autosaveSignature = ref<string | null>(null)

const leaveDialog = reactive({
  isOpen: false,
  resolve: null as ((aValue: LeaveDecision) => void) | null,
})

const restoreDialog = reactive({
  isOpen: false,
  resolve: null as ((aValue: boolean) => void) | null,
})

const playbackDialog = reactive({
  countdownActive: false,
  countdownSeconds: 0,
  isOpen: false,
  remember: false,
  resolve: null as ((aValue: PlaybackAction | null) => void) | null,
  selectedAction: 'continue' as PlaybackAction,
})

let editorRuntimePromise: Promise<GnauralEditorRuntime> | null = null
let editorView: EditorViewInstance | null = null
let loadRequestId = 0
let historyRequestId = 0
let autosaveInterval: ReturnType<typeof setInterval> | null = null
let playbackCountdownTimer: ReturnType<typeof setInterval> | null = null
let editorViewCleanup: (() => void) | null = null

const editorScrollPositions = new Map<string, EditorScrollPosition>()

const activePreviewTab = computed(() => {
  return previewTabs.value.find((tab) => tab.id === activeDocumentId.value) ?? null
})

const currentTabLabel = computed(() => {
  const label = currentFilePath.value === null ? t('audio.editorCurrentTab') : getFileName(currentFilePath.value)
  return currentDirty.value ? `${label} *` : label
})

const canSaveCurrent = computed(() => {
  return props.selectedFileKind === 'gnaural'
    && activeDocumentId.value === 'current'
    && currentFilePath.value !== null
    && currentDirty.value
    && !currentLoading.value
    && !isSaving.value
    && !isRestoring.value
  })

const hasUnsavedChanges = computed(() => {
  return currentDirty.value && currentFilePath.value !== null
})

const createAutosaveStateSignature = (aFilePath: string, aContent: string): string => {
  return `${aFilePath}\n${aContent}`
}

function getFileName(aPath: string): string {
  const segments = aPath.split(/[\\/]/)
  return segments[segments.length - 1] || aPath
}

function formatHistoryDate(aModifiedAtMs: number): string {
  return new Date(aModifiedAtMs).toLocaleString()
}

function loadRememberedPlaybackAction(): PlaybackAction | null {
  try {
    const stored = localStorage.getItem(STORAGE_PLAYBACK_ACTION)
    return stored === 'continue' || stored === 'pause' || stored === 'restart'
      ? stored
      : null
  } catch {
    return null
  }
}

function saveRememberedPlaybackAction(aAction: PlaybackAction | null): void {
  try {
    if (aAction === null) {
      localStorage.removeItem(STORAGE_PLAYBACK_ACTION)
      return
    }

    localStorage.setItem(STORAGE_PLAYBACK_ACTION, aAction)
  } catch {
    // Ignore localStorage failures.
  }
}

function getActiveEditorScrollKey(): string | null {
  if (currentFilePath.value === null) {
    return null
  }

  const previewTab = activePreviewTab.value
  if (previewTab !== null) {
    return `history:${currentFilePath.value}:${previewTab.fileName}`
  }

  return `current:${currentFilePath.value}`
}

function clearEditorViewCleanup(): void {
  editorViewCleanup?.()
  editorViewCleanup = null
}

async function loadEditorRuntime(): Promise<GnauralEditorRuntime> {
  if (editorRuntimePromise === null) {
    editorRuntimePromise = import('./gnaural-editor-runtime').then((module) => module.createGnauralEditorRuntime())
  }

  try {
    return await editorRuntimePromise
  } catch (error) {
    editorRuntimePromise = null
    throw error
  }
}

function captureEditorScrollPosition(
  aView: EditorViewInstance | null = editorView,
  aScrollKey: string | null = getActiveEditorScrollKey(),
): void {
  if (aView === null || aScrollKey === null) {
    return
  }

  editorScrollPositions.set(aScrollKey, {
    left: aView.scrollDOM.scrollLeft,
    top: aView.scrollDOM.scrollTop,
  })
}

function restoreEditorScrollPosition(
  aView: EditorViewInstance,
  aScrollKey: string | null = getActiveEditorScrollKey(),
): void {
  if (aScrollKey === null) {
    return
  }

  const savedPosition = editorScrollPositions.get(aScrollKey)
  if (savedPosition === undefined) {
    return
  }

  requestAnimationFrame(() => {
    if (editorView !== aView) {
      return
    }

    aView.scrollDOM.scrollTo({
      left: savedPosition.left,
      top: savedPosition.top,
    })
  })
}

function bindEditorViewEvents(aView: EditorViewInstance, aScrollKey: string): void {
  clearEditorViewCleanup()

  const handleScroll = (): void => {
    captureEditorScrollPosition(aView, aScrollKey)
  }

  const handleFocusIn = (): void => {
    restoreEditorScrollPosition(aView, aScrollKey)
  }

  const handleFocusOut = (): void => {
    captureEditorScrollPosition(aView, aScrollKey)
  }

  aView.scrollDOM.addEventListener('scroll', handleScroll, { passive: true })
  aView.dom.addEventListener('focusin', handleFocusIn)
  aView.dom.addEventListener('focusout', handleFocusOut)

  editorViewCleanup = () => {
    aView.scrollDOM.removeEventListener('scroll', handleScroll)
    aView.dom.removeEventListener('focusin', handleFocusIn)
    aView.dom.removeEventListener('focusout', handleFocusOut)
  }
}

function destroyEditorView(): void {
  clearEditorViewCleanup()
  editorView?.destroy()
  editorView = null
}

async function renderActiveDocument(): Promise<void> {
  await nextTick()

  if (editorHostEl.value === null || currentFilePath.value === null || currentLoading.value || currentError.value !== null) {
    destroyEditorView()
    return
  }

  const activePreview = activePreviewTab.value
  const documentText = activePreview?.content ?? currentContent.value
  const readOnly = activePreview !== null
  const scrollKey = getActiveEditorScrollKey()

  captureEditorScrollPosition()
  destroyEditorView()

  editorRuntimeLoading.value = true
  editorRuntimeError.value = null

  try {
    const { EditorState, EditorView, basicSetup, xml, oneDark, descriptionTagHighlight } = await loadEditorRuntime()

    if (editorHostEl.value === null || currentFilePath.value === null || currentLoading.value || currentError.value !== null) {
      destroyEditorView()
      return
    }

    editorView = new EditorView({
      state: EditorState.create({
      doc: documentText,
      extensions: [
        basicSetup,
        xml(),
        oneDark,
        descriptionTagHighlight,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({
          '&': {
            backgroundColor: '#0f172a',
            color: '#e2e8f0',
            fontSize: '13px',
            height: '100%',
          },
          '.cm-content, .cm-gutters': {
            fontFamily: "Consolas, 'Courier New', monospace",
          },
          '.cm-gutters': {
            backgroundColor: '#111827',
            borderRight: '1px solid rgba(148, 163, 184, 0.18)',
            color: '#94a3b8',
          },
          '.cm-scroller': {
            overflow: 'auto',
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(148, 163, 184, 0.08)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'rgba(148, 163, 184, 0.08)',
          },
          '.gnaural-editor-panel__description-tag': {
            color: '#f59e0b',
            fontWeight: '700',
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || activeDocumentId.value !== 'current') {
            return
          }

          currentContent.value = update.state.doc.toString()
          currentDirty.value = currentContent.value !== lastSavedContent.value
        })
      ],
      }),
      parent: editorHostEl.value,
    })

    if (scrollKey !== null) {
      bindEditorViewEvents(editorView, scrollKey)
      restoreEditorScrollPosition(editorView, scrollKey)
    }
  } catch (error) {
    editorRuntimeError.value = error instanceof Error ? error.message : t('audio.editorLoading')
    destroyEditorView()
  } finally {
    editorRuntimeLoading.value = false
  }
}

function resetEditorState(): void {
  loadRequestId += 1
  historyRequestId += 1
  captureEditorScrollPosition()
  destroyEditorView()
  activeDocumentId.value = 'current'
  currentFilePath.value = null
  currentContent.value = ''
  lastSavedContent.value = ''
  currentModifiedAtMs.value = null
  currentDirty.value = false
  currentLoading.value = false
  currentError.value = null
  editorRuntimeLoading.value = false
  editorRuntimeError.value = null
  historyEntries.value = []
  historyError.value = null
  previewTabs.value = []
  autosaveSignature.value = null
}

async function reloadHistory(): Promise<void> {
  if (currentFilePath.value === null) {
    historyEntries.value = []
    historyError.value = null
    return
  }

  const requestId = historyRequestId + 1
  historyRequestId = requestId
  historyLoading.value = true
  historyError.value = null

  try {
    const response = await audioApi.fetchEditorHistory(currentFilePath.value)
    if (historyRequestId !== requestId) {
      return
    }

    historyEntries.value = response.items
  } catch (error) {
    if (historyRequestId !== requestId) {
      return
    }

    historyError.value = error instanceof Error ? error.message : t('audio.editorHistoryLoading')
  } finally {
    if (historyRequestId === requestId) {
      historyLoading.value = false
    }
  }
}

async function loadCurrentDocument(aFilePath: string): Promise<void> {
  const requestId = loadRequestId + 1
  loadRequestId = requestId
  captureEditorScrollPosition()
  destroyEditorView()
  currentLoading.value = true
  currentError.value = null
  editorRuntimeError.value = null
  activeDocumentId.value = 'current'
  previewTabs.value = []
  currentFilePath.value = aFilePath

  try {
    const response = await audioApi.fetchEditorDocument(aFilePath)
    if (loadRequestId !== requestId) {
      return
    }

    currentFilePath.value = response.filePath
    currentContent.value = response.content
    lastSavedContent.value = response.content
    currentModifiedAtMs.value = response.modifiedAtMs
    currentDirty.value = false
    autosaveSignature.value = createAutosaveStateSignature(response.filePath, response.content)
    currentLoading.value = false
    await reloadHistory()
    await renderActiveDocument()
  } catch (error) {
    if (loadRequestId !== requestId) {
      return
    }

    currentError.value = error instanceof Error ? error.message : t('audio.editorLoading')
    destroyEditorView()
  } finally {
    if (loadRequestId === requestId) {
      currentLoading.value = false
    }
  }
}

function activateDocument(aDocumentId: string): void {
  captureEditorScrollPosition()
  activeDocumentId.value = aDocumentId
  void renderActiveDocument()
}

async function openHistoryEntry(aEntry: AudioEditorHistoryEntry): Promise<void> {
  if (currentFilePath.value === null) {
    return
  }

  const existing = previewTabs.value.find((tab) => tab.fileName === aEntry.fileName)
  if (existing !== undefined) {
    activateDocument(existing.id)
    return
  }

  historyLoadingName.value = aEntry.fileName

  try {
    const response = await audioApi.fetchEditorHistoryContent(currentFilePath.value, aEntry.fileName)
    const nextTab: HistoryPreviewTab = {
      id: `history:${response.historyFileName}`,
      content: response.content,
      fileName: response.historyFileName,
      isAutosave: response.isAutosave,
      modifiedAtMs: response.modifiedAtMs,
      title: response.historyFileName,
    }

    previewTabs.value = [...previewTabs.value, nextTab]
    activateDocument(nextTab.id)
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : t('audio.editorHistoryLoading') })
  } finally {
    historyLoadingName.value = null
  }
}

function closePreviewTab(aTabId: string): void {
  const wasActive = activeDocumentId.value === aTabId
  if (wasActive) {
    captureEditorScrollPosition()
    activeDocumentId.value = 'current'
  }

  previewTabs.value = previewTabs.value.filter((tab) => tab.id !== aTabId)

  if (wasActive) {
    void renderActiveDocument()
  }
}

async function autosaveCurrentDocument(aUseKeepalive = false): Promise<void> {
  if (
    currentFilePath.value === null
    || !currentDirty.value
  ) {
    return
  }

  const signature = createAutosaveStateSignature(currentFilePath.value, currentContent.value)
  if (autosaveSignature.value === signature) {
    return
  }

  if (aUseKeepalive) {
    void fetch('/api/audio/editor/autosave', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        path: currentFilePath.value,
        content: currentContent.value,
      }),
      keepalive: true,
    })
    autosaveSignature.value = signature
    return
  }

  try {
    await audioApi.autosaveEditorDocument({
      path: currentFilePath.value,
      content: currentContent.value,
    })
    autosaveSignature.value = signature
    await reloadHistory()
  } catch {
    // Ignore autosave failures and keep the user editing.
  }
}

function sendTransportMessage(aMessage: Parameters<typeof wsService.send>[0]): void {
  if (!wsService.send(aMessage)) {
    $q.notify({ type: 'negative', message: t('audio.wsSendFailed') })
  }
}

function stopPlaybackCountdown(): void {
  if (playbackCountdownTimer !== null) {
    clearInterval(playbackCountdownTimer)
    playbackCountdownTimer = null
  }
}

function cancelPlaybackCountdown(): void {
  stopPlaybackCountdown()
  playbackDialog.countdownActive = false
  playbackDialog.countdownSeconds = 0
}

function closePlaybackDialog(aAction: PlaybackAction | null): void {
  stopPlaybackCountdown()
  playbackDialog.countdownActive = false
  playbackDialog.countdownSeconds = 0
  playbackDialog.isOpen = false

  const resolve = playbackDialog.resolve
  playbackDialog.resolve = null
  resolve?.(aAction)
}

function confirmPlaybackAction(aAction: PlaybackAction): void {
  if (playbackDialog.remember) {
    saveRememberedPlaybackAction(aAction)
  } else {
    saveRememberedPlaybackAction(null)
  }

  playbackDialog.selectedAction = aAction
  closePlaybackDialog(aAction)
}

function startPlaybackCountdown(): void {
  stopPlaybackCountdown()
  playbackDialog.countdownActive = true
  playbackDialog.countdownSeconds = 3
  playbackCountdownTimer = setInterval(() => {
    playbackDialog.countdownSeconds -= 1
    if (playbackDialog.countdownSeconds <= 0) {
      confirmPlaybackAction(playbackDialog.selectedAction)
    }
  }, 1000)
}

function promptPlaybackAction(): Promise<PlaybackAction | null> {
  const rememberedAction = loadRememberedPlaybackAction()
  playbackDialog.isOpen = true
  playbackDialog.remember = rememberedAction !== null
  playbackDialog.selectedAction = rememberedAction ?? 'continue'
  playbackDialog.countdownActive = false
  playbackDialog.countdownSeconds = 0

  if (rememberedAction !== null) {
    startPlaybackCountdown()
  }

  return new Promise((resolve) => {
    playbackDialog.resolve = resolve
  })
}

async function handlePostCommitPlayback(aFilePath: string): Promise<void> {
  if (props.renderState === 'rendering' && props.activeFilePath === aFilePath) {
    $q.notify({ type: 'warning', message: t('audio.editorRenderWarning') })
  }

  if (props.activePlaybackMode !== 'gnaural' || props.activeFilePath !== aFilePath || props.transportState === 'idle') {
    return
  }

  const action = await promptPlaybackAction()
  if (action === null || currentFilePath.value === null) {
    return
  }

  if (action === 'restart') {
    sendTransportMessage({ type: 'audio_start', filePath: currentFilePath.value })
    return
  }

  if (action === 'pause' && props.transportState === 'playing') {
    sendTransportMessage({ type: 'audio_pause' })
  }
}

async function saveCurrentDocument(): Promise<boolean> {
  if (currentFilePath.value === null || currentModifiedAtMs.value === null || isSaving.value) {
    return false
  }

  isSaving.value = true

  try {
    const response = await audioApi.saveEditorDocument({
      path: currentFilePath.value,
      content: currentContent.value,
      expectedModifiedAtMs: currentModifiedAtMs.value,
    })

    currentModifiedAtMs.value = response.modifiedAtMs
    lastSavedContent.value = currentContent.value
    currentDirty.value = false
    autosaveSignature.value = createAutosaveStateSignature(currentFilePath.value, currentContent.value)
    await audio.loadGnauralSchedule(currentFilePath.value, true)
    await reloadHistory()
    $q.notify({ type: 'positive', message: response.changed ? t('audio.editorSaved') : t('audio.editorNoChanges') })

    if (response.changed) {
      await handlePostCommitPlayback(currentFilePath.value)
    }

    return true
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : t('audio.editorSave') })
    return false
  } finally {
    isSaving.value = false
  }
}

function promptLeaveDecision(): Promise<LeaveDecision> {
  leaveDialog.isOpen = true
  return new Promise((resolve) => {
    leaveDialog.resolve = resolve
  })
}

function resolveLeaveDialog(aDecision: LeaveDecision): void {
  leaveDialog.isOpen = false
  const resolve = leaveDialog.resolve
  leaveDialog.resolve = null
  resolve?.(aDecision)
}

function promptRestoreConfirmation(): Promise<boolean> {
  restoreDialog.isOpen = true
  return new Promise((resolve) => {
    restoreDialog.resolve = resolve
  })
}

function resolveRestoreDialog(aValue: boolean): void {
  restoreDialog.isOpen = false
  const resolve = restoreDialog.resolve
  restoreDialog.resolve = null
  resolve?.(aValue)
}

async function handleRestoreClick(): Promise<void> {
  const preview = activePreviewTab.value
  if (preview === null || currentFilePath.value === null || currentModifiedAtMs.value === null || isRestoring.value) {
    return
  }

  if (preview.content === currentContent.value) {
    $q.notify({ type: 'info', message: t('audio.editorNoChanges') })
    activateDocument('current')
    return
  }

  const confirmed = await promptRestoreConfirmation()
  if (!confirmed) {
    return
  }

  isRestoring.value = true

  try {
    const response = await audioApi.restoreEditorHistory({
      path: currentFilePath.value,
      historyFileName: preview.fileName,
      expectedModifiedAtMs: currentModifiedAtMs.value,
    })

    currentContent.value = preview.content
    lastSavedContent.value = preview.content
    currentModifiedAtMs.value = response.modifiedAtMs
    currentDirty.value = false
    autosaveSignature.value = createAutosaveStateSignature(currentFilePath.value, preview.content)
    activeDocumentId.value = 'current'
    await audio.loadGnauralSchedule(currentFilePath.value, true)
    await reloadHistory()
    await renderActiveDocument()
    $q.notify({ type: 'positive', message: t('audio.editorRestored') })
    await handlePostCommitPlayback(currentFilePath.value)
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : t('audio.editorRestore') })
  } finally {
    isRestoring.value = false
  }
}

async function handleSaveClick(): Promise<void> {
  await saveCurrentDocument()
}

async function prepareForPathChange(aNextPath: string | null, aNextFileKind: AudioFileKind | null): Promise<boolean> {
  if (!hasUnsavedChanges.value || aNextPath === currentFilePath.value) {
    return true
  }

  const decision = await promptLeaveDecision()
  if (decision === 'cancel') {
    return false
  }

  if (decision === 'discard') {
    return true
  }

  if (aNextFileKind !== 'gnaural' && props.selectedFileKind !== 'gnaural') {
    return true
  }

  return saveCurrentDocument()
}

async function prepareForExternalMutation(aFilePath: string): Promise<boolean> {
  if (!hasUnsavedChanges.value || currentFilePath.value !== aFilePath) {
    return true
  }

  const decision = await promptLeaveDecision()
  if (decision === 'cancel') {
    return false
  }

  if (decision === 'discard') {
    return true
  }

  return saveCurrentDocument()
}

async function reloadCurrentDocumentFromDisk(aFilePath: string): Promise<void> {
  if (props.selectedFileKind !== 'gnaural' || currentFilePath.value !== aFilePath) {
    return
  }

  await loadCurrentDocument(aFilePath)
}

defineExpose<EditorPanelExposed>({
  prepareForPathChange,
  prepareForExternalMutation,
  reloadCurrentDocumentFromDisk,
})

watch(
  () => [props.selectedPath, props.selectedFileKind] as const,
  ([nextPath, nextFileKind]) => {
    if (nextPath === null || nextFileKind !== 'gnaural') {
      resetEditorState()
      return
    }

    if (nextPath === currentFilePath.value && currentError.value === null && !currentLoading.value) {
      return
    }

    void loadCurrentDocument(nextPath)
  },
  { immediate: true }
)

onMounted(() => {
  autosaveInterval = setInterval(() => {
    void autosaveCurrentDocument()
  }, AUTOSAVE_INTERVAL_MS)

  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('pagehide', handlePageHide)
})

onBeforeRouteLeave(async () => {
  return prepareForPathChange(null, null)
})

onBeforeUnmount(() => {
  stopPlaybackCountdown()
  if (autosaveInterval !== null) {
    clearInterval(autosaveInterval)
    autosaveInterval = null
  }

  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('pagehide', handlePageHide)
  captureEditorScrollPosition()
  destroyEditorView()
})

function handleBeforeUnload(): void {
  if (!hasUnsavedChanges.value) {
    return
  }

  void autosaveCurrentDocument(true)
}

function handlePageHide(): void {
  if (!hasUnsavedChanges.value) {
    return
  }

  void autosaveCurrentDocument(true)
}
</script>

<style scoped>
.gnaural-editor-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.gnaural-editor-panel__toolbar {
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px 16px;
}

.gnaural-editor-panel__tabs {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
  overflow: auto;
}

.gnaural-editor-panel__tab {
  align-items: center;
  background: transparent;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px 8px 0 0;
  color: #475569;
  cursor: pointer;
  display: inline-flex;
  gap: 4px;
  max-width: 280px;
  min-width: 0;
  padding: 7px 10px 7px 14px;
  transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}

.gnaural-editor-panel__tab:hover {
  border-color: rgba(148, 163, 184, 0.42);
  color: #334155;
}

.gnaural-editor-panel__tab--active {
  background: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  color: #0f172a;
}

.gnaural-editor-panel__tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gnaural-editor-panel__tab-close {
  flex: 0 0 auto;
}

.gnaural-editor-panel__tab:deep(.q-btn) {
  color: inherit;
}

.gnaural-editor-panel__toolbar-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.gnaural-editor-panel__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.gnaural-editor-panel__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  padding: 16px;
}

.gnaural-editor-panel__status-row {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.gnaural-editor-panel__path {
  color: #475569;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gnaural-editor-panel__editor {
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 12px;
  flex: 1 1 auto;
  min-height: 320px;
  overflow: hidden;
}

.gnaural-editor-panel__history {
  background: #0f172a;
  border-left: 1px solid rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
  display: flex;
  flex: 0 0 0;
  flex-direction: column;
  max-width: 0;
  min-width: 0;
  overflow: hidden;
  transition: flex-basis 0.18s ease, max-width 0.18s ease;
}

.gnaural-editor-panel__history--open {
  flex-basis: 320px;
  max-width: 320px;
}

.gnaural-editor-panel__history-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  padding: 16px;
}

.gnaural-editor-panel__history-header .text-subtitle2 {
  color: #f8fafc;
}

.gnaural-editor-panel__history-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.gnaural-editor-panel__history-list:deep(.q-item) {
  color: #e2e8f0;
}

.gnaural-editor-panel__history-list:deep(.q-item__label) {
  color: #e2e8f0;
}

.gnaural-editor-panel__history-list:deep(.q-item__label--caption) {
  color: #94a3b8;
}

.gnaural-editor-panel__history-list:deep(.q-item.q-item--clickable:hover) {
  background: rgba(148, 163, 184, 0.08);
}

.gnaural-editor-panel__history-list:deep(.q-list--separator > .q-item-type + .q-item-type) {
  border-top-color: rgba(148, 163, 184, 0.12);
}

.gnaural-editor-panel__history-empty {
  align-items: center;
  color: #94a3b8;
  display: flex;
  justify-content: center;
  min-height: 140px;
  padding: 16px;
  text-align: center;
}

.gnaural-editor-panel__history-item--active {
  background: rgba(59, 130, 246, 0.2);
  color: #f8fafc;
}

.gnaural-editor-panel__playback-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 960px) {
  .gnaural-editor-panel__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .gnaural-editor-panel__toolbar-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .gnaural-editor-panel__body {
    flex-direction: column;
  }

  .gnaural-editor-panel__history,
  .gnaural-editor-panel__history--open {
    border-left: 0;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    flex-basis: 240px;
    max-width: none;
  }
}
</style>