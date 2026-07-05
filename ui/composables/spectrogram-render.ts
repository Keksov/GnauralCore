import type { SpectrogramScale, SpectrogramTile } from '@protocol'

// Pure (canvas-free) rendering for the spectrogram view: map the worker's LINEAR
// magnitude tiles to RGBA pixels by applying the intensity scale family + gain/
// drange/limit and a palette CLIENT-SIDE (U2.3, DU5) -- changing any of these only
// re-draws, no worker re-analysis. The math mirrors the backend
// (SpectrumCoreAnalysisConfig get_iscale + SpectrumCoreRaster ValueToRgb) for parity.

// SF16.2: the four Audacity color schemes.
//   roseus       = Audacity "Color (default)" — the Roseus colormap (magenta→orange→cream).
//   classic      = Audacity "Color (classic)" — HSV blue(low)→red(high) rainbow.
//   grayscale    = Audacity "Grayscale".
//   invgrayscale = Audacity "Inverse grayscale" (1 − v).
export type SpectrogramPalette = 'roseus' | 'classic' | 'grayscale' | 'invgrayscale'

export interface SpectrogramRenderOptions {
  readonly scale: SpectrogramScale
  readonly gain: number
  /** Audacity-style frequency-dependent dB shaping (per-bin), applied in the renderer. */
  readonly frequencyGain: number
  readonly drange: number
  readonly limit: number
  readonly palette: SpectrogramPalette
  readonly saturation: number
}

export const DEFAULT_RENDER_OPTIONS: SpectrogramRenderOptions = {
  scale: 'log',
  gain: 1,
  frequencyGain: 0,
  drange: 120,
  limit: 0,
  palette: 'roseus',
  saturation: 1,
}

/** Per-bin linear factor for frequency gain: `frequencyGain` dB per decade around 1 kHz. */
export function frequencyGainFactor(aBinHz: number, aFrequencyGain: number): number {
  if (aFrequencyGain === 0) return 1
  const hz = aBinHz > 1 ? aBinHz : 1
  const offsetDb = aFrequencyGain * Math.log10(hz / 1000)
  return Math.pow(10, offsetDb / 20)
}

export function resolveRenderOptions(
  aPartial?: Partial<SpectrogramRenderOptions>,
): SpectrogramRenderOptions {
  return { ...DEFAULT_RENDER_OPTIONS, ...(aPartial ?? {}) }
}

const LOG20 = 8.68588963806503655302 // 20 / ln(10)
const MIN_MAGNITUDE = 1e-12

function clamp01(aValue: number): number {
  if (aValue < 0) return 0
  if (aValue > 1) return 1
  return aValue
}

function rawMagnitudeToDb(aMagnitude: number, aFloorDb: number): number {
  if (aMagnitude < MIN_MAGNITUDE) return aFloorDb
  const db = LOG20 * Math.log(aMagnitude)
  return db < aFloorDb ? aFloorDb : db
}

/**
 * Linear magnitude -> normalized intensity [0,1], mirroring the backend
 * MagnitudeToConfiguredScaled (ffmpeg get_iscale): `log` is the dB+range map,
 * the others clip to [limit-drange, limit] dBFS linear bounds then take the root.
 */
export function magnitudeToScaled(
  aMagnitude: number,
  aOptions: Partial<SpectrogramRenderOptions> = {},
): number {
  const opts = resolveRenderOptions(aOptions)
  if (opts.drange <= 0) return 0
  const lowerDb = opts.limit - opts.drange

  if (opts.scale === 'log') {
    let db = rawMagnitudeToDb(aMagnitude * opts.gain, lowerDb)
    if (db > opts.limit) db = opts.limit
    return clamp01((db - lowerDb) / opts.drange)
  }

  const dMax = Math.pow(10, opts.limit / 20)
  const dMin = Math.pow(10, (opts.limit - opts.drange) / 20)
  let a = aMagnitude * opts.gain
  if (a < dMin) a = dMin
  if (a > dMax) a = dMax
  let anorm = dMax > dMin ? (a - dMin) / (dMax - dMin) : 0

  switch (opts.scale) {
    case 'sqrt':
      anorm = Math.sqrt(anorm)
      break
    case 'cbrt':
      anorm = Math.pow(anorm, 1 / 3)
      break
    case '4thrt':
      anorm = Math.sqrt(Math.sqrt(anorm))
      break
    case '5thrt':
      anorm = Math.pow(anorm, 0.2)
      break
    // 'lin': unchanged
  }
  return clamp01(anorm)
}

export type Rgb = readonly [number, number, number]

function hsvToRgb(aHue: number, aSat: number, aVal: number): Rgb {
  if (aSat <= 0) {
    const g = Math.round(aVal * 255)
    return [g, g, g]
  }
  const h = aHue / 60
  const i = Math.floor(h)
  const f = h - i
  const p = aVal * (1 - aSat)
  const q = aVal * (1 - aSat * f)
  const t = aVal * (1 - aSat * (1 - f))
  let rr: number
  let gg: number
  let bb: number
  switch (((i % 6) + 6) % 6) {
    case 0: rr = aVal; gg = t; bb = p; break
    case 1: rr = q; gg = aVal; bb = p; break
    case 2: rr = p; gg = aVal; bb = t; break
    case 3: rr = p; gg = q; bb = aVal; break
    case 4: rr = t; gg = p; bb = aVal; break
    default: rr = aVal; gg = p; bb = q; break
  }
  return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)]
}

// SF16.2: the Roseus colormap (Audacity "Color (default)"), ported verbatim from
// Audacity 3.7.8 lib-theme/AColorResources.h `specColormap[256][3]` as a base64
// little-endian RGB byte blob (256 rows × 3 bytes). Decoded once at module load.
const ROSEUS_LUT_B64 =
  'AQEBAQICAgICAgMDAgMEAgQFAgUGAwYHAwcIAwgKAwkMAwoOAwwQAw0RAw4TAg8VAhAXAhEZAhIbAhMeARQg' +
  'ARUiARYkARcmARgoABkrABotABsvABsyABw0AB02AB45AB47AR8+ASBAASBDAiFFAyFIBCJKBSNNBiNPCCNS' +
  'CSRUCyRWDSVZDyVbESVeEyVgFSZjFyZlGSZoGyZqHSZsHyZvISZxIyZzJiZ2KCZ4KiZ6LCZ8LiZ+MSaAMyaC' +
  'NSWENyWGOiWIPCSKPiSLQSSNQyOPRSOQSCOSSiKTTCKVTyGWUSGXVCCYViCZWB+aWx+bXR6cXx2dYh2eZByf' +
  'ZxyfaRugaxugbhqhcBqhchmhdRmidxiieRiifBeifheigBeigxahhRahhxahiRahjBagjhagkBafkhaflBae' +
  'lhadmRadmxecnRebnxeaoRiZoxiYpRmXpxqWqRqVqxuUrRyTrx2SsR2Rsx6QtR+OtyCNuCGMuiKLvCOJviSI' +
  'wCWHwSeFwyiExSmCxiqByCuAyi1+yy59zS97zjB60DJ40TN30zR11DZ01jdy1zlx2Tpv2jxu2z1t3T9r3kBq' +
  '30Jo4UNn4kVl40Zk5Ehj5Ulh5ktg501e6U5d6lBc61Jb7FNZ7VVY7VdX7llW71pU8FxT8V5S8mBR8mFQ82NP' +
  '9GVO9WdN9WlM9mtL9mxK925K+HBJ+HJI+HRI+XZH+XhH+npG+nxG+n5G+4BG+4JF+4RG+4ZG+4hG/IpG/IxG' +
  '/I5H/JBI/JJI/JRJ/JZK+5hL+5pM+5xN+55O+6BQ+6JR+qRT+qZV+qhX+apY+axa+K5d+LBf+LJh97Rj97Zm' +
  '9rho9rpr9bxu9L5w9MBz88J288N58sV88sd/8cmD8MuG8M2J78+M79CQ7tKT7tSX7dWa7dee7Nmh7Nql7Nyp' +
  '7N6s69+w6+G06+K36+S76+W/6+bC7OjG7OnJ7OrN7ezQ7e3U7u7X7+/b8PDe8fLh8vPk8/Tn9PXq9vbt9/fw' +
  '+fjy+/n1/fr3/vv5'

const ROSEUS_LUT = (() => {
  const binary = atob(ROSEUS_LUT_B64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes // length 768: [r,g,b] × 256
})()

/**
 * Normalized intensity [0,1] -> RGB, matching Audacity's four color schemes:
 * `roseus` (Color default, LUT), `classic` (Color classic, HSV blue->red),
 * `grayscale`, `invgrayscale` (1 - v). `saturation` scales only the `classic`
 * HSV saturation (default 1; clamped to [0,1]); the LUT/grayscale ignore it.
 */
export function paletteColor(
  aValue: number,
  aPalette: SpectrogramPalette = 'roseus',
  aSaturation = 1,
): Rgb {
  const v = clamp01(aValue)
  switch (aPalette) {
    case 'roseus': {
      const i = (Math.round(v * 255) % 256) * 3
      return [ROSEUS_LUT[i], ROSEUS_LUT[i + 1], ROSEUS_LUT[i + 2]]
    }
    case 'classic': {
      const sat = aSaturation < 0 ? 0 : aSaturation > 1 ? 1 : aSaturation
      return hsvToRgb((1 - v) * 240, sat, 1)
    }
    case 'invgrayscale': {
      const g = Math.round((1 - v) * 255)
      return [g, g, g]
    }
    default: {
      const g = Math.round(v * 255)
      return [g, g, g]
    }
  }
}

export interface TileImage {
  readonly width: number
  readonly height: number
  /** RGBA, row 0 = highest frequency (top), row height-1 = lowest (bottom). */
  readonly rgba: Uint8ClampedArray
}

// SF11.6: the worker sends the bin matrix as a base64 little-endian float32 blob
// (row-major [frame][bin]). Decode once per tile object (memoized) for rendering.
const decodedTileBins = new WeakMap<object, Float32Array>()
function tileBinsFloat32(aTile: SpectrogramTile): Float32Array | null {
  const b64 = aTile.binsB64
  if (b64 === undefined || b64 === '') return null
  const cached = decodedTileBins.get(aTile)
  if (cached !== undefined) return cached
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const floats = new Float32Array(bytes.buffer, 0, Math.floor(binary.length / 4))
  decodedTileBins.set(aTile, floats)
  return floats
}

/**
 * Render one worker tile to an RGBA image (width = emitted frames/time, height =
 * display bins/frequency, top row = highest frequency), applying the client-side
 * scale + palette to the linear-magnitude tile.
 */
export function tileToImage(
  aTile: SpectrogramTile,
  aOptions: Partial<SpectrogramRenderOptions> = {},
): TileImage {
  const opts = resolveRenderOptions(aOptions)
  const height = aTile.binCount
  // SF11.6: prefer the base64 float32 blob; fall back to frames[].bins (legacy/tests).
  const binsF32 = tileBinsFloat32(aTile)
  const frames = aTile.frames
  const width = binsF32 !== null ? aTile.emittedFrameCount : frames.length
  const rgba = new Uint8ClampedArray(Math.max(0, width * height) * 4)

  const binFrequenciesHz = aTile.binFrequenciesHz
  for (let x = 0; x < width; x++) {
    const bins = binsF32 === null ? (frames[x]?.bins ?? []) : null
    const rowBase = x * height
    for (let row = 0; row < height; row++) {
      const bin = height - 1 - row // top row = highest-frequency bin
      const factor = frequencyGainFactor(binFrequenciesHz[bin] ?? 0, opts.frequencyGain)
      const value = binsF32 !== null ? (binsF32[rowBase + bin] ?? 0) : (bins?.[bin] ?? 0)
      const scaled = magnitudeToScaled(value * factor, opts)
      const [r, g, b] = paletteColor(scaled, opts.palette, opts.saturation)
      const offset = (row * width + x) * 4
      rgba[offset] = r
      rgba[offset + 1] = g
      rgba[offset + 2] = b
      rgba[offset + 3] = 255
    }
  }

  return { width, height, rgba }
}

/**
 * Choose an overview-pyramid zoom so a `frameCount`-frame analysis renders into
 * roughly `targetColumns` pixels. zoom z max-pools 2^z frames per column.
 */
export function chooseZoom(aFrameCount: number, aTargetColumns: number): number {
  if (aFrameCount <= 0 || aTargetColumns <= 0) return 0
  const ratio = aFrameCount / aTargetColumns
  if (ratio <= 1) return 0
  return Math.max(0, Math.ceil(Math.log2(ratio)))
}
