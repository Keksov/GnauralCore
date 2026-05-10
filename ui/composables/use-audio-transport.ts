import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AudioFileKind, BrowserMessage } from '@protocol'
import { useI18n } from 'vue-i18n'
import { useWsService } from './use-ws'
import { useAudioStore } from '../stores/audio'

type LocalAudioFileKind = Exclude<AudioFileKind, 'gnaural'>

function isLocalAudioFileKind(fileKind: AudioFileKind | null): fileKind is LocalAudioFileKind {
  return fileKind === 'wav' || fileKind === 'flac'
}

export function formatAudioTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '00:00'
  }

  const totalSeconds = Math.floor(value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function useAudioTransport() {
  const { t } = useI18n()
  const wsService = useWsService()
  const audio = useAudioStore()
  const optimisticSeekPositionSec = ref<number | null>(null)
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

  const canSeek = computed(() => {
    if (!audio.canSeek) {
      return false
    }

    if (audio.activePlaybackMode === 'gnaural' || (audio.activePlaybackMode === null && audio.displayMode === 'gnaural')) {
      return wsService.connectionState.value === 'connected'
    }

    return true
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

  const displayedPositionSec = computed(() => {
    return optimisticSeekPositionSec.value ?? audio.positionSec
  })

  const positionLabel = computed(() => {
    return formatAudioTime(displayedPositionSec.value)
  })

  const durationLabel = computed(() => {
    return formatAudioTime(audio.durationSec)
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
    const sliderMax = audio.durationSec > 0 ? audio.durationSec : 1
    return Math.max(0, Math.min(value, sliderMax))
  }

  function setOptimisticSeekPosition(value: number): void {
    clearOptimisticSeekResetTimer()
    optimisticSeekPositionSec.value = clampSeekValue(value)
    optimisticSeekResetTimer = setTimeout(() => {
      optimisticSeekPositionSec.value = null
      optimisticSeekResetTimer = null
    }, 1500)
  }

  function sendAudioMessage(message: BrowserMessage, fallbackMessage = t('audio.wsSendFailed')): boolean {
    if (!wsService.send(message)) {
      audio.setClientError(fallbackMessage)
      return false
    }

    return true
  }

  function pausePlayback(): void {
    if (isLocalAudioFileKind(audio.activePlaybackMode)) {
      audio.pauseLocalPlayback()
      return
    }

    sendAudioMessage({ type: 'audio_pause' })
  }

  function resumePlayback(): void {
    if (isLocalAudioFileKind(audio.activePlaybackMode)) {
      void audio.resumeLocalPlayback()
      return
    }

    sendAudioMessage({ type: 'audio_resume' })
  }

  function stopPlayback(): void {
    if (isLocalAudioFileKind(audio.activePlaybackMode)) {
      audio.stopLocalPlayback()
      return
    }

    sendAudioMessage({ type: 'audio_stop' })
  }

  function handlePauseResume(): void {
    if (audio.canResume) {
      resumePlayback()
      return
    }

    pausePlayback()
  }

  function handleSeek(value: number | null): void {
    if (value === null) {
      return
    }

    const nextPositionSec = clampSeekValue(value)
    setOptimisticSeekPosition(nextPositionSec)

    if (isLocalAudioFileKind(audio.activePlaybackMode) || isLocalAudioFileKind(audio.displayMode)) {
      audio.seekLocalPlayback(nextPositionSec)
      return
    }

    if (!sendAudioMessage({ type: 'audio_seek', positionSec: nextPositionSec })) {
      clearOptimisticSeekPosition()
    }
  }

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

  onBeforeUnmount(() => {
    clearOptimisticSeekPosition()
  })

  return {
    audio,
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
  }
}