import { describe, expect, test } from 'bun:test'

import type { GTrackPoint, GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, axisWithRange, balanceEdgeToBalance, ctrlStepValue, gtrackAxis, pointValue, unitToValue, valuePatchForMode, valueToUnit, type GTrackAxis } from './gtrack-render'

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

  test('ctrlStepValue: ±1 big step, clamped per field (GT10.22)', () => {
    expect(ctrlStepValue(100, 'baseFreq', 1)).toBe(101)
    expect(ctrlStepValue(100, 'baseFreq', -1)).toBe(99)
    expect(ctrlStepValue(0.3, 'volL', 1)).toBe(1) // volume capped at 1
    expect(ctrlStepValue(0.3, 'volR', -1)).toBe(0) // never negative
    expect(ctrlStepValue(0.5, 'timeSec', -1)).toBe(0) // time never negative
    expect(ctrlStepValue(Number.NaN, 'beatFreq', 1)).toBe(1) // non-finite -> from 0
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

describe('gtrackAxis baseScale override (TS-D3, owner 2026-07-18)', () => {
  test("baseScale='linear' forces a LINEAR base axis over the data range (padded)", () => {
    const a = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })])], 'base', false, false, 'linear')
    expect(a.scale).toBe('linear')
    // linear (arithmetic) midpoint, unlike the log axis's geometric ~141
    expect(a.midLabel).toBe('150')
    expect(a.min).toBeLessThanOrEqual(100)
    expect(a.max).toBeGreaterThanOrEqual(200)
    expect(a.min).toBeGreaterThanOrEqual(0)
  })

  test("the default (omitted / 'log') is unchanged — still a log axis", () => {
    const omitted = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })])], 'base')
    const explicit = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })])], 'base', false, false, 'log')
    expect(omitted.scale).toBe('log')
    expect(explicit.scale).toBe('log')
    expect([explicit.min, explicit.max, explicit.midLabel]).toEqual([omitted.min, omitted.max, omitted.midLabel])
  })

  test("base data reaching 0 goes symlog on 'log' but plain linear on 'linear' (0 placed directly)", () => {
    const voices = [voice([pt({ baseFreq: 100 }), pt({ baseFreq: 0 })])]
    expect(gtrackAxis(voices, 'base', false, false, 'log').scale).toBe('symlog')
    const lin = gtrackAxis(voices, 'base', false, false, 'linear')
    expect(lin.scale).toBe('linear')
    expect(lin.min).toBe(0)
  })

  test('baseScale does not affect non-base modes (fixed volume/balance, linear beat)', () => {
    expect(gtrackAxis([voice([pt({ volL: 1, volR: 1 })])], 'volume', false, false, 'linear').max).toBe(1)
    expect(gtrackAxis([voice([pt({})])], 'balance', false, false, 'linear').min).toBe(-1)
    expect(gtrackAxis([voice([pt({ beatFreqHalf: 2 }), pt({ beatFreqHalf: 5 })])], 'beat', false, false, 'linear').scale).toBe('linear')
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

describe('balanceEdgeToBalance (VB1.1, corridor edge -> balance, VB-D3 variant A)', () => {
  test('|balance| = |amp - V| / V, sign preserved, clamped to 1', () => {
    // V = 0.5, right-heavy (sign +1): an edge at 0.75 -> half 0.25 -> |b| 0.5.
    expect(balanceEdgeToBalance(0.5, 0.75, 1)).toBeCloseTo(0.5, 9)
    // dragging past the centre line snaps back by |amp - V| (beat-identical abs mapping).
    expect(balanceEdgeToBalance(0.5, 0.25, 1)).toBeCloseTo(0.5, 9)
    // left-heavy keeps the negative sign.
    expect(balanceEdgeToBalance(0.5, 0.75, -1)).toBeCloseTo(-0.5, 9)
    // a quiet centre saturates fast -> clamp to |1|.
    expect(balanceEdgeToBalance(0.2, 1, 1)).toBe(1)
    // on the centre line the corridor is closed.
    expect(balanceEdgeToBalance(0.5, 0.5, 1)).toBe(0)
  })
  test('degenerate: silence and centred points map to 0 (no corridor to grab)', () => {
    expect(balanceEdgeToBalance(0, 0.5, 1)).toBe(0) // silence: volume 0
    expect(balanceEdgeToBalance(0.5, 0.9, 0)).toBe(0) // sign 0: centred, no edge
  })
  test('round-trips through valuePatchForMode: volume fixed, dragged edge reaches the cursor', () => {
    const p = pt({ volL: 0.3, volR: 0.5 }) // V = 0.4, right-heavy (sign +1), upper edge volR at 0.5
    const b = balanceEdgeToBalance(0.4, 0.6, 1) // drag the upper edge up to 0.6 -> half 0.2 -> b 0.5
    const np = { ...p, ...valuePatchForMode(p, 'balance', b, false) }
    expect(pointValue(np, 'volume')).toBeCloseTo(0.4, 9) // volume unchanged
    expect(np.volR).toBeCloseTo(0.6, 9) // upper edge now sits at the cursor
    expect(np.volL).toBeCloseTo(0.2, 9) // lower edge moved symmetrically (0.4 - 0.2)
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

// GT11.13: Alt+wheel Y zoom maps a normalized [0,1] window (spectrogram-viewport.zoomUnitWindow)
// onto the lane's value range through this helper.
const LIN: GTrackAxis = { min: 0, max: 10, scale: 'linear', topLabel: '', midLabel: '', botLabel: '' }
const LOG: GTrackAxis = { min: 10, max: 1000, scale: 'log', topLabel: '', midLabel: '', botLabel: '' }

describe('axisWithRange (GT11.13)', () => {
  test('applies the range, keeps the scale, uses the GEOMETRIC mid on a log axis', () => {
    const a = axisWithRange(LOG, 10, 1000)
    expect([a.min, a.max, a.scale]).toEqual([10, 1000, 'log'])
    expect(a.midLabel).toBe('100') // geometric (10^2), not the arithmetic 505
    expect(a.botLabel).toBe('10')
    expect(a.topLabel).toBe('1000')
  })

  test('uses the arithmetic mid on a linear axis', () => {
    expect(axisWithRange(LIN, 0, 10).midLabel).toBe('5.0')
  })
})

// GT11.17 (owner 2026-07-15): a schedule may legitimately contain baseFreq 0, which a log axis
// cannot place (log10(0) = -Inf). The Base axis becomes symlog: linear 0..threshold, log above.
describe('symlog base axis (GT11.17)', () => {
  const zeroVoice = voice([pt({ timeSec: 0, baseFreq: 100 }), pt({ timeSec: 1, baseFreq: 0 }), pt({ timeSec: 2, baseFreq: 100 })])

  test('a base axis whose data reaches 0 becomes symlog with 0 at the bottom', () => {
    const a = gtrackAxis([zeroVoice], 'base')
    expect(a.scale).toBe('symlog')
    expect(a.min).toBe(0)
    expect(a.botLabel).toBe('0.0')
    expect(valueToUnit(0, a)).toBe(0) // 0 sits exactly on the floor, not clamped up to the minimum
  })

  test('the OLD bug: 0 no longer renders where the flat 100 Hz points sit', () => {
    // wakeup.gnaural is a flat ~100 Hz voice; before the fix the axis stayed 100..125 and a point
    // edited to 0 clamped onto the bottom — exactly where every 100 Hz point already was.
    const a = gtrackAxis([zeroVoice], 'base')
    expect(valueToUnit(0, a)).toBeLessThan(valueToUnit(100, a) - 0.5)
  })

  test('a base axis without zeros stays logarithmic (classic editor look unchanged)', () => {
    expect(gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 400 })])], 'base').scale).toBe('log')
  })

  test('symlog is monotonic and round-trips through unitToValue', () => {
    const a = gtrackAxis([zeroVoice], 'base')
    let previous = -1
    for (const v of [0, 0.25, 0.5, 1, 2, 10, 50, 100]) {
      const u = valueToUnit(v, a)
      expect(u).toBeGreaterThan(previous)
      expect(unitToValue(u, a)).toBeCloseTo(v, 6)
      previous = u
    }
  })

  test('the linear segment holds 0..threshold, the log segment everything above', () => {
    const a = gtrackAxis([zeroVoice], 'base')
    expect(valueToUnit(1, a)).toBeCloseTo(0.12, 6) // threshold = the linear/log seam
    expect(valueToUnit(0.5, a)).toBeCloseTo(0.06, 6) // half of it -> half the linear segment
  })

  test('a NOISE voice (base 0 throughout) is still ignored — it must not drag the axis to symlog', () => {
    const a = gtrackAxis([
      voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })]),
      voice([pt({ baseFreq: 0 }), pt({ baseFreq: 0 })]), // noise: no carrier to plot
    ], 'base')
    expect(a.scale).toBe('log')
    expect(a.min).toBe(100)
  })

  test('a TONE voice that visits 0 goes symlog — the zero is part of the curve', () => {
    const a = gtrackAxis([voice([pt({ baseFreq: 100 }), pt({ baseFreq: 0 })])], 'base')
    expect(a.scale).toBe('symlog')
  })

  test('axisWithRange keeps symlog and reads the mid back from the piecewise map', () => {
    const a = axisWithRange(gtrackAxis([zeroVoice], 'base'), 0, 100)
    expect(a.scale).toBe('symlog')
    expect(a.midLabel).toBe(formatMid(a))
  })
})

function formatMid(a: GTrackAxis): string {
  const v = unitToValue(0.5, a)
  return v >= 100 ? `${Math.round(v)}` : v >= 10 ? v.toFixed(0) : v.toFixed(1)
}
