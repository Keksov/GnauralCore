import type { SpectrogramTile } from '@protocol'

// Pure (Vue-free, WS-free) tiling + cache logic for the spectrogram composable
// (Spectrogram UI plan, U2.1). Kept separate so it is unit-testable on its own.

/** Full-resolution frames per client tile (the unit we cache + request). */
export const DEFAULT_TILE_FRAMES = 256

/** Default client tile-cache budget (number of tiles kept). */
export const DEFAULT_TILE_CACHE_SIZE = 128

export interface SpectrogramTileRequest {
  readonly key: string
  readonly tileIndex: number
  readonly zoom: number
  /** Full-resolution frame span this tile covers. */
  readonly frameStart: number
  readonly frameCount: number
  readonly viewBinCount: number
}

export interface PlanVisibleTilesOptions {
  readonly analysisId: string
  /** Total full-resolution frames in the analysis. */
  readonly frameCount: number
  readonly durationSec: number
  readonly timeStartSec: number
  readonly timeEndSec: number
  /** Overview-pyramid tier (0 = full resolution). */
  readonly zoom: number
  readonly viewBinCount: number
  readonly tileFrames?: number
}

/** Stable cache key for a tile (analysis + zoom + tile index + display bins). */
export function tileKey(
  aAnalysisId: string,
  aZoom: number,
  aTileIndex: number,
  aViewBinCount: number,
): string {
  return `${aAnalysisId}|z${aZoom}|t${aTileIndex}|b${aViewBinCount}`
}

/**
 * Plan the aligned set of tiles covering a visible (time-range, zoom). Tiles are
 * fixed `tileFrames`-wide chunks of the full-resolution frame axis, so the same
 * tile keys recur across pans/zooms and cache cleanly. Returns [] for an empty
 * or out-of-range window.
 */
export function planVisibleTiles(aOptions: PlanVisibleTilesOptions): SpectrogramTileRequest[] {
  const tileFrames = Math.max(1, aOptions.tileFrames ?? DEFAULT_TILE_FRAMES)
  const total = aOptions.frameCount
  if (total <= 0 || aOptions.durationSec <= 0) {
    return []
  }

  const startSec = Math.max(0, Math.min(aOptions.timeStartSec, aOptions.timeEndSec))
  const endSec = Math.min(aOptions.durationSec, Math.max(aOptions.timeStartSec, aOptions.timeEndSec))
  if (endSec <= startSec) {
    return []
  }

  const framesPerSec = total / aOptions.durationSec
  let firstFrame = Math.floor(startSec * framesPerSec)
  let lastFrame = Math.ceil(endSec * framesPerSec) - 1
  if (firstFrame < 0) firstFrame = 0
  if (lastFrame > total - 1) lastFrame = total - 1
  if (lastFrame < firstFrame) {
    return []
  }

  // Each tile still emits ~tileFrames columns, but a tile covers 2^zoom full-res
  // frames per column, so at higher zoom (zoomed-out view) a tile spans more of the
  // timeline and the whole visible window needs far fewer tiles. Without this the
  // full view of a long file plans hundreds of full-res tiles that overflow the LRU
  // cache, so only the most-recent (rightmost) tiles survive to render.
  const zoom = Math.max(0, Math.floor(aOptions.zoom))
  const tileFullFrames = tileFrames * Math.pow(2, zoom)

  const firstTile = Math.floor(firstFrame / tileFullFrames)
  const lastTile = Math.floor(lastFrame / tileFullFrames)

  const requests: SpectrogramTileRequest[] = []
  for (let idx = firstTile; idx <= lastTile; idx++) {
    const frameStart = idx * tileFullFrames
    const frameCount = Math.min(tileFullFrames, total - frameStart)
    if (frameCount <= 0) {
      break
    }
    requests.push({
      key: tileKey(aOptions.analysisId, aOptions.zoom, idx, aOptions.viewBinCount),
      tileIndex: idx,
      zoom: aOptions.zoom,
      frameStart,
      frameCount,
      viewBinCount: aOptions.viewBinCount,
    })
  }
  return requests
}

/** Small LRU cache (most-recently-used kept) for fetched tiles. */
export class SpectrogramTileCache<T = SpectrogramTile> {
  private readonly maxTiles: number
  private readonly entries = new Map<string, T>()

  constructor(aMaxTiles: number = DEFAULT_TILE_CACHE_SIZE) {
    this.maxTiles = Math.max(1, aMaxTiles)
  }

  get size(): number {
    return this.entries.size
  }

  has(aKey: string): boolean {
    return this.entries.has(aKey)
  }

  get(aKey: string): T | undefined {
    const value = this.entries.get(aKey)
    if (value !== undefined) {
      // bump to most-recently-used
      this.entries.delete(aKey)
      this.entries.set(aKey, value)
    }
    return value
  }

  /**
   * Best cached tile for a `(analysisId, zoom, tileIndex)` regardless of the
   * display-bin count. Lets the view keep rendering an already-fetched tile after
   * the `viewBinCount` changed (e.g. a canvas resize) instead of dropping it until
   * the exact-binCount tile arrives — otherwise only the newest tile shows. Prefers
   * the most-recently-stored match (Map insertion order) and bumps it to MRU.
   */
  getByTileIndex(aAnalysisId: string, aZoom: number, aTileIndex: number): T | undefined {
    const prefix = `${aAnalysisId}|z${aZoom}|t${aTileIndex}|b`
    let match: string | undefined
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        match = key
      }
    }
    return match === undefined ? undefined : this.get(match)
  }

  /**
   * B1/SF11.9: best cached tile by a caller-supplied score (higher wins; return null
   * to skip). Used to fall back to a covering tile from another zoom tier so the plot
   * shows instant coarse content during zoom/pan instead of going blank. Bumps the
   * winner to MRU.
   */
  findBest(aScore: (value: T) => number | null): T | undefined {
    let best: string | undefined
    let bestScore = Number.NEGATIVE_INFINITY
    for (const [key, value] of this.entries) {
      const s = aScore(value)
      if (s !== null && s > bestScore) {
        bestScore = s
        best = key
      }
    }
    return best === undefined ? undefined : this.get(best)
  }

  set(aKey: string, aValue: T): void {
    if (this.entries.has(aKey)) {
      this.entries.delete(aKey)
    }
    this.entries.set(aKey, aValue)
    while (this.entries.size > this.maxTiles) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }
}
