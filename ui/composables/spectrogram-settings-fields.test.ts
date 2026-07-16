import { describe, expect, test } from 'bun:test'

import {
  clamp,
  layoutForWidth,
  SPECTRUM_TILES_THRESHOLD_PX,
  type SpinSpec,
} from './spectrogram-settings-fields'

describe('clamp (SF16.1 spinbox) (SS2.1)', () => {
  const gain: SpinSpec = { min: -60, max: 60, step: 1, decimals: 0 }
  const saturation: SpinSpec = { min: 0, max: 1, step: 0.1, decimals: 1 }

  test('bounds to [min,max]', () => {
    expect(clamp(999, gain)).toBe(60)
    expect(clamp(-999, gain)).toBe(-60)
    expect(clamp(12, gain)).toBe(12)
  })

  test('rounds to the step (kills FP drift from repeated +/-)', () => {
    // 0.1 + 0.2 = 0.30000000000000004; the step-round + toFixed must land on 0.3, not a drifted value.
    expect(clamp(0.1 + 0.2, saturation)).toBe(0.3)
    expect(clamp(0.34, saturation)).toBe(0.3)
    expect(clamp(0.36, saturation)).toBe(0.4)
  })

  test('the .5 boundary is itself subject to FP: 0.35 rounds DOWN, because 0.35/0.1 === 3.4999…', () => {
    // Documented, not a bug to "fix": clamp is verbatim from the pre-SS2.1 panel, so this is the
    // behaviour the slider steppers always had. Left explicit so a later reader does not "correct" it.
    expect(0.35 / 0.1).toBeLessThan(3.5)
    expect(clamp(0.35, saturation)).toBe(0.3)
  })

  test('snaps an off-grid value to the nearest step', () => {
    expect(clamp(12.7, gain)).toBe(13)
  })
})

describe('layoutForWidth (SS-D4 tiles<->accordion) (SS2.1)', () => {
  test('tiles only once two blocks fit side by side', () => {
    expect(layoutForWidth(SPECTRUM_TILES_THRESHOLD_PX)).toBe('tiles')
    expect(layoutForWidth(SPECTRUM_TILES_THRESHOLD_PX + 200)).toBe('tiles')
    expect(layoutForWidth(SPECTRUM_TILES_THRESHOLD_PX - 1)).toBe('accordion')
    expect(layoutForWidth(320)).toBe('accordion')
  })
})
