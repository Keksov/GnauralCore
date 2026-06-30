import type { SpectrogramTile } from '@protocol'

// Pure (canvas-free) rendering helpers for the spectrogram view (U2.2): map the
// worker's linear-magnitude tiles to RGBA pixels. U2.2 ships a basic dB+range
// grayscale intensity; U2.3 adds the full scale family + palettes + gain/limit/
// saturation. Kept Vue/DOM-free so it is unit-testable.

export interface IntensityOptions {
  /** Dynamic range in dB (0 dB maps to 1.0, -drange dB maps to 0.0). */
  readonly drange?: number
  /** Linear gain applied before the dB mapping. */
  readonly gain?: number
}

const DEFAULT_DRANGE = 120
const MIN_MAGNITUDE = 1e-12

/** Linear magnitude -> normalized intensity in [0,1] via a dB + dynamic-range map. */
export function magnitudeToIntensity(aMagnitude: number, aOptions: IntensityOptions = {}): number {
  const drange = aOptions.drange ?? DEFAULT_DRANGE
  const gain = aOptions.gain ?? 1
  const m = aMagnitude * gain
  if (m <= MIN_MAGNITUDE || drange <= 0) {
    return 0
  }
  const db = 20 * Math.log10(m)
  const n = 1 + db / drange
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

export interface TileImage {
  readonly width: number
  readonly height: number
  /** RGBA, row 0 = highest frequency (top), row height-1 = lowest (bottom). */
  readonly rgba: Uint8ClampedArray
}

/**
 * Render one worker tile to an RGBA image: width = emitted frames (time), height =
 * display bins (frequency), top row = highest frequency so it draws with low
 * frequencies at the bottom. Grayscale intensity (U2.2).
 */
export function tileToImage(aTile: SpectrogramTile, aOptions: IntensityOptions = {}): TileImage {
  const frames = aTile.frames
  const width = frames.length
  const height = aTile.binCount
  const rgba = new Uint8ClampedArray(Math.max(0, width * height) * 4)

  for (let x = 0; x < width; x++) {
    const bins = frames[x]?.bins ?? []
    for (let row = 0; row < height; row++) {
      const bin = height - 1 - row // top row = highest-frequency bin
      const intensity = magnitudeToIntensity(bins[bin] ?? 0, aOptions)
      const c = Math.round(intensity * 255)
      const offset = (row * width + x) * 4
      rgba[offset] = c
      rgba[offset + 1] = c
      rgba[offset + 2] = c
      rgba[offset + 3] = 255
    }
  }

  return { width, height, rgba }
}

/**
 * Choose an overview-pyramid zoom so a `frameCount`-frame analysis renders into
 * roughly `targetColumns` pixels (avoids fetching thousands of columns for a few
 * hundred pixels). zoom z max-pools 2^z frames per column.
 */
export function chooseZoom(aFrameCount: number, aTargetColumns: number): number {
  if (aFrameCount <= 0 || aTargetColumns <= 0) return 0
  const ratio = aFrameCount / aTargetColumns
  if (ratio <= 1) return 0
  return Math.max(0, Math.ceil(Math.log2(ratio)))
}
