import { describe, expect, test } from 'bun:test'

import {
  formatHz,
  formatTimeSec,
  frequencyAxisTicks,
  niceStep,
  timeAxisTicks,
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
