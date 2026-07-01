import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_TILE_FRAMES,
  planVisibleTiles,
  SpectrogramTileCache,
  tileKey,
} from './spectrogram-tiles'

describe('tileKey (U2.1)', () => {
  test('is stable and distinct per analysis/zoom/index/bins', () => {
    expect(tileKey('a', 0, 3, 256)).toBe('a|z0|t3|b256')
    expect(tileKey('a', 0, 3, 256)).toBe(tileKey('a', 0, 3, 256))
    expect(tileKey('a', 1, 3, 256)).not.toBe(tileKey('a', 0, 3, 256))
    expect(tileKey('a', 0, 4, 256)).not.toBe(tileKey('a', 0, 3, 256))
    expect(tileKey('a', 0, 3, 128)).not.toBe(tileKey('a', 0, 3, 256))
    expect(tileKey('b', 0, 3, 256)).not.toBe(tileKey('a', 0, 3, 256))
  })
})

describe('planVisibleTiles (U2.1)', () => {
  const base = {
    analysisId: 'a',
    frameCount: 1000,
    durationSec: 10,
    zoom: 0,
    viewBinCount: 256,
    tileFrames: 256,
  }

  test('covers the visible window with aligned tiles', () => {
    // 2s..4s of a 10s/1000-frame analysis -> frames 200..399 -> tiles 0 and 1
    const tiles = planVisibleTiles({ ...base, timeStartSec: 2, timeEndSec: 4 })
    expect(tiles.map((t) => t.tileIndex)).toEqual([0, 1])
    expect(tiles[0]?.frameStart).toBe(0)
    expect(tiles[0]?.frameCount).toBe(256)
    expect(tiles[1]?.frameStart).toBe(256)
    expect(tiles[0]?.key).toBe('a|z0|t0|b256')
  })

  test('clamps the final tile to the analysis frame count', () => {
    // whole file -> tiles 0..3; last tile (768) is only 1000-768 = 232 frames
    const tiles = planVisibleTiles({ ...base, timeStartSec: 0, timeEndSec: 10 })
    expect(tiles.map((t) => t.tileIndex)).toEqual([0, 1, 2, 3])
    expect(tiles[3]?.frameStart).toBe(768)
    expect(tiles[3]?.frameCount).toBe(1000 - 768)
  })

  test('carries the zoom into the requests + keys', () => {
    const tiles = planVisibleTiles({ ...base, zoom: 2, timeStartSec: 0, timeEndSec: 1 })
    expect(tiles[0]?.zoom).toBe(2)
    expect(tiles[0]?.key).toBe('a|z2|t0|b256')
  })

  test('returns empty for an out-of-range / empty window', () => {
    expect(planVisibleTiles({ ...base, timeStartSec: 5, timeEndSec: 5 })).toEqual([])
    expect(planVisibleTiles({ ...base, frameCount: 0, timeStartSec: 0, timeEndSec: 1 })).toEqual([])
  })

  test('uses the default tile width when unspecified', () => {
    const tiles = planVisibleTiles({
      analysisId: 'a',
      frameCount: DEFAULT_TILE_FRAMES * 3,
      durationSec: 3,
      timeStartSec: 0,
      timeEndSec: 3,
      zoom: 0,
      viewBinCount: 64,
    })
    expect(tiles.length).toBe(3)
  })
})

describe('SpectrogramTileCache (U2.1)', () => {
  test('stores and retrieves tiles', () => {
    const cache = new SpectrogramTileCache<number>(4)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    expect(cache.has('b')).toBe(true)
    expect(cache.size).toBe(2)
  })

  test('evicts the least-recently-used beyond the budget', () => {
    const cache = new SpectrogramTileCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // 'a' becomes MRU -> 'b' is now LRU
    cache.set('c', 3) // evicts 'b'
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.size).toBe(2)
  })

  test('re-setting an existing key refreshes it without growing', () => {
    const cache = new SpectrogramTileCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 11) // refresh 'a'
    cache.set('c', 3) // evicts 'b' (LRU), not 'a'
    expect(cache.get('a')).toBe(11)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})

describe('SpectrogramTileCache.getByTileIndex (SF2.1 binCount fallback)', () => {
  test('finds a cached tile for the same (zoom, tileIndex) at any binCount', () => {
    const cache = new SpectrogramTileCache<number>(8)
    cache.set(tileKey('a', 0, 2, 128), 21) // tile 2 fetched at binCount 128
    // exact 256-binCount tile not present -> fall back to the 128 one
    expect(cache.get(tileKey('a', 0, 2, 256))).toBeUndefined()
    expect(cache.getByTileIndex('a', 0, 2)).toBe(21)
  })

  test('prefers the most-recently-stored matching binCount', () => {
    const cache = new SpectrogramTileCache<number>(8)
    cache.set(tileKey('a', 0, 2, 128), 21)
    cache.set(tileKey('a', 0, 2, 256), 22) // newer -> preferred
    expect(cache.getByTileIndex('a', 0, 2)).toBe(22)
  })

  test('does not match a different analysis / zoom / tile index', () => {
    const cache = new SpectrogramTileCache<number>(8)
    cache.set(tileKey('a', 0, 2, 128), 21)
    expect(cache.getByTileIndex('b', 0, 2)).toBeUndefined()
    expect(cache.getByTileIndex('a', 1, 2)).toBeUndefined()
    expect(cache.getByTileIndex('a', 0, 3)).toBeUndefined()
    // guards the prefix boundary: tile 2 must not match a "t2..." like index 20
    cache.set(tileKey('a', 0, 20, 128), 99)
    expect(cache.getByTileIndex('a', 0, 2)).toBe(21)
  })

  test('all fetched tiles remain resolvable after a binCount change (only-last-frame regression)', () => {
    const cache = new SpectrogramTileCache<number>(16)
    // tiles 0..2 fetched at binCount 128 (before a resize)
    cache.set(tileKey('a', 0, 0, 128), 100)
    cache.set(tileKey('a', 0, 1, 128), 101)
    cache.set(tileKey('a', 0, 2, 128), 102)
    // after a resize the plan asks for binCount 256; every tile still resolves via fallback
    const resolved = [0, 1, 2].map((idx) =>
      cache.get(tileKey('a', 0, idx, 256)) ?? cache.getByTileIndex('a', 0, idx),
    )
    expect(resolved).toEqual([100, 101, 102])
  })
})
