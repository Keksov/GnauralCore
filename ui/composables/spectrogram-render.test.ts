import { describe, expect, test } from 'bun:test'

import { chooseZoom, magnitudeToIntensity, tileToImage } from './spectrogram-render'
import type { SpectrogramTile } from '@protocol'

describe('magnitudeToIntensity (U2.2)', () => {
  test('0 dB (unit magnitude) maps to 1.0; silence to 0', () => {
    expect(magnitudeToIntensity(1)).toBeCloseTo(1, 6)
    expect(magnitudeToIntensity(0)).toBe(0)
  })

  test('-drange dB maps to 0 (bottom of the range)', () => {
    const drange = 120
    const m = Math.pow(10, -drange / 20) // exactly -120 dB
    expect(magnitudeToIntensity(m, { drange })).toBeCloseTo(0, 6)
  })

  test('-60 dB with drange 120 maps to the middle', () => {
    const m = Math.pow(10, -60 / 20)
    expect(magnitudeToIntensity(m, { drange: 120 })).toBeCloseTo(0.5, 6)
  })

  test('gain raises the level (x2 ~= +6 dB)', () => {
    const m = Math.pow(10, -60 / 20)
    const base = magnitudeToIntensity(m, { drange: 120 })
    const gained = magnitudeToIntensity(m, { drange: 120, gain: 2 })
    expect(gained - base).toBeCloseTo(6.0206 / 120, 3)
  })
})

function fakeTile(binValuesPerFrame: number[][]): SpectrogramTile {
  const binCount = binValuesPerFrame[0]?.length ?? 0
  return {
    analysisId: 'a',
    frameStart: 0,
    frameCount: binValuesPerFrame.length,
    emittedFrameCount: binValuesPerFrame.length,
    zoom: 0,
    binStart: 0,
    binCount,
    data: 'magnitude',
    fscale: 'lin',
    viewStartHz: 0,
    viewStopHz: 22050,
    binFrequenciesHz: Array.from({ length: binCount }, (_v, i) => i),
    frames: binValuesPerFrame.map((bins, frameIndex) => ({ frameIndex, timeSec: frameIndex, bins })),
  }
}

describe('tileToImage (U2.2)', () => {
  test('produces width=frames, height=bins RGBA with top row = highest freq', () => {
    // 1 frame, 2 bins: bin0 (low) silent, bin1 (high) full-scale
    const img = tileToImage(fakeTile([[0, 1]]))
    expect(img.width).toBe(1)
    expect(img.height).toBe(2)
    expect(img.rgba.length).toBe(1 * 2 * 4)
    // row 0 = highest bin (bin1, value 1) -> white
    expect(img.rgba[0]).toBe(255)
    expect(img.rgba[3]).toBe(255) // alpha
    // row 1 = lowest bin (bin0, value 0) -> black
    expect(img.rgba[4]).toBe(0)
    expect(img.rgba[7]).toBe(255)
  })

  test('handles a missing/short bins array without throwing', () => {
    const tile = fakeTile([[0.5, 0.5]])
    const broken: SpectrogramTile = { ...tile, frames: [{ frameIndex: 0, timeSec: 0, bins: [] }] }
    const img = tileToImage(broken)
    expect(img.width).toBe(1)
    expect(img.rgba[0]).toBe(0) // missing bin -> 0 intensity
  })
})

describe('chooseZoom (U2.2)', () => {
  test('0 when frames fit the target columns', () => {
    expect(chooseZoom(200, 800)).toBe(0)
    expect(chooseZoom(800, 800)).toBe(0)
  })

  test('grows with the frames/columns ratio (2^z pooling)', () => {
    expect(chooseZoom(1600, 800)).toBe(1)
    expect(chooseZoom(3200, 800)).toBe(2)
    expect(chooseZoom(10000, 800)).toBe(4)
  })

  test('safe on degenerate inputs', () => {
    expect(chooseZoom(0, 800)).toBe(0)
    expect(chooseZoom(800, 0)).toBe(0)
  })
})
