<template>
  <!-- GT10.45 (owner 2026-07-13): cache-only settings, no wrapping card/frame — the dialog's right
       pane already provides the container. The "Audio presets" block was removed. -->
  <div class="gnaural-settings-tab">
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
