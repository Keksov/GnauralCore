import { describe, expect, test } from 'bun:test'

import { amplitudeToUnit, peaksToColumns } from './waveform-render'

describe('amplitudeToUnit (SF22.2)', () => {
  test('linear passes the amplitude through, clamped to [-1,1]', () => {
    expect(amplitudeToUnit(0, 'linear')).toBe(0)
    expect(amplitudeToUnit(0.5, 'linear')).toBe(0.5)
    expect(amplitudeToUnit(-0.5, 'linear')).toBe(-0.5)
    expect(amplitudeToUnit(2, 'linear')).toBe(1)
    expect(amplitudeToUnit(-2, 'linear')).toBe(-1)
  })

  test('db maps |amp| onto [floor,0] dBFS and keeps the sign', () => {
    // full scale -> ±1
    expect(amplitudeToUnit(1, 'db', -60)).toBeCloseTo(1, 6)
    expect(amplitudeToUnit(-1, 'db', -60)).toBeCloseTo(-1, 6)
    // silence -> 0 (centre)
    expect(amplitudeToUnit(0, 'db', -60)).toBe(0)
    // -6 dB over a 60 dB floor -> 1 - 6/60 = 0.9
    expect(amplitudeToUnit(0.5, 'db', -60)).toBeCloseTo(1 - 6.0206 / 60, 3)
    // below the floor clamps to 0
    expect(amplitudeToUnit(1e-6, 'db', -60)).toBe(0)
  })
})

describe('peaksToColumns (SF22.2)', () => {
  test('maps each peak to unit envelope + rms', () => {
    const cols = peaksToColumns([{ min: -0.5, max: 1, rms: 0.5 }], 'linear')
    expect(cols[0]).toEqual({ maxU: 1, minU: -0.5, rmsU: 0.5 })
  })
})
