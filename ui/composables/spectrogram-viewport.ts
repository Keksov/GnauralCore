import { chooseZoom } from './spectrogram-render'

// Pure (Vue-free) time-viewport model for spectrogram zoom/pan (U3.2). A viewport
// is a visible [startSec, endSec] window inside [0, durationSec]; the composable
// drives the worker get-tile via setView(window, zoomTier).

export interface TimeWindow {
  readonly startSec: number
  readonly endSec: number
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
export function isFullWindow(aWindow: TimeWindow, aDurationSec: number): boolean {
  return aWindow.startSec <= 1e-6 && aWindow.endSec >= aDurationSec - 1e-6
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
