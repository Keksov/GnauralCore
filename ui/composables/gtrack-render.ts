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
  /** Labels for the top / middle / bottom of the value axis. */
  readonly topLabel: string
  readonly midLabel: string
  readonly botLabel: string
}

function formatFreq(v: number): string {
  if (v >= 100) return `${Math.round(v)}`
  if (v >= 10) return v.toFixed(0)
  return v.toFixed(1)
}

/** Map a value to a [0,1] unit position on the axis (0 = min/bottom, 1 = max/top), clamped. */
export function valueToUnit(value: number, axis: GTrackAxis): number {
  const span = axis.max - axis.min
  if (span <= 0) return 0.5
  return Math.max(0, Math.min(1, (value - axis.min) / span))
}

/**
 * The value axis for a set of voices under a mode. Volume is fixed 0..1 and balance -1..1 (L/C/R);
 * frequency modes auto-range from the data with padding, floored at 0.
 */
export function gtrackAxis(voices: readonly GTrackVoice[], mode: GTrackMode): GTrackAxis {
  if (mode === 'volume') {
    return { min: 0, max: 1, topLabel: '1.0', midLabel: '0.5', botLabel: '0' }
  }
  if (mode === 'balance') {
    return { min: -1, max: 1, topLabel: 'R', midLabel: 'C', botLabel: 'L' }
  }
  // base / beat — auto-range across all points.
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const voice of voices) {
    for (const p of voice.points) {
      const v = pointValue(p, mode)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { min: 0, max: 1, topLabel: '1', midLabel: '0.5', botLabel: '0' }
  }
  if (lo === hi) {
    // A single flat value — give it a visible band around it (floored at 0).
    const pad = lo === 0 ? 1 : Math.max(1, Math.abs(lo) * 0.1)
    lo = Math.max(0, lo - pad)
    hi += pad
  } else {
    const pad = (hi - lo) * 0.08
    lo = Math.max(0, lo - pad)
    hi += pad
  }
  const mid = (lo + hi) / 2
  return {
    min: lo,
    max: hi,
    topLabel: formatFreq(hi),
    midLabel: formatFreq(mid),
    botLabel: formatFreq(lo),
  }
}
