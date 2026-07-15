import { chooseZoom } from './spectrogram-render'

// Pure (Vue-free) time-viewport model for spectrogram zoom/pan (U3.2). A viewport
// is a visible [startSec, endSec] window inside [0, durationSec]; the composable
// drives the worker get-tile via setView(window, zoomTier).

export interface TimeWindow {
  readonly startSec: number
  readonly endSec: number
}

/** A spectrogram area selection: time span + top-fraction band [0..1] (0=top). */
export interface SpectrogramSelection {
  readonly timeStartSec: number
  readonly timeEndSec: number
  readonly topLo: number
  readonly topHi: number
}

/** Smallest visible window (guards against zooming in to nothing). */
export const MIN_WINDOW_SEC = 0.02

export function fullWindow(aDurationSec: number): TimeWindow {
  return { startSec: 0, endSec: Math.max(MIN_WINDOW_SEC, aDurationSec) }
}

/** Clamp a window into [0, duration], keeping width where possible, min width enforced. */
export function clampWindow(aWindow: TimeWindow, aDurationSec: number): TimeWindow {
  const duration = Math.max(MIN_WINDOW_SEC, aDurationSec)
  let width = Math.min(duration, Math.max(MIN_WINDOW_SEC, aWindow.endSec - aWindow.startSec))
  let start = aWindow.startSec
  if (start < 0) start = 0
  if (start + width > duration) start = duration - width
  if (start < 0) start = 0
  return { startSec: start, endSec: start + width }
}

/**
 * Zoom around an anchor fraction (0..1) within the current window. factor < 1
 * zooms in (narrows), factor > 1 zooms out. The anchored time stays put.
 */
export function zoomWindow(
  aWindow: TimeWindow,
  aFactor: number,
  aAnchorFraction: number,
  aDurationSec: number,
): TimeWindow {
  const duration = Math.max(MIN_WINDOW_SEC, aDurationSec)
  const width = Math.max(MIN_WINDOW_SEC, aWindow.endSec - aWindow.startSec)
  const anchor = aAnchorFraction < 0 ? 0 : aAnchorFraction > 1 ? 1 : aAnchorFraction
  const anchorSec = aWindow.startSec + anchor * width
  const newWidth = Math.min(duration, Math.max(MIN_WINDOW_SEC, width * aFactor))
  const start = anchorSec - anchor * newWidth
  return clampWindow({ startSec: start, endSec: start + newWidth }, duration)
}

/** Pan by a time delta, keeping the width (clamped at the edges). */
export function panWindow(aWindow: TimeWindow, aDeltaSec: number, aDurationSec: number): TimeWindow {
  const width = aWindow.endSec - aWindow.startSec
  return clampWindow(
    { startSec: aWindow.startSec + aDeltaSec, endSec: aWindow.startSec + aDeltaSec + width },
    aDurationSec,
  )
}

/** True when the window covers (essentially) the whole clip. */
/**
 * A NORMALIZED [0,1] view window over some full range — the spectrogram's frequency band (SF15.1)
 * and, since GT11.13, a gtrack lane's value (Y) range. {lo:0, hi:1} = the full range.
 */
export interface UnitWindow {
  readonly lo: number
  readonly hi: number
}
export const FULL_UNIT: UnitWindow = { lo: 0, hi: 1 }

/**
 * Zoom a normalized view window about an anchor (0 = bottom, 1 = top); factor < 1 zooms in. Clamped
 * to [0,1] and to aMinSpan, so zooming out simply lands back on the full range.
 *
 * GT11.13: extracted verbatim from SpectrogramView's local zoomFreq so the gtrack lane's Alt+wheel is
 * the SAME gesture BY CONSTRUCTION (both call this) rather than a lookalike copy that can drift.
 */
export function zoomUnitWindow(aWindow: UnitWindow, aFactor: number, aAnchorBottom: number, aMinSpan: number): UnitWindow {
  const span = Math.max(aMinSpan, aWindow.hi - aWindow.lo)
  const anchorFraction = Math.min(1, Math.max(0, aAnchorBottom))
  const anchor = aWindow.lo + anchorFraction * span
  let newSpan = Math.min(1, Math.max(aMinSpan, span * aFactor))
  let lo = anchor - anchorFraction * newSpan
  if (lo < 0) lo = 0
  if (lo + newSpan > 1) lo = 1 - newSpan
  if (lo < 0) {
    lo = 0
    newSpan = 1
  }
  return { lo, hi: lo + newSpan }
}

/** Pan a normalized view window by a fraction delta, clamped to [0,1] (span preserved). */
export function panUnitWindow(aWindow: UnitWindow, aDelta: number): UnitWindow {
  const span = aWindow.hi - aWindow.lo
  let lo = aWindow.lo + aDelta
  if (lo < 0) lo = 0
  if (lo + span > 1) lo = 1 - span
  return { lo, hi: lo + span }
}

export function isFullWindow(aWindow: TimeWindow, aDurationSec: number): boolean {
  return aWindow.startSec <= 1e-6 && aWindow.endSec >= aDurationSec - 1e-6
}

/** Fraction (0..1 inside the window) of a time within the window; may be <0 or >1. */
export function timeToFraction(aSec: number, aWindow: TimeWindow): number {
  const width = aWindow.endSec - aWindow.startSec
  if (width <= 0) return 0
  return (aSec - aWindow.startSec) / width
}

/** Inverse of timeToFraction: a window-relative fraction back to seconds. */
export function fractionToTime(aFraction: number, aWindow: TimeWindow): number {
  return aWindow.startSec + aFraction * (aWindow.endSec - aWindow.startSec)
}

/**
 * Overview-pyramid tier for a visible window: maps the visible full-resolution
 * frame span to ~`columns` pixels (reuses chooseZoom).
 */
export function viewportZoomTier(
  aWindow: TimeWindow,
  aDurationSec: number,
  aFrameCount: number,
  aColumns: number,
): number {
  if (aDurationSec <= 0 || aFrameCount <= 0) return 0
  const width = Math.max(MIN_WINDOW_SEC, aWindow.endSec - aWindow.startSec)
  const visibleFrames = Math.max(1, Math.round((width / aDurationSec) * aFrameCount))
  return chooseZoom(visibleFrames, aColumns)
}
