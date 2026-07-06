// SF22.1: the "digital audio model" — a framework-free view over decoded PCM that maps
// pixel↔time↔sample and answers queries at a point/range. This is the reusable foundation
// the waveform renderer, the cursor readout, and a future editor all build on. Kept Vue-free
// so it is unit-testable; the reactive wrapper lives in `use-audio-model.ts`.

export interface AudioModelInfo {
  readonly sampleRate: number
  /** Samples per channel. */
  readonly length: number
  readonly durationSec: number
  readonly channels: number
}

/** Per-bucket summary of a sample range: signal min/max envelope + RMS level. */
export interface AudioPeak {
  readonly min: number
  readonly max: number
  readonly rms: number
}

/** dBFS floor reported for (near-)silence, so amplitudeToDb never returns -Infinity. */
export const AUDIO_MIN_DB = -100

export function timeToSample(aTimeSec: number, aSampleRate: number): number {
  return aTimeSec * aSampleRate
}

export function sampleToTime(aSample: number, aSampleRate: number): number {
  return aSampleRate > 0 ? aSample / aSampleRate : 0
}

/** Linear amplitude (|a| in 0..1) -> dBFS, clamped to AUDIO_MIN_DB. */
export function amplitudeToDb(aAmplitude: number): number {
  const a = Math.abs(aAmplitude)
  if (a < 1e-10) return AUDIO_MIN_DB
  const db = 20 * Math.log10(a)
  return db < AUDIO_MIN_DB ? AUDIO_MIN_DB : db
}

function clampIndex(aValue: number, aMax: number): number {
  if (aValue < 0) return 0
  if (aValue > aMax) return aMax
  return aValue
}

/** Nearest-sample value of a channel at a time (0 outside the buffer). */
export function sampleAt(aData: Float32Array, aTimeSec: number, aSampleRate: number): number {
  const n = aData.length
  if (n === 0) return 0
  const idx = clampIndex(Math.round(aTimeSec * aSampleRate), n - 1)
  return aData[idx] ?? 0
}

/**
 * Min/max envelope + RMS per bucket over [startSample, endSample) split into `buckets`
 * equal spans — the data behind a waveform column and the point readout. When there are
 * fewer samples than buckets, empty buckets fall back to the nearest single sample.
 */
export function computePeaks(
  aData: Float32Array,
  aStartSample: number,
  aEndSample: number,
  aBuckets: number,
): AudioPeak[] {
  const n = aData.length
  const start = Math.max(0, Math.min(Math.floor(aStartSample), n))
  const end = Math.max(start, Math.min(Math.ceil(aEndSample), n))
  const total = end - start
  if (aBuckets <= 0 || total <= 0) return []

  const out: AudioPeak[] = []
  for (let b = 0; b < aBuckets; b++) {
    const from = start + Math.floor((b * total) / aBuckets)
    const to = start + Math.floor(((b + 1) * total) / aBuckets)
    let min = Infinity
    let max = -Infinity
    let sumSq = 0
    let count = 0
    for (let i = from; i < to; i++) {
      const v = aData[i] ?? 0
      if (v < min) min = v
      if (v > max) max = v
      sumSq += v * v
      count += 1
    }
    if (count === 0) {
      const v = aData[clampIndex(from, n - 1)] ?? 0
      out.push({ min: v, max: v, rms: Math.abs(v) })
    } else {
      out.push({ min, max, rms: Math.sqrt(sumSq / count) })
    }
  }
  return out
}
