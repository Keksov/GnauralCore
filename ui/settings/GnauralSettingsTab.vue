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
  </q-card>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAudioStore } from '../stores/audio'

const audio = useAudioStore()
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
</style>