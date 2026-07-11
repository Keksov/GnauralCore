<template>
  <q-card flat bordered class="gnaural-settings-tab">
    <q-card-section>
      <div class="text-h6">{{ $t('settings.audioTitle') }}</div>
      <div class="text-caption text-grey-7">{{ $t('settings.audioSubtitle') }}</div>
    </q-card-section>

    <q-separator />

    <q-card-section class="gnaural-settings-tab__form">
      <q-input
        v-model="presetsRootDraft"
        :label="$t('settings.audioPresetsRoot')"
        dense
        outlined
        spellcheck="false"
      />
      <div class="gnaural-settings-tab__actions">
        <q-btn color="primary" :label="$t('settings.audioSave')" :loading="audio.settingsLoading" @click="saveAudioSettings" />
        <q-btn flat color="primary" icon="refresh" :label="$t('settings.audioRefreshPresets')" :loading="audio.presetsLoading" @click="refreshAudioPresets" />
      </div>
      <q-banner v-if="audioMessage !== null" dense rounded :class="audioMessageClass">
        {{ audioMessage }}
      </q-banner>
      <div class="text-caption text-grey-7">
        {{ $t('settings.audioPresetsRootHint') }}
      </div>
    </q-card-section>

    <q-separator />

    <!-- GT6.2 (owner req. 13, GT-D11): audio cache management. -->
    <q-card-section class="gnaural-settings-tab__form">
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
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useAudioStore } from '../stores/audio'
import { audioApi, type AudioCacheSummary } from '../audio-api'

const audio = useAudioStore()
const { t } = useI18n()
const $q = useQuasar()

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
  $q.dialog({ title: t('settings.cacheDeleteSource'), message: t('settings.cacheConfirmSource'), cancel: true, persistent: true })
    .onOk(async () => {
      await audioApi.deleteAudioCache({ source: sourcePath }).catch(() => undefined)
      await loadCache()
    })
}
function clearAllCache(): void {
  $q.dialog({ title: t('settings.cacheClearAll'), message: t('settings.cacheConfirmAll'), cancel: true, persistent: true })
    .onOk(async () => {
      await audioApi.deleteAudioCache({ all: true }).catch(() => undefined)
      await loadCache()
    })
}
const presetsRootDraft = ref('')
const audioMessage = ref<string | null>(null)
const audioMessageClass = ref('bg-grey-2 text-grey-9')
let audioMessageTimer: ReturnType<typeof setTimeout> | null = null

function clearAudioMessageTimer(): void {
  if (audioMessageTimer !== null) {
    clearTimeout(audioMessageTimer)
    audioMessageTimer = null
  }
}

function setAudioMessage(message: string | null, cssClass: string, autoClear = false): void {
  clearAudioMessageTimer()
  audioMessage.value = message
  audioMessageClass.value = cssClass

  if (autoClear && message !== null) {
    audioMessageTimer = setTimeout(() => {
      audioMessage.value = null
      audioMessageTimer = null
    }, 4000)
  }
}

async function saveAudioSettings() {
  const saved = await audio.saveSettings(presetsRootDraft.value)
  if (!saved) {
    setAudioMessage(audio.lastError, 'bg-red-1 text-red-10')
    return
  }

  presetsRootDraft.value = audio.settings.presetsRoot
  await audio.refreshPresets()

  if (audio.lastError !== null) {
    setAudioMessage(audio.lastError, 'bg-red-1 text-red-10')
    return
  }

  setAudioMessage('OK', 'bg-green-1 text-green-10', true)
}

async function refreshAudioPresets() {
  await audio.refreshPresets()
  if (audio.lastError !== null) {
    setAudioMessage(audio.lastError, 'bg-red-1 text-red-10')
    return
  }

  setAudioMessage('OK', 'bg-green-1 text-green-10', true)
}

onMounted(async () => {
  await audio.loadSettings()
  presetsRootDraft.value = audio.settings.presetsRoot

  if (audio.lastError !== null) {
    setAudioMessage(audio.lastError, 'bg-red-1 text-red-10')
  }
  void loadCache()
})

onBeforeUnmount(() => {
  clearAudioMessageTimer()
})
</script>

<style scoped>
.gnaural-settings-tab {
  max-width: 720px;
}

.gnaural-settings-tab__form {
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