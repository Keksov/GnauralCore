import { describe, expect, test } from 'bun:test'

import type { GTrackPoint, GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, gtrackAxis, pointValue, unitToValue, valuePatchForMode, valueToUnit } from './gtrack-render'

function pt(over: Partial<GTrackPoint>): GTrackPoint {
  return { timeSec: 0, baseFreq: 200, beatFreqHalf: 5, volL: 0.5, volR: 0.5, ...over }
}
function voice(points: GTrackPoint[]): GTrackVoice {
  return {
    id: 1, type: 'tone', typeIndex: 0, description: '', mono: false, color: null,
    audioFilePath: '', points, preparse: false,
  }
}

describe('pointValue (GT2.1)', () => {
  const p = pt({ baseFreq: 200, beatFreqHalf: 5, volL: 0.25, volR: 0.75 })
  test('derives each mode', () => {
    expect(pointValue(p, 'base')).toBe(200)
    expect(pointValue(p, 'beat')).toBe(10) // 2 * half
    expect(pointValue(p, 'volume')).toBeCloseTo(0.5, 9)
    expect(pointValue(p, 'balance')).toBeCloseTo(0.5, 9) // right-heavy
  })
  test('every mode is covered', () => {
    for (const m of GTRACK_MODES) expect(Number.isFinite(pointValue(p, m))).toBe(true)
  })
})

describe('gtrackAxis (GT2.1)', () => {
  test('volume is fixed 0..1', () => {
    const a = gtrackAxis([voice([pt({ volL: 1, volR: 1 })])], 'volume')
    expect(a.min).toBe(0)
    expect(a.max).toBe(1)
    expect([a.botLabel, a.midLabel, a.topLabel]).toEqual(['0', '0.5', '1.0'])
  })

  test('balance is fixed -1..1 with L/C/R labels', () => {
    const a = gtrackAxis([voice([pt({})])], 'balance')
    expect(a.min).toBe(-1)
    expect(a.max).toBe(1)
    expect([a.botLabel, a.midLabel, a.topLabel]).toEqual(['L', 'C', 'R'])
  })

  test('base freq is a LOG axis from the data (classic editor), ignoring non-positive values', () => {
    const a = gtrackAxis([
      voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })]),
      voice([pt({ baseFreq: 0 })]), // e.g. a noise voice — ignored on the log axis
    ], 'base')
    expect(a.scale).toBe('log')
    expect(a.min).toBe(100)
    expect(a.max).toBe(200)
    // geometric midpoint ~141.4
    expect(a.midLabel).toBe('141')
  })

  test('a single flat frequency pads the log range to min*1.25', () => {
    const a = gtrackAxis([voice([pt({ baseFreq: 144 }), pt({ baseFreq: 144 })])], 'base')
    expect(a.min).toBe(144)
    expect(a.max).toBeCloseTo(180, 6)
  })

  test('editable base adds headroom so a flat curve can be dragged past its range (GT10.34-followup)', () => {
    // wakeup.gnaural shape: every point at the same frequency.
    const flat = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 100 })])], 'base', true)
    expect(flat.min).toBeLessThan(100) // room below
    expect(flat.max).toBeGreaterThan(100) // room above -> draggable in both directions
    // A normal range also gains headroom on both sides.
    const ranged = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })])], 'base', true)
    expect(ranged.min).toBeLessThan(100)
    expect(ranged.max).toBeGreaterThan(200)
    // View mode (no flag) is unchanged — data fits the axis.
    const view = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })])], 'base')
    expect(view.min).toBe(100)
    expect(view.max).toBe(200)
  })

  test('beat stays linear-auto with padding', () => {
    const a = gtrackAxis([voice([pt({ beatFreqHalf: 2 }), pt({ beatFreqHalf: 5 })])], 'beat')
    expect(a.scale).toBe('linear')
    expect(a.min).toBeLessThan(4)
    expect(a.max).toBeGreaterThan(10)
  })

  test('all-noise voices under base fall back to a default linear range', () => {
    const a = gtrackAxis([voice([pt({ baseFreq: 0 }), pt({ baseFreq: 0 })])], 'base')
    expect(a.scale).toBe('linear')
    expect(a.min).toBe(0)
    expect(a.max).toBe(1)
  })

  test('empty voices fall back to a default range', () => {
    const a = gtrackAxis([], 'base')
    expect(a.min).toBe(0)
    expect(a.max).toBe(1)
  })
})

describe('valueToUnit/unitToValue on a log axis (GT2.8)', () => {
  const axis = { min: 10, max: 1000, scale: 'log' as const, topLabel: '', midLabel: '', botLabel: '' }
  test('log mapping: geometric midpoint sits at 0.5; round-trips', () => {
    expect(valueToUnit(10, axis)).toBe(0)
    expect(valueToUnit(1000, axis)).toBe(1)
    expect(valueToUnit(100, axis)).toBeCloseTo(0.5, 9)
    expect(unitToValue(0.5, axis)).toBeCloseTo(100, 6)
    expect(unitToValue(valueToUnit(250, axis), axis)).toBeCloseTo(250, 6)
    expect(valueToUnit(1, axis)).toBe(0) // clamped below min
  })
  test('linear inverse round-trips too', () => {
    const lin = { min: 0, max: 200, scale: 'linear' as const, topLabel: '', midLabel: '', botLabel: '' }
    expect(unitToValue(valueToUnit(50, lin), lin)).toBeCloseTo(50, 9)
  })
})

describe('valuePatchForMode (GT3.2, inverse of pointValue)', () => {
  const apply = (p: GTrackPoint, patch: Record<string, number>): GTrackPoint => ({ ...p, ...patch })

  test('base / beat map back so pointValue round-trips', () => {
    const p = pt({ baseFreq: 100, beatFreqHalf: 5 })
    expect(pointValue(apply(p, valuePatchForMode(p, 'base', 250, false)), 'base')).toBeCloseTo(250, 6)
    expect(pointValue(apply(p, valuePatchForMode(p, 'beat', 12, false)), 'beat')).toBeCloseTo(12, 6)
    // clamps negatives to 0
    expect(valuePatchForMode(p, 'base', -5, false).baseFreq).toBe(0)
    expect(valuePatchForMode(p, 'beat', -5, false).beatFreqHalf).toBe(0)
  })

  test('volume scales L/R preserving balance; mono sets both', () => {
    const p = pt({ volL: 0.2, volR: 0.6 }) // mean 0.4, right-heavy
    const patch = valuePatchForMode(p, 'volume', 0.6, false) // factor 1.5, no channel saturates
    const np = apply(p, patch)
    expect(pointValue(np, 'volume')).toBeCloseTo(0.6, 6)
    expect(pointValue(np, 'balance')).toBeCloseTo(pointValue(p, 'balance'), 6) // ratio preserved
    // saturating the louder channel caps the achievable mean (expected clamp behaviour)
    expect(apply(p, valuePatchForMode(p, 'volume', 0.9, false)).volR).toBe(1)
    // mono: equal L/R
    const mp = valuePatchForMode(pt({ volL: 0.5, volR: 0.5 }), 'volume', 0.3, true)
    expect(mp).toEqual({ volL: 0.3, volR: 0.3 })
    // silence keeps no ratio -> equal
    expect(valuePatchForMode(pt({ volL: 0, volR: 0 }), 'volume', 0.5, false)).toEqual({ volL: 0.5, volR: 0.5 })
  })

  test('balance re-splits the total; mono / silence are no-ops', () => {
    const p = pt({ volL: 0.5, volR: 0.5 }) // total 1
    const full右 = apply(p, valuePatchForMode(p, 'balance', 1, false))
    expect(pointValue(full右, 'balance')).toBeCloseTo(1, 6)
    expect(full右.volL).toBeCloseTo(0, 6)
    expect(full右.volR).toBeCloseTo(1, 6)
    expect(valuePatchForMode(p, 'balance', 0.5, true)).toEqual({}) // mono
    expect(valuePatchForMode(pt({ volL: 0, volR: 0 }), 'balance', 0.5, false)).toEqual({}) // silence
  })
})

describe('valueToUnit (GT2.1)', () => {
  const axis = { min: 0, max: 200, scale: 'linear' as const, topLabel: '', midLabel: '', botLabel: '' }
  test('maps value into [0,1], clamped', () => {
    expect(valueToUnit(0, axis)).toBe(0)
    expect(valueToUnit(100, axis)).toBeCloseTo(0.5, 9)
    expect(valueToUnit(200, axis)).toBe(1)
    expect(valueToUnit(-50, axis)).toBe(0) // clamp
    expect(valueToUnit(999, axis)).toBe(1) // clamp
  })
  test('degenerate axis maps to the centre', () => {
    expect(valueToUnit(5, { min: 3, max: 3, scale: 'linear', topLabel: '', midLabel: '', botLabel: '' })).toBe(0.5)
  })
})
