// Pure axis-tick + label helpers for the spectrogram chrome (U3.1). The frequency
// axis is fscale-correct because it samples the worker's binFrequenciesHz (display
// bins evenly spaced in the fscale domain); the time axis uses nice round steps.

export interface AxisTick {
  /** Fraction along the axis. Frequency: 0 = top (high). Time: 0 = left (start). */
  readonly position: number
  readonly value: number
}

/**
 * Frequency ticks from the worker's display-bin frequencies (ascending; bin 0 =
 * lowest). Returns positions from the TOP (0 = highest freq), so they map straight
 * to canvas y. fscale-aware by construction (binFrequenciesHz is already mapped).
 */
export function frequencyAxisTicks(
  aBinFrequenciesHz: readonly number[],
  aTickCount = 6,
): AxisTick[] {
  const n = aBinFrequenciesHz.length
  if (n === 0) return []
  const count = Math.max(2, aTickCount)
  const ticks: AxisTick[] = []
  for (let i = 0; i < count; i++) {
    const binFraction = 1 - i / (count - 1) // i=0 -> highest bin (top)
    const binIndex = Math.round(binFraction * (n - 1))
    ticks.push({ position: 1 - binFraction, value: aBinFrequenciesHz[binIndex] ?? 0 })
  }
  return ticks
}

/**
 * Frequency at a vertical fraction from the TOP of the plot (0 = top/highest,
 * 1 = bottom/lowest), using the worker's display-bin frequencies. fscale-aware
 * (binFrequenciesHz is already mapped). Used for the hover readout (U5.1).
 */
export function frequencyAtFraction(
  aTopFraction: number,
  aBinFrequenciesHz: readonly number[],
): number {
  const n = aBinFrequenciesHz.length
  if (n === 0) return 0
  const f = aTopFraction < 0 ? 0 : aTopFraction > 1 ? 1 : aTopFraction
  const binIndex = Math.round((1 - f) * (n - 1))
  return aBinFrequenciesHz[binIndex] ?? 0
}

export interface SpectrogramSelectionPoint {
  readonly timeSec: number
  /** Vertical fraction from the top (0 = highest freq). */
  readonly topFraction: number
}

export interface SpectrogramAreaBounds {
  readonly timeStartSec: number
  readonly timeEndSec: number
  readonly freqStartHz: number
  readonly freqEndHz: number
}

/** Ordered area-query bounds from two drag points (U5.2), fscale-aware on Y. */
export function areaQueryBounds(
  aP0: SpectrogramSelectionPoint,
  aP1: SpectrogramSelectionPoint,
  aBinFrequenciesHz: readonly number[],
): SpectrogramAreaBounds {
  const f0 = frequencyAtFraction(aP0.topFraction, aBinFrequenciesHz)
  const f1 = frequencyAtFraction(aP1.topFraction, aBinFrequenciesHz)
  return {
    timeStartSec: Math.min(aP0.timeSec, aP1.timeSec),
    timeEndSec: Math.max(aP0.timeSec, aP1.timeSec),
    freqStartHz: Math.min(f0, f1),
    freqEndHz: Math.max(f0, f1),
  }
}

/** A "nice" round step (1/2/5 x 10^k) for ~targetTicks divisions of a range. */
export function niceStep(aRange: number, aTargetTicks: number): number {
  if (aRange <= 0) return 0
  const raw = aRange / Math.max(1, aTargetTicks)
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / magnitude
  let step: number
  if (norm < 1.5) step = 1
  else if (norm < 3) step = 2
  else if (norm < 7) step = 5
  else step = 10
  return step * magnitude
}

/** Time ticks at nice round seconds across [startSec, endSec]; position 0 = left. */
export function timeAxisTicks(
  aStartSec: number,
  aEndSec: number,
  aTargetTicks = 6,
): AxisTick[] {
  const range = aEndSec - aStartSec
  if (range <= 0) return []
  const step = niceStep(range, aTargetTicks)
  if (step <= 0) return []
  const ticks: AxisTick[] = []
  const firstRaw = Math.ceil(aStartSec / step - 1e-9) * step
  const first = firstRaw === 0 ? 0 : firstRaw // normalize -0 -> 0
  for (let v = first; v <= aEndSec + 1e-9; v += step) {
    ticks.push({ position: (v - aStartSec) / range, value: v })
  }
  return ticks
}

/** Compact frequency label, e.g. 440 -> "440", 4400 -> "4.4k", 12000 -> "12k". */
export function formatHz(aHz: number): string {
  if (aHz >= 1000) {
    const k = aHz / 1000
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return `${Math.round(aHz)}`
}

/** Compact time label, e.g. 2.5 -> "2.50s", 65 -> "1:05". */
export function formatTimeSec(aSec: number): string {
  const sec = aSec < 0 ? 0 : aSec
  const minutes = Math.floor(sec / 60)
  if (minutes > 0) {
    const rem = Math.round(sec - minutes * 60)
    return `${minutes}:${rem.toString().padStart(2, '0')}`
  }
  return `${sec.toFixed(sec < 10 ? 2 : 1)}s`
}
