import { amplitudeToDb, type AudioPeak } from './audio-model'

// SF22.2: pure (canvas-free) waveform mapping. Peaks (min/max/rms per column) -> signed unit
// values in [-1, 1] where 0 is the zero line, +1 the top and -1 the bottom. The view maps unit
// -> pixels. `linear` uses the amplitude directly; `db` maps |amplitude| onto [dbFloor, 0] dBFS
// and keeps the sign (Audacity-style dB waveform: loud near the edges, quiet toward the centre).

export type WaveformScale = 'linear' | 'db'
export const WAVEFORM_DB_FLOOR = -60

/** Signed amplitude -> unit position in [-1, 1] under the chosen scale. */
export function amplitudeToUnit(aAmp: number, aScale: WaveformScale, aDbFloor = WAVEFORM_DB_FLOOR): number {
  if (aScale === 'db') {
    const a = Math.abs(aAmp)
    if (a < 1e-10) return 0
    const db = amplitudeToDb(a) // <= 0
    const span = -aDbFloor
    if (span <= 0) return aAmp < 0 ? -1 : 1
    let norm = (db - aDbFloor) / span // 0 at floor, 1 at 0 dBFS
    if (norm < 0) norm = 0
    if (norm > 1) norm = 1
    return aAmp < 0 ? -norm : norm
  }
  const clamped = aAmp < -1 ? -1 : aAmp > 1 ? 1 : aAmp
  return clamped
}

export interface WaveformColumn {
  /** Top of the envelope (from `max`), unit space. */
  readonly maxU: number
  /** Bottom of the envelope (from `min`), unit space. */
  readonly minU: number
  /** RMS magnitude, unit space (>= 0). */
  readonly rmsU: number
}

/** Map per-column peaks to unit-space envelope + RMS for drawing. */
export function peaksToColumns(
  aPeaks: readonly AudioPeak[],
  aScale: WaveformScale,
  aDbFloor = WAVEFORM_DB_FLOOR,
): WaveformColumn[] {
  return aPeaks.map((p) => ({
    maxU: amplitudeToUnit(p.max, aScale, aDbFloor),
    minU: amplitudeToUnit(p.min, aScale, aDbFloor),
    rmsU: amplitudeToUnit(p.rms, aScale, aDbFloor),
  }))
}
