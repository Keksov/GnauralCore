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

import { useSpectrogram } from '../composables/use-spectrogram'
import { chooseZoom, tileToImage, type SpectrogramRenderOptions } from '../composables/spectrogram-render'

// U2.2: render SpectrumCore worker tiles on a canvas (replaces the old client-side
// Goertzel path). The frequency axis is fscale-correct by construction -- the
// worker returns display bins already mapped per fscale (binFrequenciesHz), so we
// draw them in order. Intensity/palette transforms are basic here; U2.3 adds the
// full scale family + palettes, U3.1 adds the axis/ruler chrome.

interface Props {
  filePath: string | null
  /** Client-side render transform (scale/gain/drange/limit/palette/saturation),
      applied live on the cached linear tiles -- no worker re-analysis (DU5). */
  render?: Partial<SpectrogramRenderOptions>
}

const props = defineProps<Props>()
const { t } = useI18n()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const spec = useSpectrogram()

const MAX_VIEW_BINS = 512
let renderFrameId = 0
let resizeObserver: ResizeObserver | null = null
let offscreen: HTMLCanvasElement | null = null

function getOffscreen(aWidth: number, aHeight: number): HTMLCanvasElement {
  if (offscreen === null) {
    offscreen = document.createElement('canvas')
  }
  if (offscreen.width !== aWidth) offscreen.width = aWidth
  if (offscreen.height !== aHeight) offscreen.height = aHeight
  return offscreen
}

function draw(): void {
  const canvas = canvasEl.value
  if (canvas === null) return
  const ctx = canvas.getContext('2d')
  if (ctx === null) return

  const cssWidth = Math.max(1, Math.floor(canvas.clientWidth))
  const cssHeight = Math.max(1, Math.floor(canvas.clientHeight))
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  const analysis = spec.analysis.value
  const tiles = spec.tiles.value
  if (analysis === null || analysis.frameCount <= 0 || tiles.length === 0) return

  ctx.imageSmoothingEnabled = true
  for (const tile of tiles) {
    const image = tileToImage(tile, props.render)
    if (image.width === 0 || image.height === 0) continue
    const off = getOffscreen(image.width, image.height)
    const offCtx = off.getContext('2d')
    if (offCtx === null) continue
    offCtx.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0)
    const x = (tile.frameStart / analysis.frameCount) * cssWidth
    const w = (tile.frameCount / analysis.frameCount) * cssWidth
    ctx.drawImage(off, 0, 0, image.width, image.height, x, 0, Math.ceil(w) + 1, cssHeight)
  }
}

function scheduleDraw(): void {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0
    draw()
  })
}

function applyView(): void {
  const analysis = spec.analysis.value
  const canvas = canvasEl.value
  if (analysis === null || canvas === null) return
  const columns = Math.max(1, Math.floor(canvas.clientWidth))
  const viewBinCount = Math.max(16, Math.min(MAX_VIEW_BINS, Math.floor(canvas.clientHeight)))
  spec.setView({
    timeStartSec: 0,
    timeEndSec: analysis.durationSec,
    zoom: chooseZoom(analysis.frameCount, columns),
    viewBinCount,
  })
}

async function openForPath(aFilePath: string | null): Promise<void> {
  await spec.close()
  if (aFilePath === null || aFilePath === '') {
    scheduleDraw()
    return
  }
  try {
    await spec.open({ filePath: aFilePath, window: 2048, hop: 512 })
    applyView()
  } catch {
    // surfaced via spec.error
  }
}

watch(() => props.filePath, (value) => {
  void openForPath(value)
})

watch([spec.tiles, spec.analysis], () => {
  scheduleDraw()
})

// render-only transform changes (scale/gain/drange/limit/palette/saturation):
// redraw the cached tiles, no refetch (DU5).
watch(() => props.render, () => {
  scheduleDraw()
}, { deep: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value !== null) {
    resizeObserver = new ResizeObserver(() => {
      applyView()
      scheduleDraw()
    })
    resizeObserver.observe(canvasEl.value)
  }
  void openForPath(props.filePath)
})

onBeforeUnmount(() => {
  if (renderFrameId !== 0) cancelAnimationFrame(renderFrameId)
  if (resizeObserver !== null) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  void spec.close()
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
