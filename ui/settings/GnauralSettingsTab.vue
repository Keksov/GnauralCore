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
import { onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { audioApi, type AudioCacheSummary } from '../audio-api'
import { projectApi } from '../project-api'
import type { ProjectSettingsResponse } from '@protocol'

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

onMounted(() => {
  void loadCache()
  void loadProjectSettings()
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
