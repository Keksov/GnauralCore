import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  mergeStoredSettings,
  SPECTROGRAM_DATA_MODES,
  SPECTROGRAM_FSCALES,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  SPECTROGRAM_PRESETS,
  SPECTROGRAM_WIN_FUNCS,
  presetSettings,
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

describe('capability coverage + presets (U4.3)', () => {
  test('settings expose every DU4 capability (all keys present)', () => {
    expect(Object.keys(DEFAULT_SPECTROGRAM_SETTINGS).sort()).toEqual(
      [
        'data', 'drange', 'frequencyGain', 'fscale', 'gain', 'limit',
        'mode', 'overlap', 'palette', 'saturation', 'scale', 'startHz', 'stopHz',
        'window', 'winFunc', 'zeroPaddingFactor',
      ].sort(),
    )
  })

  test('Audacity + ffmpeg presets exist and are valid settings', () => {
    expect(SPECTROGRAM_PRESETS.map((p) => p.name)).toEqual(['audacity', 'ffmpeg'])
    for (const preset of SPECTROGRAM_PRESETS) {
      // a valid settings object round-trips unchanged through the persistence validator
      expect(mergeStoredSettings(preset.settings)).toEqual(preset.settings)
    }
  })

  test('preset character: ffmpeg=lin/sqrt, audacity=log/log', () => {
    expect(presetSettings('ffmpeg')?.fscale).toBe('lin')
    expect(presetSettings('ffmpeg')?.scale).toBe('sqrt')
    expect(presetSettings('audacity')?.fscale).toBe('log')
    expect(presetSettings('audacity')?.scale).toBe('log')
    expect(presetSettings('audacity' as never)).not.toBeNull()
  })
})

describe('mergeStoredSettings (U4.2 persistence)', () => {
  test('applies valid stored values over the defaults', () => {
    const merged = mergeStoredSettings({ window: 4096, fscale: 'mel', palette: 'rainbow', gain: 3 })
    expect(merged.window).toBe(4096)
    expect(merged.fscale).toBe('mel')
    expect(merged.palette).toBe('rainbow')
    expect(merged.gain).toBe(3)
    expect(merged.overlap).toBe(DEFAULT_SPECTROGRAM_SETTINGS.overlap) // untouched key keeps default
  })

  test('rejects wrong types, invalid enums and unknown keys', () => {
    const merged = mergeStoredSettings({
      window: 'big',
      fscale: 'spiral',
      winFunc: 'nope',
      gain: Number.NaN,
      bogus: 123,
    })
    expect(merged.window).toBe(DEFAULT_SPECTROGRAM_SETTINGS.window)
    expect(merged.fscale).toBe(DEFAULT_SPECTROGRAM_SETTINGS.fscale)
    expect(merged.winFunc).toBe(DEFAULT_SPECTROGRAM_SETTINGS.winFunc)
    expect(merged.gain).toBe(DEFAULT_SPECTROGRAM_SETTINGS.gain)
    expect('bogus' in merged).toBe(false)
  })

  test('non-object input -> defaults', () => {
    expect(mergeStoredSettings(null)).toEqual(DEFAULT_SPECTROGRAM_SETTINGS)
    expect(mergeStoredSettings('x')).toEqual(DEFAULT_SPECTROGRAM_SETTINGS)
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
