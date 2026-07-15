// GT2.1 — pure helpers for drawing gtrack lanes: the value of a point under a display mode and the
// value-axis (range + the three edge labels) for a set of voices. Kept out of the .vue component so
// it is unit-testable.

import { pointBalance, pointBeatFreq, pointVolume, type GTrackPoint, type GTrackVoice } from './gtrack-model'

export type GTrackMode = 'base' | 'beat' | 'volume' | 'balance'
export const GTRACK_MODES: readonly GTrackMode[] = ['base', 'beat', 'volume', 'balance']

/** The value a point contributes under a display mode (GT-D6 derived axes). */
export function pointValue(p: GTrackPoint, mode: GTrackMode): number {
  switch (mode) {
    case 'base':
      return p.baseFreq
    case 'beat':
      return pointBeatFreq(p)
    case 'volume':
      return pointVolume(p)
    case 'balance':
      return pointBalance(p)
  }
}

/** GT3.2: fields a drag can change (a subset of GTrackPointField, excluding timeSec). */
export type GTrackValuePatch = Partial<Record<'baseFreq' | 'beatFreqHalf' | 'volL' | 'volR', number>>

/**
 * Inverse of pointValue (GT-D6): map a dragged mode-value back to the raw point fields.
 * - base  -> baseFreq (>= 0)
 * - beat  -> beatFreqHalf = value / 2 (>= 0)
 * - volume-> scale volL/volR to the new mean, preserving the L/R ratio (balance); mono sets both
 * - balance-> re-split the current total volL+volR by the balance in [-1, 1]; mono / silence: no-op
 * Volumes are clamped to [0, 1].
 */
export function valuePatchForMode(
  p: GTrackPoint,
  mode: GTrackMode,
  value: number,
  mono: boolean,
): GTrackValuePatch {
  const clampVol = (v: number): number => Math.max(0, Math.min(1, v))
  switch (mode) {
    case 'base':
      return { baseFreq: Math.max(0, value) }
    case 'beat':
      return { beatFreqHalf: Math.max(0, value / 2) }
    case 'volume': {
      const target = clampVol(value)
      if (mono) return { volL: target, volR: target }
      const cur = (p.volL + p.volR) / 2
      if (cur <= 0) return { volL: target, volR: target } // silence has no ratio to preserve
      const f = target / cur
      return { volL: clampVol(p.volL * f), volR: clampVol(p.volR * f) }
    }
    case 'balance': {
      if (mono) return {} // mono has no stereo balance
      const b = Math.max(-1, Math.min(1, value))
      const s = p.volL + p.volR
      if (s <= 0) return {} // silence: balance is undefined
      return { volL: clampVol((s * (1 - b)) / 2), volR: clampVol((s * (1 + b)) / 2) }
    }
  }
}

export interface GTrackAxis {
  readonly min: number
  readonly max: number
  /**
   * GT2.8: 'log' for Base freq (matches the classic schedule editor); 'linear' otherwise.
   * GT11.17 (owner 2026-07-15): 'symlog' for a Base axis whose data reaches 0 — log10(0) is -Inf,
   * so a pure log axis cannot place 0 at all (it clamped it to the axis minimum, which on a flat
   * ~100 Hz voice is exactly where every other point already sat: editing a point to 0 looked like
   * nothing happened). A schedule may legitimately contain 0, so the axis has to show it: linear
   * from 0 up to SYMLOG_THRESHOLD_HZ, logarithmic above it.
   */
  readonly scale: 'linear' | 'log' | 'symlog'
  /** Labels for the top / middle / bottom of the value axis. */
  readonly topLabel: string
  readonly midLabel: string
  readonly botLabel: string
}

/** Below this the Base axis is linear (so 0 is representable); above it, logarithmic. */
export const SYMLOG_THRESHOLD_HZ = 1
/** Share of a symlog axis given to the linear [0 .. threshold] segment. */
const SYMLOG_LINEAR_FRACTION = 0.12

/**
 * Unit position on a symlog axis. `axis.min` is the bottom (0 for a zero-reaching schedule); the
 * linear segment covers [min .. threshold] and takes SYMLOG_LINEAR_FRACTION of the height, the log
 * segment covers [threshold .. max]. Degenerate cases (a range entirely below or entirely above the
 * threshold) collapse to a plain linear / log map, so callers never special-case them.
 */
function symlogUnit(value: number, axis: GTrackAxis): number {
  const thr = SYMLOG_THRESHOLD_HZ
  const v = Math.max(axis.min, Math.min(axis.max, value))
  if (axis.max <= thr) {
    const span = axis.max - axis.min
    return span <= 0 ? 0.5 : (v - axis.min) / span
  }
  if (axis.min >= thr) {
    const span = Math.log10(axis.max) - Math.log10(axis.min)
    return span <= 0 ? 0.5 : (Math.log10(v) - Math.log10(axis.min)) / span
  }
  if (v <= thr) {
    const linSpan = thr - axis.min
    return linSpan <= 0 ? 0 : ((v - axis.min) / linSpan) * SYMLOG_LINEAR_FRACTION
  }
  const logSpan = Math.log10(axis.max) - Math.log10(thr)
  if (logSpan <= 0) return SYMLOG_LINEAR_FRACTION
  return SYMLOG_LINEAR_FRACTION + (1 - SYMLOG_LINEAR_FRACTION) * ((Math.log10(v) - Math.log10(thr)) / logSpan)
}

/** Inverse of symlogUnit (drag: cursor unit position -> axis value). */
function symlogValue(unit: number, axis: GTrackAxis): number {
  const thr = SYMLOG_THRESHOLD_HZ
  const u = Math.max(0, Math.min(1, unit))
  if (axis.max <= thr) return axis.min + u * (axis.max - axis.min)
  if (axis.min >= thr) {
    return Math.pow(10, Math.log10(axis.min) + u * (Math.log10(axis.max) - Math.log10(axis.min)))
  }
  if (u <= SYMLOG_LINEAR_FRACTION) {
    return axis.min + (u / SYMLOG_LINEAR_FRACTION) * (thr - axis.min)
  }
  const logSpan = Math.log10(axis.max) - Math.log10(thr)
  return Math.pow(10, Math.log10(thr) + ((u - SYMLOG_LINEAR_FRACTION) / (1 - SYMLOG_LINEAR_FRACTION)) * logSpan)
}

function formatFreq(v: number): string {
  if (v >= 100) return `${Math.round(v)}`
  if (v >= 10) return v.toFixed(0)
  return v.toFixed(1)
}

/** Map a value to a [0,1] unit position on the axis (0 = min/bottom, 1 = max/top), clamped. */
export function valueToUnit(value: number, axis: GTrackAxis): number {
  if (axis.scale === 'symlog') {
    return Math.max(0, Math.min(1, symlogUnit(value, axis)))
  }
  if (axis.scale === 'log') {
    const minLog = Math.log10(axis.min)
    const maxLog = Math.log10(axis.max)
    const span = maxLog - minLog
    if (span <= 0) return 0.5
    const valueLog = Math.log10(Math.max(value, axis.min))
    return Math.max(0, Math.min(1, (valueLog - minLog) / span))
  }
  const span = axis.max - axis.min
  if (span <= 0) return 0.5
  return Math.max(0, Math.min(1, (value - axis.min) / span))
}

/** Inverse of valueToUnit (GT3.2 drag: cursor unit position -> axis value). */
export function unitToValue(unit: number, axis: GTrackAxis): number {
  const u = Math.max(0, Math.min(1, unit))
  if (axis.scale === 'symlog') {
    return symlogValue(u, axis)
  }
  if (axis.scale === 'log') {
    const minLog = Math.log10(axis.min)
    const maxLog = Math.log10(axis.max)
    return Math.pow(10, minLog + u * (maxLog - minLog))
  }
  return axis.min + u * (axis.max - axis.min)
}

/**
 * The value axis for a set of voices under a mode. Volume is fixed 0..1 and balance -1..1 (L/C/R).
 * Base freq is LOGARITHMIC, matching the classic schedule editor (GnauralScheduleView): range from
 * the data, min clamped to >= 1, a flat range padded to min*1.25. Beat freq stays linear-auto
 * (small 0..N Hz values).
 *
 * GT10.34-followup (owner 2026-07-12): with `editable` (point-edit mode) the auto-ranged freq axes
 * (base/beat) get EXTRA headroom above and below the data so a vertex can be dragged BEYOND the
 * current range — the axis re-fits on the next frame, so you can drag freely instead of being stuck
 * inside the data's own corridor. A (near-)flat curve gets a wider span so it's editable at all
 * (e.g. wakeup.gnaural, whose voice is 36 points all at 100 Hz). View mode is unchanged (data-fit).
 */
/**
 * GT10.6/GT10.22 (owner req. 50/71): the value after a Ctrl+Arrow "big step" (±1) on a numeric
 * field, clamped to the field's sane range (freqs/time/volume never negative; volume capped at 1).
 * Pure so it is unit-testable; the panel handler just assigns the result.
 */
export function ctrlStepValue(current: number, field: string, direction: 1 | -1): number {
  const base = Number.isFinite(current) ? current : 0
  let next = base + direction
  next = Math.max(0, next)
  if (field === 'volL' || field === 'volR') next = Math.min(1, next)
  return next
}

/**
 * GT11.13: the same axis restricted to an EXPLICIT range — the real-value span of the lane's
 * normalized Alt+wheel Y window (see GTrackView.yView / zoomUnitWindow), overriding the auto-fit.
 * Keeps the scale and re-derives the three edge labels for the new range — the geometric midpoint on
 * a log axis, the arithmetic one otherwise.
 */
export function axisWithRange(axis: GTrackAxis, min: number, max: number): GTrackAxis {
  // GT11.17: on a symlog axis the midpoint is neither arithmetic nor geometric — the map is
  // piecewise — so read it back from the axis itself (symlogUnit/symlogValue degrade to a plain
  // linear or log map when the zoomed range sits wholly below or above the threshold).
  if (axis.scale === 'symlog') {
    const zoomed: GTrackAxis = { min, max, scale: 'symlog', topLabel: '', midLabel: '', botLabel: '' }
    return {
      ...zoomed,
      topLabel: formatFreq(max),
      midLabel: formatFreq(unitToValue(0.5, zoomed)),
      botLabel: formatFreq(min),
    }
  }
  const mid = axis.scale === 'log'
    ? Math.pow(10, (Math.log10(min) + Math.log10(max)) / 2)
    : (min + max) / 2
  return {
    min,
    max,
    scale: axis.scale,
    topLabel: formatFreq(max),
    midLabel: formatFreq(mid),
    botLabel: formatFreq(min),
  }
}

export function gtrackAxis(voices: readonly GTrackVoice[], mode: GTrackMode, editable = false, beatBand = false): GTrackAxis {
  if (mode === 'volume') {
    return { min: 0, max: 1, scale: 'linear', topLabel: '1.0', midLabel: '0.5', botLabel: '0' }
  }
  if (mode === 'balance') {
    return { min: -1, max: 1, scale: 'linear', topLabel: 'R', midLabel: 'C', botLabel: 'L' }
  }
  // base / beat — collect the value range across all points.
  // GT11.17: a non-positive base value is NO LONGER skipped. It used to be (log10(0) = -Inf), which
  // left it out of the range AND clamped it to the axis minimum — on wakeup.gnaural (flat ~100 Hz)
  // a point set to 0 then drew exactly where the 100 Hz points already were, so the edit looked
  // like a no-op. A schedule can legitimately contain 0, so the axis switches to symlog instead.
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  let hasNonPositiveBase = false
  for (const voice of voices) {
    // A voice whose base is non-positive THROUGHOUT is a noise voice: it has no carrier to plot,
    // and folding its 0 into the range would drag the axis off the real frequencies. Skip it, as
    // before. A voice that MIXES real frequencies with 0 is a curve that genuinely visits 0 — its
    // zeros count, and the axis goes symlog so they are visible.
    const isNoiseVoice = mode === 'base'
      && voice.points.length > 0
      && voice.points.every((p) => pointValue(p, mode) <= 0)
    if (isNoiseVoice) continue

    for (const p of voice.points) {
      const v = pointValue(p, mode)
      if (mode === 'base' && v <= 0) hasNonPositiveBase = true
      if (v < lo) lo = v
      if (v > hi) hi = v
      // owner 2026-07-14: when the beat band is shown, widen the base axis to fit base ± beat/2 so the
      // band is fully visible (not clipped) — matching the Schedule tab's frequency range.
      if (mode === 'base' && beatBand) {
        const upper = p.baseFreq + p.beatFreqHalf
        const lower = p.baseFreq - p.beatFreqHalf
        if (upper > hi) hi = upper
        if (lower > 0 && lower < lo) lo = lower
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { min: 0, max: 1, scale: 'linear', topLabel: '1', midLabel: '0.5', botLabel: '0' }
  }
  if (mode === 'base') {
    // GT11.17: the data reaches 0 (or below) — a log axis cannot place it. Keep the log character
    // for the real frequencies and give 0 an honest spot: linear up to SYMLOG_THRESHOLD_HZ, log
    // above it. The bottom is 0 exactly, so a point edited to 0 lands there and nowhere else.
    if (hasNonPositiveBase) {
      const min = Math.min(0, lo)
      let max = Math.max(hi, SYMLOG_THRESHOLD_HZ)
      if (editable) max *= 1.15 // headroom to drag a vertex above the data (as in the log branch)
      const axis: GTrackAxis = {
        min,
        max,
        scale: 'symlog',
        topLabel: formatFreq(max),
        midLabel: '',
        botLabel: formatFreq(min),
      }
      return { ...axis, midLabel: formatFreq(unitToValue(0.5, axis)) }
    }
    // Classic-editor log frequency axis (frequencyToY in GnauralScheduleView).
    let min = Math.max(lo, 1)
    let max = Math.max(hi, min)
    if (max <= min) max = min * 1.25
    if (editable) {
      // Multiplicative headroom (log axis). A (near-)flat curve gets a wider span.
      const factor = max <= min * 1.05 ? 1.5 : 1.15
      min = Math.max(1, min / factor)
      max = max * factor
    }
    const mid = Math.pow(10, (Math.log10(min) + Math.log10(max)) / 2) // geometric midpoint
    return {
      min,
      max,
      scale: 'log',
      topLabel: formatFreq(max),
      midLabel: formatFreq(mid),
      botLabel: formatFreq(min),
    }
  }
  // beat — linear auto-range with padding, floored at 0.
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.max(1, Math.abs(lo) * 0.1)
    lo = Math.max(0, lo - pad)
    hi += pad
  } else {
    const pad = (hi - lo) * 0.08
    lo = Math.max(0, lo - pad)
    hi += pad
  }
  if (editable) {
    // Extra headroom above/below so a vertex can be dragged past the current range.
    const extra = Math.max(1, (hi - lo) * 0.25)
    lo = Math.max(0, lo - extra)
    hi += extra
  }
  const mid = (lo + hi) / 2
  return {
    min: lo,
    max: hi,
    scale: 'linear',
    topLabel: formatFreq(hi),
    midLabel: formatFreq(mid),
    botLabel: formatFreq(lo),
  }
}
