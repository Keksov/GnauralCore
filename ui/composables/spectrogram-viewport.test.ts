import { describe, expect, test } from 'bun:test'

import {
  clampWindow,
  fractionToTime,
  FULL_UNIT,
  fullWindow,
  isFullWindow,
  MIN_WINDOW_SEC,
  panUnitWindow,
  panWindow,
  timeToFraction,
  viewportZoomTier,
  zoomUnitWindow,
  zoomWindow,
} from './spectrogram-viewport'

describe('fullWindow / clampWindow (U3.2)', () => {
  test('fullWindow spans 0..duration', () => {
    expect(fullWindow(10)).toEqual({ startSec: 0, endSec: 10 })
  })

  test('clamps into [0,duration] and enforces a min width', () => {
    expect(clampWindow({ startSec: -5, endSec: 4 }, 10)).toEqual({ startSec: 0, endSec: 9 })
    const tiny = clampWindow({ startSec: 5, endSec: 5 }, 10)
    expect(tiny.endSec - tiny.startSec).toBeCloseTo(MIN_WINDOW_SEC, 9)
    const past = clampWindow({ startSec: 8, endSec: 14 }, 10)
    expect(past.endSec).toBeLessThanOrEqual(10)
    expect(past.endSec - past.startSec).toBeCloseTo(6, 9)
  })
})

describe('zoomWindow (U3.2)', () => {
  test('zoom in (factor 0.5) halves the width and keeps the anchor time', () => {
    const z = zoomWindow({ startSec: 0, endSec: 10 }, 0.5, 0.5, 10) // anchor = centre (5s)
    expect(z.endSec - z.startSec).toBeCloseTo(5, 6)
    expect(z.startSec).toBeCloseTo(2.5, 6)
    expect(z.endSec).toBeCloseTo(7.5, 6)
  })

  test('anchor at the left edge keeps the start put', () => {
    const z = zoomWindow({ startSec: 4, endSec: 8 }, 0.5, 0, 10) // anchor = 4s
    expect(z.startSec).toBeCloseTo(4, 6)
    expect(z.endSec - z.startSec).toBeCloseTo(2, 6)
  })

  test('zoom out (factor 2) widens and clamps to the clip', () => {
    const z = zoomWindow({ startSec: 4, endSec: 6 }, 8, 0.5, 10) // would be 16s -> clamp to 10
    expect(z.startSec).toBeCloseTo(0, 6)
    expect(z.endSec).toBeCloseTo(10, 6)
  })
})

describe('panWindow (U3.2)', () => {
  test('shifts keeping the width', () => {
    const p = panWindow({ startSec: 2, endSec: 4 }, 3, 10)
    expect(p).toEqual({ startSec: 5, endSec: 7 })
  })

  test('clamps at the right edge without shrinking', () => {
    const p = panWindow({ startSec: 7, endSec: 9 }, 5, 10)
    expect(p.endSec).toBeCloseTo(10, 6)
    expect(p.endSec - p.startSec).toBeCloseTo(2, 6)
  })
})

describe('timeToFraction / fractionToTime (U3.3)', () => {
  test('maps time within the window to a fraction and back', () => {
    const w = { startSec: 2, endSec: 6 }
    expect(timeToFraction(4, w)).toBeCloseTo(0.5, 9)
    expect(timeToFraction(2, w)).toBeCloseTo(0, 9)
    expect(timeToFraction(6, w)).toBeCloseTo(1, 9)
    expect(fractionToTime(0.5, w)).toBeCloseTo(4, 9)
  })

  test('fraction is <0 / >1 outside the window (caller decides to hide)', () => {
    const w = { startSec: 2, endSec: 6 }
    expect(timeToFraction(0, w)).toBeLessThan(0)
    expect(timeToFraction(8, w)).toBeGreaterThan(1)
  })
})

describe('isFullWindow / viewportZoomTier (U3.2)', () => {
  test('isFullWindow detects the whole clip', () => {
    expect(isFullWindow({ startSec: 0, endSec: 10 }, 10)).toBe(true)
    expect(isFullWindow({ startSec: 2, endSec: 8 }, 10)).toBe(false)
  })

  test('tier is coarse when zoomed out, finer when zoomed in', () => {
    // 10s / 10000 frames; 800 columns
    const full = viewportZoomTier({ startSec: 0, endSec: 10 }, 10, 10000, 800) // ~10000 frames
    const zoomed = viewportZoomTier({ startSec: 0, endSec: 1 }, 10, 10000, 800) // ~1000 frames
    expect(full).toBeGreaterThan(zoomed)
    expect(zoomed).toBeGreaterThanOrEqual(0)
  })
})

// GT11.13: the normalized [0,1] view window shared by the spectrogram's frequency band and the
// gtrack lane's Alt+wheel Y zoom (both call these, so the gesture cannot drift apart).
const MIN_SPAN = 0.02

describe('zoomUnitWindow (GT11.13 / SF15.1)', () => {
  test('zoom-in shrinks the span about the anchor', () => {
    const w = zoomUnitWindow(FULL_UNIT, 0.8, 0.5, MIN_SPAN)
    expect(w.hi - w.lo).toBeCloseTo(0.8, 9)
    expect(w.lo).toBeCloseTo(0.1, 9) // centred anchor keeps it symmetric
    expect(w.hi).toBeCloseTo(0.9, 9)
  })

  // The point of anchoring: the fraction under the cursor stays under the cursor.
  test('pins the anchored fraction while it fits inside [0,1]', () => {
    const start = { lo: 0.2, hi: 0.8 }
    for (const anchor of [0.25, 0.5, 0.75]) {
      const w = zoomUnitWindow(start, 0.8, anchor, MIN_SPAN)
      const before = start.lo + anchor * (start.hi - start.lo)
      const after = w.lo + anchor * (w.hi - w.lo)
      expect(after).toBeCloseTo(before, 9)
    }
  })

  test('zooming out clamps back to the full range — that is the way back', () => {
    let w = { lo: 0.4, hi: 0.6 }
    for (let i = 0; i < 20; i += 1) w = zoomUnitWindow(w, 1.25, 0.5, MIN_SPAN)
    expect(w).toEqual({ lo: 0, hi: 1 })
  })

  test('never escapes [0,1], even anchored at an edge', () => {
    for (const anchor of [0, 1]) {
      for (const factor of [0.8, 1.25]) {
        const w = zoomUnitWindow({ lo: 0, hi: 0.3 }, factor, anchor, MIN_SPAN)
        expect(w.lo).toBeGreaterThanOrEqual(0)
        expect(w.hi).toBeLessThanOrEqual(1)
      }
    }
  })

  test('respects the minimum span', () => {
    let w: { lo: number; hi: number } = FULL_UNIT
    for (let i = 0; i < 50; i += 1) w = zoomUnitWindow(w, 0.8, 0.5, MIN_SPAN)
    expect(w.hi - w.lo).toBeCloseTo(MIN_SPAN, 9)
  })
})

describe('panUnitWindow (GT11.13 / SF15.1)', () => {
  test('moves the window and preserves the span', () => {
    const w = panUnitWindow({ lo: 0.2, hi: 0.5 }, 0.1)
    expect(w.lo).toBeCloseTo(0.3, 9)
    expect(w.hi).toBeCloseTo(0.6, 9)
    expect(w.hi - w.lo).toBeCloseTo(0.3, 9)
  })

  test('clamps at both ends without shrinking the span', () => {
    const lowEnd = panUnitWindow({ lo: 0.1, hi: 0.4 }, -1)
    expect(lowEnd.lo).toBe(0)
    expect(lowEnd.hi - lowEnd.lo).toBeCloseTo(0.3, 9)
    const highEnd = panUnitWindow({ lo: 0.6, hi: 0.9 }, 1)
    expect(highEnd.hi).toBeCloseTo(1, 9)
    expect(highEnd.hi - highEnd.lo).toBeCloseTo(0.3, 9)
  })
})
