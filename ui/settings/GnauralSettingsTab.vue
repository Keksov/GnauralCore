<template>
  <!-- GT10.45 (owner 2026-07-13): cache-only settings, no wrapping card/frame — the dialog's right
       pane already provides the container. The "Audio presets" block was removed. -->
  <div class="gnaural-settings-tab">
    <!-- project-store PR3.1 (PR-D6, owner req 3/8): the user-data folder where per-file project
         folders live. Empty = the built-in default (%LOCALAPPDATA%\KKSoundCore). -->
    <div>
      <div class="text-h6">{{ $t('settings.projectsTitle') }}</div>
      <div class="text-caption text-grey-7">{{ $t('settings.projectsSubtitle') }}</div>
    </div>
    <q-input
      v-model="userDataRoot"
      dense
      outlined
      :label="$t('settings.projectsRootLabel')"
      :placeholder="projectSettings?.effectiveUserDataRoot ?? ''"
      :hint="$t('settings.projectsRootHint', { effective: projectSettings?.effectiveUserDataRoot ?? '' })"
      :error="projectsError !== null"
      :error-message="projectsError ?? undefined"
      :loading="projectsSaving"
    >
      <template #after>
        <q-btn
          flat
          dense
          :label="$t('settings.projectsRootSave')"
          :disable="projectsSaving || userDataRoot === (projectSettings?.userDataRoot ?? '')"
          @click="saveProjectSettings"
        />
      </template>
    </q-input>

    <!-- project-store PR4.1-PR4.3 + PR5.1/PR5.2: the projects list — status, re-link, delete,
         orphan GC, one-file export/import, reveal in Explorer. -->
    <div class="row items-center no-wrap">
      <div class="text-subtitle2">{{ $t('settings.projectsListTitle') }}</div>
      <q-space />
      <q-btn flat dense round icon="refresh" :loading="projectsLoading" :aria-label="$t('settings.projectsRefresh')" @click="loadProjects" />
      <q-btn flat dense icon="upload_file" :label="$t('settings.projectsImport')" @click="pickImportFile" />
      <q-btn
        v-if="orphanCount > 0"
        flat
        dense
        color="negative"
        icon="auto_delete"
        :label="`${$t('settings.projectsGc')} (${orphanCount})`"
        @click="gcOrphans"
      />
      <input ref="importInputRef" type="file" accept=".json,.scpexport.json" class="hidden" @change="onImportFilePicked" />
    </div>

    <q-list v-if="projects.length > 0" bordered separator class="rounded-borders">
      <q-item v-for="project in projects" :key="project.id" dense>
        <q-item-section>
          <q-item-label>
            {{ sourceBaseName(project) }}
            <q-badge v-if="project.sourceStatus === 'missing'" color="negative" class="q-ml-sm">
              {{ $t('settings.projectsMissing') }}
            </q-badge>
          </q-item-label>
          <q-item-label caption class="gnaural-settings-tab__path">{{ project.source.path }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row no-wrap items-center">
            <q-btn flat dense round size="sm" icon="link" :aria-label="$t('settings.projectsRelink')" @click="relinkProject(project)" />
            <q-btn flat dense round size="sm" icon="download" :aria-label="$t('settings.projectsExport')" @click="exportProject(project)" />
            <q-btn flat dense round size="sm" icon="folder_open" :aria-label="$t('settings.projectsReveal')" @click="revealProject(project)" />
            <q-btn flat dense round size="sm" icon="delete" color="negative" :aria-label="$t('settings.projectsDelete')" @click="deleteProject(project)" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
    <div v-else class="text-caption text-grey-7">{{ $t('settings.projectsEmpty') }}</div>

    <q-separator />

    <!-- GT6.2 (owner req. 13, GT-D11): audio cache management. -->
    <div class="row items-center no-wrap">
      <div>
        <div class="text-h6">{{ $t('settings.cacheTitle') }}</div>
        <div class="text-caption text-grey-7">{{ $t('settings.cacheSubtitle') }}</div>
      </div>
      <q-space />
      <q-btn flat dense round icon="refresh" :loading="cacheLoading" :aria-label="$t('settings.cacheRefresh')" @click="loadCache" />
    </div>

    <q-banner v-if="cacheError !== null" dense rounded class="bg-red-1 text-red-10">{{ cacheError }}</q-banner>
    <template v-else-if="cacheSummary !== null">
      <div class="text-body2">{{ $t('settings.cacheTotal') }}: <b>{{ formatBytes(cacheSummary.totalBytes) }}</b></div>

      <q-list v-if="cacheSummary.sources.length > 0" bordered class="rounded-borders">
        <q-expansion-item v-for="src in cacheSummary.sources" :key="src.sourcePath" dense>
          <template #header>
            <q-item-section>
              <q-item-label>{{ src.sourceName }}</q-item-label>
              <q-item-label caption class="gnaural-settings-tab__path">{{ src.sourcePath }}</q-item-label>
            </q-item-section>
            <q-item-section side>{{ formatBytes(src.totalBytes) }}</q-item-section>
            <q-item-section side>
              <q-btn flat dense round icon="delete" color="negative" :aria-label="$t('settings.cacheDeleteSource')" @click.stop="deleteSource(src.sourcePath)" />
            </q-item-section>
          </template>
          <q-list dense>
            <q-item v-for="e in src.entries" :key="e.cacheFile">
              <q-item-section><q-item-label caption>{{ e.discriminator || e.kind }} · {{ e.kind }}</q-item-label></q-item-section>
              <q-item-section side>{{ formatBytes(e.bytes) }}</q-item-section>
              <q-item-section side>
                <q-btn flat dense round size="sm" icon="close" :aria-label="$t('settings.cacheDeleteEntry')" @click="deleteEntry(e.cacheFile)" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
      </q-list>
      <div v-else class="text-caption text-grey-7">{{ $t('settings.cacheEmpty') }}</div>

      <div v-if="cacheSummary.orphans.length > 0" class="text-caption text-grey-7">
        {{ $t('settings.cacheOrphans') }} — {{ formatBytes(cacheSummary.orphanBytes) }} ({{ cacheSummary.orphans.length }})
      </div>

      <div class="gnaural-settings-tab__actions">
        <q-btn flat color="negative" icon="delete_sweep" :label="$t('settings.cacheClearAll')" :disable="cacheSummary.totalBytes === 0" @click="clearAllCache" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { audioApi, type AudioCacheSummary } from '../audio-api'
import { projectApi } from '../project-api'
import type { ProjectInfo, ProjectSettingsResponse } from '@protocol'

const { t } = useI18n()
const $q = useQuasar()

// project-store PR3.1: the user-data root behind the projects subsystem.
const projectSettings = ref<ProjectSettingsResponse | null>(null)
const userDataRoot = ref('')
const projectsSaving = ref(false)
const projectsError = ref<string | null>(null)

async function loadProjectSettings(): Promise<void> {
  try {
    projectSettings.value = await projectApi.fetchProjectSettings()
    userDataRoot.value = projectSettings.value.userDataRoot
    projectsError.value = null
  } catch (error) {
    projectsError.value = error instanceof Error ? error.message : 'Failed to load the project settings.'
  }
}

function saveProjectSettings(): void {
  // PR3.2: changing the folder offers to copy the existing projects tree over (the old folder is
  // never deleted). Dismissing the dialog aborts the save entirely.
  $q.dialog({
    title: t('settings.projectsMigrateTitle'),
    message: t('settings.projectsMigrateMessage'),
    ok: { label: t('settings.projectsMigrateCopy') },
    cancel: { label: t('settings.projectsMigrateSkip'), flat: true },
  })
    .onOk(() => {
      void doSaveProjectSettings(true)
    })
    .onCancel(() => {
      void doSaveProjectSettings(false)
    })
}

async function doSaveProjectSettings(migrate: boolean): Promise<void> {
  projectsSaving.value = true
  projectsError.value = null
  try {
    projectSettings.value = await projectApi.updateProjectSettings({ userDataRoot: userDataRoot.value.trim(), migrate })
    userDataRoot.value = projectSettings.value.userDataRoot
    const migrated = projectSettings.value.migrated
    $q.notify({
      type: 'positive',
      message: migrated !== undefined
        ? t('settings.projectsMigrated', { copied: migrated.copied, skipped: migrated.skipped })
        : t('settings.projectsRootSaved'),
    })
  } catch (error) {
    projectsError.value = error instanceof Error ? error.message : 'Failed to save the project settings.'
  } finally {
    projectsSaving.value = false
  }
}

// GT6.2: audio cache summary + management.
const cacheSummary = ref<AudioCacheSummary | null>(null)
const cacheLoading = ref(false)
const cacheError = ref<string | null>(null)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(1)} ${units[i]}`
}
async function loadCache(): Promise<void> {
  cacheLoading.value = true
  cacheError.value = null
  try {
    cacheSummary.value = await audioApi.fetchAudioCacheSummary()
  } catch (error) {
    cacheError.value = error instanceof Error ? error.message : 'Failed to load the audio cache.'
  } finally {
    cacheLoading.value = false
  }
}
async function deleteEntry(cacheFile: string): Promise<void> {
  await audioApi.deleteAudioCache({ cacheFile }).catch(() => undefined)
  await loadCache()
}
function deleteSource(sourcePath: string): void {
  $q.dialog({ title: t('settings.cacheDeleteSource'), message: t('settings.cacheConfirmSource'), cancel: { label: t('audio.cancel'), flat: true }, persistent: true })
    .onOk(async () => {
      await audioApi.deleteAudioCache({ source: sourcePath }).catch(() => undefined)
      await loadCache()
    })
}
function clearAllCache(): void {
  $q.dialog({ title: t('settings.cacheClearAll'), message: t('settings.cacheConfirmAll'), cancel: { label: t('audio.cancel'), flat: true }, persistent: true })
    .onOk(async () => {
      await audioApi.deleteAudioCache({ all: true }).catch(() => undefined)
      await loadCache()
    })
}

// project-store PR4.1-PR4.3 + PR5.1/PR5.2: the projects list and its actions.
const projects = ref<readonly ProjectInfo[]>([])
const projectsLoading = ref(false)
const importInputRef = ref<HTMLInputElement | null>(null)
const orphanCount = computed(() => projects.value.filter((p) => p.sourceStatus === 'missing').length)

function sourceBaseName(project: ProjectInfo): string {
  return project.source.path.split(/[\\/]/u).pop() ?? project.id
}

async function loadProjects(): Promise<void> {
  projectsLoading.value = true
  try {
    projects.value = (await projectApi.fetchProjects()).projects
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Failed to load the projects list.' })
  } finally {
    projectsLoading.value = false
  }
}

function relinkProject(project: ProjectInfo): void {
  $q.dialog({
    title: t('settings.projectsRelink'),
    message: t('settings.projectsRelinkTitle'),
    prompt: { model: project.source.path, type: 'text' },
    cancel: { label: t('audio.cancel'), flat: true },
    persistent: false,
  }).onOk((value: string) => {
    void projectApi
      .relinkProject({ id: project.id, path: value.trim() })
      .then(loadProjects)
      .catch((error: unknown) => {
        $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Re-link failed.' })
      })
  })
}

function deleteProject(project: ProjectInfo): void {
  $q.dialog({
    title: t('settings.projectsDelete'),
    message: t('settings.projectsDeleteConfirm', { name: sourceBaseName(project) }),
    cancel: { label: t('audio.cancel'), flat: true },
    persistent: true,
  }).onOk(() => {
    void projectApi
      .deleteProject(project.id)
      .then(loadProjects)
      .catch((error: unknown) => {
        $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Delete failed.' })
      })
  })
}

function gcOrphans(): void {
  const orphans = projects.value.filter((p) => p.sourceStatus === 'missing')
  if (orphans.length === 0) return
  $q.dialog({
    title: t('settings.projectsGc'),
    message: t('settings.projectsGcConfirm', { count: orphans.length }),
    cancel: { label: t('audio.cancel'), flat: true },
    persistent: true,
  }).onOk(() => {
    void (async () => {
      for (const orphan of orphans) {
        await projectApi.deleteProject(orphan.id).catch(() => undefined)
      }
      await loadProjects()
    })()
  })
}

async function exportProject(project: ProjectInfo): Promise<void> {
  try {
    const bundle = await projectApi.exportProject(project.id)
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${project.id}.scpexport.json`
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Export failed.' })
  }
}

function revealProject(project: ProjectInfo): void {
  void projectApi.revealProject(project.id).catch((error: unknown) => {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Reveal failed.' })
  })
}

function pickImportFile(): void {
  importInputRef.value?.click()
}

async function onImportFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return

  let bundle: unknown
  try {
    bundle = JSON.parse(await file.text()) as unknown
  } catch {
    $q.notify({ type: 'negative', message: t('settings.projectsImportInvalid') })
    return
  }

  try {
    await projectApi.importProject(bundle, false)
    $q.notify({ type: 'positive', message: t('settings.projectsImported') })
    await loadProjects()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // 409: a project for this source already exists — the explicit-choice escape hatch (PR-D10).
    if (message.includes('already exists')) {
      $q.dialog({
        title: t('settings.projectsImport'),
        message: t('settings.projectsImportConflict'),
        cancel: { label: t('audio.cancel'), flat: true },
        persistent: true,
      }).onOk(() => {
        void projectApi
          .importProject(bundle, true)
          .then(async () => {
            $q.notify({ type: 'positive', message: t('settings.projectsImported') })
            await loadProjects()
          })
          .catch((retryError: unknown) => {
            $q.notify({ type: 'negative', message: retryError instanceof Error ? retryError.message : 'Import failed.' })
          })
      })
      return
    }

    $q.notify({ type: 'negative', message: message || 'Import failed.' })
  }
}

onMounted(() => {
  void loadCache()
  void loadProjectSettings()
  void loadProjects()
})
</script>

<style scoped>
.gnaural-settings-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gnaural-settings-tab__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.gnaural-settings-tab__path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
