import { describe, expect, test } from 'bun:test'

import {
  areaQueryBounds,
  formatHz,
  formatTimeSec,
  frequencyAtFraction,
  frequencyAxisTicks,
  niceStep,
  timeAxisTicks,
  timeAxisTicksWithMinor,
} from './spectrogram-axes'

describe('frequencyAxisTicks (U3.1)', () => {
  const bins = Array.from({ length: 513 }, (_v, i) => (i * 22050) / 512) // lin 0..22050

  test('top tick = highest freq, bottom tick = lowest', () => {
    const ticks = frequencyAxisTicks(bins, 6)
    expect(ticks.length).toBe(6)
    expect(ticks[0]?.position).toBe(0) // top
    expect(ticks[0]?.value).toBeCloseTo(22050, 0)
    expect(ticks[ticks.length - 1]?.position).toBe(1) // bottom
    expect(ticks[ticks.length - 1]?.value).toBeCloseTo(0, 6)
  })

  test('honours the supplied (fscale-mapped) bin frequencies, not a linear guess', () => {
    // a log-ish mapping: ticks must read back the actual bin values
    const logBins = [100, 200, 400, 800, 1600] // already fscale-mapped, ascending
    const ticks = frequencyAxisTicks(logBins, 5)
    expect(ticks.map((t) => t.value)).toEqual([1600, 800, 400, 200, 100])
  })

  test('empty bins -> no ticks', () => {
    expect(frequencyAxisTicks([], 6)).toEqual([])
  })
})

describe('frequencyAtFraction (U5.1 hover)', () => {
  const bins = [0, 100, 200, 300, 400] // ascending; bin0 = lowest
  test('top fraction = highest freq, bottom = lowest, mid = middle', () => {
    expect(frequencyAtFraction(0, bins)).toBe(400) // top
    expect(frequencyAtFraction(1, bins)).toBe(0) // bottom
    expect(frequencyAtFraction(0.5, bins)).toBe(200) // middle
  })
  test('clamps out-of-range fractions; empty -> 0', () => {
    expect(frequencyAtFraction(-1, bins)).toBe(400)
    expect(frequencyAtFraction(2, bins)).toBe(0)
    expect(frequencyAtFraction(0.5, [])).toBe(0)
  })
})

describe('niceStep + timeAxisTicks (U3.1)', () => {
  test('niceStep picks 1/2/5 x 10^k', () => {
    expect(niceStep(10, 6)).toBe(2)
    expect(niceStep(1, 5)).toBeCloseTo(0.2, 10)
    expect(niceStep(100, 5)).toBe(20)
  })

  test('time ticks land on round seconds with left=0 positions', () => {
    const ticks = timeAxisTicks(0, 10, 6)
    expect(ticks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10])
    expect(ticks[0]?.position).toBe(0)
    expect(ticks[ticks.length - 1]?.position).toBeCloseTo(1, 6)
  })

  test('respects a non-zero start', () => {
    const ticks = timeAxisTicks(3, 9, 6)
    expect(ticks[0]?.value).toBe(3)
    expect(ticks.every((t) => t.position >= 0 && t.position <= 1)).toBe(true)
  })

  test('empty/degenerate range -> no ticks', () => {
    expect(timeAxisTicks(5, 5, 6)).toEqual([])
  })
})

describe('timeAxisTicksWithMinor (SF16.6 Audacity ruler)', () => {
  test('majors match timeAxisTicks; minors subdivide without overlapping majors', () => {
    const { major, minor } = timeAxisTicksWithMinor(0, 10, 6)
    // major step = niceStep(10,6) = 2 -> [0,2,4,6,8,10]
    expect(major.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10])
    // step 2 (lead 2) -> 4 subdivisions -> minor step 0.5; minors exclude the majors
    expect(minor.length).toBeGreaterThan(0)
    for (const m of minor) {
      expect(major.some((mj) => Math.abs(mj.value - m.value) < 1e-6)).toBe(false)
    }
    // a representative minor value (0.5) is present
    expect(minor.some((m) => Math.abs(m.value - 0.5) < 1e-6)).toBe(true)
  })

  test('minor positions stay within [0,1]; degenerate range -> empty', () => {
    const { minor } = timeAxisTicksWithMinor(3, 9, 6)
    expect(minor.every((t) => t.position >= 0 && t.position <= 1)).toBe(true)
    expect(timeAxisTicksWithMinor(5, 5, 6)).toEqual({ major: [], minor: [] })
  })
})

describe('areaQueryBounds (U5.2)', () => {
  const bins = [0, 100, 200, 300, 400] // ascending; bin0 = lowest

  test('orders time + maps both fractions to frequency bounds', () => {
    // p0 lower-left-ish (later time, near bottom), p1 (earlier time, near top)
    const bounds = areaQueryBounds(
      { timeSec: 3, topFraction: 1 }, // bottom -> 0 Hz
      { timeSec: 1, topFraction: 0 }, // top -> 400 Hz
      bins,
    )
    expect(bounds.timeStartSec).toBe(1)
    expect(bounds.timeEndSec).toBe(3)
    expect(bounds.freqStartHz).toBe(0)
    expect(bounds.freqEndHz).toBe(400)
  })

  test('mid-range fractions', () => {
    const bounds = areaQueryBounds({ timeSec: 0, topFraction: 0.25 }, { timeSec: 2, topFraction: 0.75 }, bins)
    expect(bounds.freqStartHz).toBe(100) // topFraction 0.75 -> bin1 = 100
    expect(bounds.freqEndHz).toBe(300) // topFraction 0.25 -> bin3 = 300
  })
})

describe('formatHz / formatTimeSec (U3.1)', () => {
  test('frequency labels', () => {
    expect(formatHz(440)).toBe('440')
    expect(formatHz(4400)).toBe('4.4k')
    expect(formatHz(12000)).toBe('12k')
  })

  test('time labels', () => {
    expect(formatTimeSec(2.5)).toBe('2.50s')
    expect(formatTimeSec(65)).toBe('1:05')
    expect(formatTimeSec(0)).toBe('0.00s')
  })
})
