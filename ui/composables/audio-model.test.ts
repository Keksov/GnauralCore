import { describe, expect, test } from 'bun:test'

import {
  AUDIO_MIN_DB,
  amplitudeToDb,
  computePeaks,
  sampleAt,
  sampleToTime,
  timeToSample,
} from './audio-model'

describe('audio-model time<->sample (SF22.1)', () => {
  test('time<->sample round-trips at a sample rate', () => {
    expect(timeToSample(2, 44100)).toBe(88200)
    expect(sampleToTime(88200, 44100)).toBeCloseTo(2, 9)
    expect(sampleToTime(100, 0)).toBe(0) // guard against /0
  })
})

describe('audio-model amplitudeToDb (SF22.1)', () => {
  test('0 dBFS at full scale, floor at silence', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0, 6)
    expect(amplitudeToDb(-1)).toBeCloseTo(0, 6) // magnitude
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 3)
    expect(amplitudeToDb(0)).toBe(AUDIO_MIN_DB)
    expect(amplitudeToDb(1e-30)).toBe(AUDIO_MIN_DB)
  })
})

describe('audio-model sampleAt (SF22.1)', () => {
  const data = new Float32Array([0, 0.25, 0.5, 0.75, 1])
  test('nearest sample; clamps outside the buffer; empty -> 0', () => {
    expect(sampleAt(data, 0, 1)).toBe(0)
    expect(sampleAt(data, 2, 1)).toBe(0.5)
    expect(sampleAt(data, 100, 1)).toBe(1) // clamp high
    expect(sampleAt(data, -5, 1)).toBe(0) // clamp low
    expect(sampleAt(new Float32Array(0), 1, 1)).toBe(0)
  })
})

describe('audio-model computePeaks (SF22.1)', () => {
  test('min/max envelope + RMS per bucket over the whole buffer', () => {
    const data = new Float32Array([-1, -0.5, 0.5, 1]) // rms = sqrt((1+0.25+0.25+1)/4)=sqrt(0.625)
    const [peak] = computePeaks(data, 0, data.length, 1)
    expect(peak?.min).toBe(-1)
    expect(peak?.max).toBe(1)
    expect(peak?.rms).toBeCloseTo(Math.sqrt(0.625), 9)
  })

  test('splits into equal buckets', () => {
    const data = new Float32Array([-1, -1, 1, 1])
    const peaks = computePeaks(data, 0, 4, 2)
    expect(peaks.length).toBe(2)
    expect(peaks[0]).toEqual({ min: -1, max: -1, rms: 1 })
    expect(peaks[1]).toEqual({ min: 1, max: 1, rms: 1 })
  })

  test('more buckets than samples -> nearest-sample fallback (no gaps)', () => {
    const data = new Float32Array([0.3, -0.4])
    const peaks = computePeaks(data, 0, 2, 4)
    expect(peaks.length).toBe(4)
    for (const p of peaks) expect(p.min).toBe(p.max) // each bucket is a single sample
  })

  test('empty / degenerate ranges -> []', () => {
    expect(computePeaks(new Float32Array([1, 2, 3]), 2, 2, 4)).toEqual([])
    expect(computePeaks(new Float32Array([1, 2, 3]), 0, 3, 0)).toEqual([])
    expect(computePeaks(new Float32Array(0), 0, 0, 4)).toEqual([])
  })
})
