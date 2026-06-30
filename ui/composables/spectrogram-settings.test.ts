import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  SPECTROGRAM_DATA_MODES,
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_WIN_FUNCS,
  toAnalysisParams,
  toRenderOptions,
} from './spectrogram-settings'

describe('option lists cover the full backend capability set (DU4) (U4.1)', () => {
  test('window functions include the Audacity Gaussians', () => {
    expect(SPECTROGRAM_WIN_FUNCS).toContain('hann')
    expect(SPECTROGRAM_WIN_FUNCS).toContain('gauss25')
    expect(SPECTROGRAM_WIN_FUNCS).toContain('gauss35')
    expect(SPECTROGRAM_WIN_FUNCS).toContain('gauss45')
  })

  test('data modes, fscales, scales, palettes are complete', () => {
    expect(SPECTROGRAM_DATA_MODES).toEqual(['magnitude', 'phase', 'uphase', 'reassign', 'pitch'])
    expect(SPECTROGRAM_FSCALES).toEqual(['lin', 'log', 'mel', 'bark', 'erb', 'period'])
    expect(SPECTROGRAM_SCALES).toEqual(['lin', 'sqrt', 'cbrt', 'log', '4thrt', '5thrt'])
    expect(SPECTROGRAM_PALETTES).toEqual(['intensity', 'rainbow'])
  })
})

describe('settings mappers (U4.1)', () => {
  test('toRenderOptions extracts the client-side render group (incl. frequencyGain)', () => {
    const r = toRenderOptions({ ...DEFAULT_SPECTROGRAM_SETTINGS, gain: 2, palette: 'rainbow', frequencyGain: 10 })
    expect(r).toEqual({
      scale: 'log',
      gain: 2,
      frequencyGain: 10,
      drange: 120,
      limit: 0,
      saturation: 1,
      palette: 'rainbow',
    })
  })

  test('toAnalysisParams maps the worker analysis group (startHz/stopHz -> start/stop)', () => {
    const a = toAnalysisParams({ ...DEFAULT_SPECTROGRAM_SETTINGS, window: 4096, data: 'pitch', fscale: 'mel', startHz: 100, stopHz: 8000 })
    expect(a.window).toBe(4096)
    expect(a.data).toBe('pitch')
    expect(a.fscale).toBe('mel')
    expect(a.start).toBe(100)
    expect(a.stop).toBe(8000)
    expect(a.mode).toBe('combined')
    // render-only fields must NOT leak into the analysis params
    expect((a as Record<string, unknown>).gain).toBeUndefined()
    expect((a as Record<string, unknown>).palette).toBeUndefined()
  })
})
