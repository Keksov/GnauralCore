import { describe, expect, test } from 'bun:test'

import type { GTrackPoint, GTrackVoice } from './gtrack-model'
import { GTRACK_MODES, gtrackAxis, pointValue, valueToUnit } from './gtrack-render'

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

  test('frequency auto-ranges across voices with padding, floored at 0', () => {
    const a = gtrackAxis([
      voice([pt({ baseFreq: 100 }), pt({ baseFreq: 200 })]),
      voice([pt({ baseFreq: 0 })]), // e.g. a noise voice
    ], 'base')
    expect(a.min).toBe(0) // floored
    expect(a.max).toBeGreaterThan(200) // padded above the max
  })

  test('a single flat frequency still gets a visible band', () => {
    const a = gtrackAxis([voice([pt({ baseFreq: 144 }), pt({ baseFreq: 144 })])], 'base')
    expect(a.min).toBeLessThan(144)
    expect(a.max).toBeGreaterThan(144)
  })

  test('empty voices fall back to a default range', () => {
    const a = gtrackAxis([], 'base')
    expect(a.min).toBe(0)
    expect(a.max).toBe(1)
  })
})

describe('valueToUnit (GT2.1)', () => {
  const axis = { min: 0, max: 200, topLabel: '', midLabel: '', botLabel: '' }
  test('maps value into [0,1], clamped', () => {
    expect(valueToUnit(0, axis)).toBe(0)
    expect(valueToUnit(100, axis)).toBeCloseTo(0.5, 9)
    expect(valueToUnit(200, axis)).toBe(1)
    expect(valueToUnit(-50, axis)).toBe(0) // clamp
    expect(valueToUnit(999, axis)).toBe(1) // clamp
  })
  test('degenerate axis maps to the centre', () => {
    expect(valueToUnit(5, { min: 3, max: 3, topLabel: '', midLabel: '', botLabel: '' })).toBe(0.5)
  })
})
