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
  // SF14 (variant b): `overlap` is the frame-step control (Audacity/ffmpeg style); the
  // worker hop is DERIVED from it (window * (1 - overlap)) in toAnalysisParams. No `hop`
  // field — it was redundant (the worker always let hop win, making overlap a no-op).
  readonly overlap: number
  // SF15.2: no `channel` — the L/R split (AudioPage opens channel 0 + channel 1 as two
  // tracks) decides the channel, overriding any panel value, so it was vestigial.
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

// Defaults mirror Audacity's default spectrogram settings (Scale: Logarithmic,
// 80..4000 Hz; Gain 0 dB, Range 120 dB, HF boost 0; FFT: Frequencies/magnitude,
// window 2048 Hann, zero-padding factor 2; colour palette).
export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = {
  window: 2048,
  zeroPaddingFactor: 2,
  overlap: 0.75,
  winFunc: 'hann',
  data: 'magnitude',
  fscale: 'log',
  startHz: 80,
  stopHz: 4000,
  mode: 'combined',
  scale: 'log',
  gain: 1,
  frequencyGain: 0,
  drange: 120,
  limit: 0,
  saturation: 1,
  palette: 'roseus',
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
// SF16.2: the four Audacity color schemes (Розовый / Классика / Оттенки серого / Инверсия).
export const SPECTROGRAM_PALETTES: readonly SpectrogramPalette[] = [
  'roseus', 'classic', 'grayscale', 'invgrayscale',
]

// Legacy palette ids (pre-SF16.2) -> current, so stored/preset values still resolve.
const LEGACY_PALETTES: Readonly<Record<string, SpectrogramPalette>> = {
  intensity: 'grayscale',
  rainbow: 'classic',
}
function normalizePalette(aValue: unknown): SpectrogramPalette | null {
  if (typeof aValue !== 'string') return null
  if (SPECTROGRAM_PALETTES.includes(aValue as SpectrogramPalette)) return aValue as SpectrogramPalette
  return LEGACY_PALETTES[aValue] ?? null
}

export type SpectrogramPresetName = 'audacity' | 'ffmpeg'

export interface SpectrogramPreset {
  readonly name: SpectrogramPresetName
  readonly label: string
  readonly settings: SpectrogramSettings
}

/** Selectable presets (U4.3): approximate the two reference tools' defaults. */
export const SPECTROGRAM_PRESETS: readonly SpectrogramPreset[] = [
  {
    name: 'audacity',
    label: 'Audacity',
    settings: {
      ...DEFAULT_SPECTROGRAM_SETTINGS,
      window: 2048,
      zeroPaddingFactor: 2,
      winFunc: 'hann',
      fscale: 'log',
      scale: 'log',
      data: 'magnitude',
      startHz: 80,
      stopHz: 4000,
      drange: 120,
      palette: 'roseus',
    },
  },
  {
    name: 'ffmpeg',
    label: 'ffmpeg showspectrumpic',
    settings: {
      ...DEFAULT_SPECTROGRAM_SETTINGS,
      window: 2048,
      winFunc: 'hann',
      fscale: 'lin',
      scale: 'sqrt',
      data: 'magnitude',
      overlap: 0,
      drange: 120,
      palette: 'grayscale',
    },
  },
]

export function presetSettings(aName: SpectrogramPresetName): SpectrogramSettings | null {
  return SPECTROGRAM_PRESETS.find((preset) => preset.name === aName)?.settings ?? null
}

/**
 * Merge a parsed (untrusted, e.g. localStorage) value over the defaults, keeping
 * only known keys with valid types/enums. Used for settings persistence (U4.2).
 */
export function mergeStoredSettings(aRaw: unknown): SpectrogramSettings {
  const base = { ...DEFAULT_SPECTROGRAM_SETTINGS }
  if (typeof aRaw !== 'object' || aRaw === null) {
    return base
  }
  const raw = aRaw as Record<string, unknown>
  const num = (aKey: keyof SpectrogramSettings, aCurrent: number): number =>
    typeof raw[aKey] === 'number' && Number.isFinite(raw[aKey]) ? (raw[aKey] as number) : aCurrent
  const pick = <T>(aKey: keyof SpectrogramSettings, aList: readonly T[], aCurrent: T): T =>
    aList.includes(raw[aKey] as T) ? (raw[aKey] as T) : aCurrent

  return {
    window: num('window', base.window),
    zeroPaddingFactor: num('zeroPaddingFactor', base.zeroPaddingFactor),
    overlap: num('overlap', base.overlap),
    winFunc: typeof raw.winFunc === 'string' && SPECTROGRAM_WIN_FUNCS.includes(raw.winFunc)
      ? raw.winFunc
      : base.winFunc,
    data: pick('data', SPECTROGRAM_DATA_MODES, base.data),
    fscale: pick('fscale', SPECTROGRAM_FSCALES, base.fscale),
    startHz: num('startHz', base.startHz),
    stopHz: num('stopHz', base.stopHz),
    mode: pick('mode', SPECTROGRAM_CHANNEL_MODES, base.mode),
    scale: pick('scale', SPECTROGRAM_SCALES, base.scale),
    gain: num('gain', base.gain),
    frequencyGain: num('frequencyGain', base.frequencyGain),
    drange: num('drange', base.drange),
    limit: num('limit', base.limit),
    saturation: num('saturation', base.saturation),
    palette: normalizePalette(raw.palette) ?? base.palette,
  }
}

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
    // Derive the worker hop from overlap (same formula the worker uses when hop<=0).
    hop: Math.max(1, Math.round(aSettings.window * (1 - aSettings.overlap))),
    overlap: aSettings.overlap,
    // No `channel` here — the L/R split (AudioPage) sets channel 0/1 per track; mono
    // omits it so the worker defaults to channel 0.
    winFunc: aSettings.winFunc,
    data: aSettings.data,
    fscale: aSettings.fscale,
    start: aSettings.startHz,
    stop: aSettings.stopHz,
    mode: aSettings.mode,
  }
}
