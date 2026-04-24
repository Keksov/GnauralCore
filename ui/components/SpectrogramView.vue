<template>
  <div class="spectrogram-view">
    <canvas
      ref="canvasEl"
      class="spectrogram-view__canvas"
      role="img"
      :aria-label="t('audio.spectrogramCanvasLabel')"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  audioBuffer: AudioBuffer | null
}

const props = defineProps<Props>()
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)

let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null

function mergeChannels(audioBuffer: AudioBuffer): Float32Array {
  const sampleCount = audioBuffer.length
  const channelCount = audioBuffer.numberOfChannels
  const merged = new Float32Array(sampleCount)

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex)
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      merged[sampleIndex] += channelData[sampleIndex] / channelCount
    }
  }

  return merged
}

function getGoertzelMagnitude(
  samples: Float32Array,
  startIndex: number,
  sampleCount: number,
  normalizedFrequency: number,
): number {
  const clampedFrequency = Math.max(0, Math.min(0.5, normalizedFrequency))
  const coefficient = 2 * Math.cos(2 * Math.PI * clampedFrequency)
  let previousSample = 0
  let previousPreviousSample = 0

  for (let sampleOffset = 0; sampleOffset < sampleCount; sampleOffset += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * sampleOffset) / (sampleCount - 1))
    const currentSample = samples[startIndex + sampleOffset] * window
      + coefficient * previousSample
      - previousPreviousSample

    previousPreviousSample = previousSample
    previousSample = currentSample
  }

  return previousSample * previousSample
    + previousPreviousSample * previousPreviousSample
    - coefficient * previousSample * previousPreviousSample
}

function getSpectrogramColor(value: number): string {
  const normalized = Math.max(0, Math.min(1, value))
  const hue = 220 - normalized * 180
  const saturation = 82
  const lightness = 10 + normalized * 62
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

function renderSpectrogram(): void {
  const canvas = canvasEl.value
  if (canvas === null) {
    return
  }

  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return
  }

  const width = Math.max(1, Math.floor(canvas.clientWidth))
  const height = Math.max(1, Math.floor(canvas.clientHeight))
  const pixelRatio = window.devicePixelRatio || 1

  canvas.width = Math.max(1, Math.floor(width * pixelRatio))
  canvas.height = Math.max(1, Math.floor(height * pixelRatio))
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width, height)

  if (props.audioBuffer === null || props.audioBuffer.length < 32) {
    return
  }

  const merged = mergeChannels(props.audioBuffer)
  const sliceCount = Math.max(64, Math.min(width, 320))
  const binCount = Math.max(48, Math.min(height, 112))
  const windowSize = Math.min(1024, merged.length)
  const maxStartIndex = Math.max(0, merged.length - windowSize)
  const hopSize = sliceCount > 1 ? Math.max(1, Math.floor(maxStartIndex / (sliceCount - 1))) : 1
  const minFrequency = 40
  const maxFrequency = Math.max(minFrequency, Math.min(props.audioBuffer.sampleRate / 2, 16000))
  const sliceWidth = width / sliceCount
  const binHeight = height / binCount
  const spectrogram: number[][] = []
  let globalPeak = Number.MIN_VALUE

  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
    const startIndex = Math.min(sliceIndex * hopSize, maxStartIndex)
    const row: number[] = []

    for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
      const ratio = binCount === 1 ? 0 : binIndex / (binCount - 1)
      const frequency = minFrequency * Math.pow(maxFrequency / minFrequency, ratio)
      const magnitude = getGoertzelMagnitude(
        merged,
        startIndex,
        windowSize,
        frequency / props.audioBuffer.sampleRate,
      )

      row.push(magnitude)
      globalPeak = Math.max(globalPeak, magnitude)
    }

    spectrogram.push(row)
  }

  const peak = globalPeak > 0 ? globalPeak : 1

  for (let sliceIndex = 0; sliceIndex < spectrogram.length; sliceIndex += 1) {
    const row = spectrogram[sliceIndex]
    for (let binIndex = 0; binIndex < row.length; binIndex += 1) {
      const normalized = Math.sqrt(row[binIndex] / peak)
      const y = height - (binIndex + 1) * binHeight
      ctx.fillStyle = getSpectrogramColor(normalized)
      ctx.fillRect(sliceIndex * sliceWidth, y, Math.ceil(sliceWidth) + 1, Math.ceil(binHeight) + 1)
    }
  }
}

function scheduleRender(): void {
  if (renderFrameId !== 0) {
    cancelAnimationFrame(renderFrameId)
  }

  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0
    renderSpectrogram()
  })
}

watch(() => props.audioBuffer, () => {
  scheduleRender()
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => {
      scheduleRender()
    })
    resizeObserver.observe(canvasEl.value)
  }

  scheduleRender()
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) {
    cancelAnimationFrame(renderFrameId)
  }

  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<style scoped>
.spectrogram-view {
  background: #0f172a;
  border-radius: 12px;
  min-height: 280px;
  overflow: hidden;
  width: 100%;
}

.spectrogram-view__canvas {
  display: block;
  height: 100%;
  min-height: 280px;
  width: 100%;
}
</style>