import { describe, expect, test } from 'bun:test'

import {
  chooseZoom,
  frequencyGainFactor,
  magnitudeToScaled,
  paletteColor,
  tileToImage,
} from './spectrogram-render'
import type { SpectrogramTile } from '@protocol'

describe('magnitudeToScaled - log/dB (U2.3)', () => {
  test('0 dB (unit magnitude) -> 1.0; silence -> 0', () => {
    expect(magnitudeToScaled(1, { scale: 'log' })).toBeCloseTo(1, 6)
    expect(magnitudeToScaled(0, { scale: 'log' })).toBe(0)
  })

  test('-drange dB -> 0; -60 dB -> mid (drange 120)', () => {
    expect(magnitudeToScaled(Math.pow(10, -120 / 20), { scale: 'log', drange: 120 })).toBeCloseTo(0, 6)
    expect(magnitudeToScaled(Math.pow(10, -60 / 20), { scale: 'log', drange: 120 })).toBeCloseTo(0.5, 6)
  })

  test('gain x2 ~= +6 dB', () => {
    const m = Math.pow(10, -60 / 20)
    const base = magnitudeToScaled(m, { scale: 'log', drange: 120 })
    const gained = magnitudeToScaled(m, { scale: 'log', drange: 120, gain: 2 })
    expect(gained - base).toBeCloseTo(6.0206 / 120, 3)
  })
})

describe('magnitudeToScaled - scale family (U2.3)', () => {
  test('lin clips to the [limit-drange, limit] linear bounds', () => {
    expect(magnitudeToScaled(1, { scale: 'lin', drange: 120, limit: 0 })).toBeCloseTo(1, 6)
    expect(magnitudeToScaled(0.5, { scale: 'lin', drange: 120, limit: 0 })).toBeCloseTo(0.5, 4)
    expect(magnitudeToScaled(Math.pow(10, -120 / 20), { scale: 'lin', drange: 120 })).toBeCloseTo(0, 6)
  })

  test('sqrt = sqrt(lin); ordering lin < sqrt < cbrt for a mid value', () => {
    const lin = magnitudeToScaled(0.25, { scale: 'lin' })
    const sqrt = magnitudeToScaled(0.25, { scale: 'sqrt' })
    const cbrt = magnitudeToScaled(0.25, { scale: 'cbrt' })
    expect(sqrt).toBeCloseTo(Math.sqrt(lin), 6)
    expect(lin).toBeLessThan(sqrt)
    expect(sqrt).toBeLessThan(cbrt)
  })
})

describe('paletteColor (U2.3, SF16.2 Audacity schemes)', () => {
  test('grayscale is v -> gray', () => {
    expect(paletteColor(0, 'grayscale')).toEqual([0, 0, 0])
    expect(paletteColor(1, 'grayscale')).toEqual([255, 255, 255])
    expect(paletteColor(0.5, 'grayscale')).toEqual([128, 128, 128])
  })

  test('invgrayscale is (1-v) -> gray', () => {
    expect(paletteColor(0, 'invgrayscale')).toEqual([255, 255, 255])
    expect(paletteColor(1, 'invgrayscale')).toEqual([0, 0, 0])
  })

  test('classic goes blue(low) -> green(mid) -> red(high)', () => {
    expect(paletteColor(0, 'classic')).toEqual([0, 0, 255])
    expect(paletteColor(0.5, 'classic')).toEqual([0, 255, 0])
    expect(paletteColor(1, 'classic')).toEqual([255, 0, 0])
  })

  test('saturation 0 desaturates the classic rainbow to gray', () => {
    expect(paletteColor(1, 'classic', 0)).toEqual([255, 255, 255])
  })

  test('roseus (Audacity default LUT): dark near 0, cream near 1', () => {
    expect(paletteColor(0, 'roseus')).toEqual([1, 1, 1])
    expect(paletteColor(1, 'roseus')).toEqual([254, 251, 249])
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

describe('tileToImage (U2.3)', () => {
  test('width=frames, height=bins; top row = highest freq (grayscale)', () => {
    const img = tileToImage(fakeTile([[0, 1]]), { palette: 'grayscale' })
    expect(img.width).toBe(1)
    expect(img.height).toBe(2)
    expect(img.rgba[0]).toBe(255) // row 0 = bin1 (high) = 1 -> white
    expect(img.rgba[4]).toBe(0) // row 1 = bin0 (low) = 0 -> black
    expect(img.rgba[3]).toBe(255) // alpha
  })

  test('applies the classic palette to the linear tile', () => {
    const img = tileToImage(fakeTile([[1]]), { scale: 'lin', palette: 'classic' })
    // single full-scale bin -> classic high -> red
    expect([img.rgba[0], img.rgba[1], img.rgba[2]]).toEqual([255, 0, 0])
  })

  test('missing bins are safe (0 intensity)', () => {
    const tile = fakeTile([[0.5]])
    const broken: SpectrogramTile = { ...tile, frames: [{ frameIndex: 0, timeSec: 0, bins: [] }] }
    expect(tileToImage(broken, { palette: 'grayscale' }).rgba[0]).toBe(0)
  })
})

describe('frequencyGainFactor (U4.1)', () => {
  test('1.0 at 1 kHz, boosts highs / cuts lows by dB-per-decade', () => {
    expect(frequencyGainFactor(1000, 20)).toBeCloseTo(1, 6)
    expect(frequencyGainFactor(10000, 20)).toBeCloseTo(10, 6) // +20 dB/decade
    expect(frequencyGainFactor(100, 20)).toBeCloseTo(0.1, 6) // -20 dB/decade
    expect(frequencyGainFactor(5000, 0)).toBe(1) // disabled
  })
})

describe('chooseZoom (U2.2)', () => {
  test('0 when frames fit; grows with the ratio', () => {
    expect(chooseZoom(200, 800)).toBe(0)
    expect(chooseZoom(1600, 800)).toBe(1)
    expect(chooseZoom(10000, 800)).toBe(4)
    expect(chooseZoom(0, 800)).toBe(0)
  })
})
