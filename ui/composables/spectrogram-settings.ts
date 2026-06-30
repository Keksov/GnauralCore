import type {
  SpectrogramAnalysisParams,
  SpectrogramChannelMode,
  SpectrogramDataMode,
  SpectrogramFScale,
  SpectrogramScale,
} from '@protocol'

import type { SpectrogramPalette, SpectrogramRenderOptions } from './spectrogram-render'

// Pure settings model for the spectrogram panel/store (U4.1): the full backend
// capability set (DU4), split into analysis params (worker re-analysis) and render
// options (client-side, live). Option lists drive the panel; mappers feed the
// composable. Kept Vue-free so it is unit-testable + reused by the pinia store.

export interface SpectrogramSettings {
  // analysis (reconfigure -> worker open/reconfigure)
  readonly window: number
  readonly zeroPaddingFactor: number
  readonly hop: number
  readonly overlap: number
  readonly channel: number
  readonly winFunc: string
  readonly data: SpectrogramDataMode
  readonly fscale: SpectrogramFScale
  readonly startHz: number
  readonly stopHz: number
  readonly mode: SpectrogramChannelMode
  // render (client-side, live -- no re-analysis; DU5)
  readonly scale: SpectrogramScale
  readonly gain: number
  readonly frequencyGain: number
  readonly drange: number
  readonly limit: number
  readonly saturation: number
  readonly palette: SpectrogramPalette
}

export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = {
  window: 2048,
  zeroPaddingFactor: 1,
  hop: 512,
  overlap: 0.75,
  channel: 0,
  winFunc: 'hann',
  data: 'magnitude',
  fscale: 'log',
  startHz: 0,
  stopHz: 0,
  mode: 'combined',
  scale: 'log',
  gain: 1,
  frequencyGain: 0,
  drange: 120,
  limit: 0,
  saturation: 1,
  palette: 'intensity',
}

// Full option lists (panel choices) mirroring the backend cli/worker contracts.
export const SPECTROGRAM_WINDOW_SIZES: readonly number[] = [256, 512, 1024, 2048, 4096, 8192, 16384]
export const SPECTROGRAM_ZERO_PADDING: readonly number[] = [1, 2, 4]
export const SPECTROGRAM_WIN_FUNCS: readonly string[] = [
  'hann', 'hamming', 'blackman', 'rect', 'bartlett', 'welch', 'flattop', 'bharris',
  'bnuttall', 'bhann', 'sine', 'nuttall', 'lanczos', 'gauss', 'tukey', 'dolph',
  'cauchy', 'parzen', 'poisson', 'bohman', 'kaiser', 'gauss25', 'gauss35', 'gauss45',
]
export const SPECTROGRAM_DATA_MODES: readonly SpectrogramDataMode[] = [
  'magnitude', 'phase', 'uphase', 'reassign', 'pitch',
]
export const SPECTROGRAM_FSCALES: readonly SpectrogramFScale[] = [
  'lin', 'log', 'mel', 'bark', 'erb', 'period',
]
export const SPECTROGRAM_SCALES: readonly SpectrogramScale[] = [
  'lin', 'sqrt', 'cbrt', 'log', '4thrt', '5thrt',
]
export const SPECTROGRAM_CHANNEL_MODES: readonly SpectrogramChannelMode[] = ['combined', 'separate']
export const SPECTROGRAM_PALETTES: readonly SpectrogramPalette[] = ['intensity', 'rainbow']

/** Render-only options (client, applied live on linear tiles). */
export function toRenderOptions(aSettings: SpectrogramSettings): SpectrogramRenderOptions {
  return {
    scale: aSettings.scale,
    gain: aSettings.gain,
    frequencyGain: aSettings.frequencyGain,
    drange: aSettings.drange,
    limit: aSettings.limit,
    saturation: aSettings.saturation,
    palette: aSettings.palette,
  }
}

/** Analysis params (sent to the worker on open/reconfigure). */
export function toAnalysisParams(aSettings: SpectrogramSettings): SpectrogramAnalysisParams {
  return {
    window: aSettings.window,
    zeroPaddingFactor: aSettings.zeroPaddingFactor,
    hop: aSettings.hop,
    overlap: aSettings.overlap,
    channel: aSettings.channel,
    winFunc: aSettings.winFunc,
    data: aSettings.data,
    fscale: aSettings.fscale,
    start: aSettings.startHz,
    stop: aSettings.stopHz,
    mode: aSettings.mode,
  }
}
