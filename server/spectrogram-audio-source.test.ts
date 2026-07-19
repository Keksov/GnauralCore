import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe, spawnSpectrogramWorker } from "./spectrogram-bridge"
import { SpectrogramAudioSource, type GnauralRenderFn, type SpectrogramWavCacheFn } from "./spectrogram-audio-source"

const FIXTURE_WAV = resolve(
  import.meta.dir,
  "../../SpectrumCore/tests/fixtures/sine440_1s_mono_44k.wav",
)
const fixtureExists = existsSync(FIXTURE_WAV)

// Stub "render": copy a real fixture WAV to the output path (simulates the
// Gnaural exe producing a WAV), so the gnaural path is testable without the exe.
const copyFixtureAsRender =
  (aCounter?: { count: number }): GnauralRenderFn =>
  async (_aInputPath, aOutputWavPath) => {
    if (aCounter !== undefined) {
      aCounter.count += 1
    }
    await Bun.write(aOutputWavPath, Bun.file(FIXTURE_WAV))
  }

describe("SpectrogramAudioSource (U1.2)", () => {
  test.skipIf(!fixtureExists)("wav passes through unchanged (no temp, no delete)", async () => {
    const source = new SpectrogramAudioSource()
    const handle = await source.acquire(FIXTURE_WAV, "wav")

    expect(handle.rendered).toBe(false)
    expect(handle.wavPath).toBe(resolve(FIXTURE_WAV))

    await handle.release()
    expect(existsSync(FIXTURE_WAV)).toBe(true) // pass-through source is never deleted
    expect(source.cachedCount).toBe(0)
  })

  test("flac passes through to the worker (no render; worker decodes it natively)", async () => {
    const source = new SpectrogramAudioSource({ statFile: async () => ({ mtimeMs: 1 }) })
    const handle = await source.acquire("C:/whatever/track.flac", "flac")
    expect(handle.rendered).toBe(false)
    expect(handle.fileKind).toBe("flac")
    await handle.release()
    expect(source.cachedCount).toBe(0)
  })

  test.skipIf(!fixtureExists)("gnaural renders to a temp WAV and cleans up on release", async () => {
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender() })
    const handle = await source.acquire(FIXTURE_WAV, "gnaural")

    expect(handle.rendered).toBe(true)
    expect(handle.wavPath).not.toBe(resolve(FIXTURE_WAV))
    expect(existsSync(handle.wavPath)).toBe(true)

    const tempWav = handle.wavPath
    await handle.release()
    expect(existsSync(tempWav)).toBe(false)
    expect(source.cachedCount).toBe(0)
  })

  test.skipIf(!fixtureExists)("GT4.3: distinct solo sets render + cache separately; same set shares one render", async () => {
    const counter = { count: 0 }
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(counter) })

    const a = await source.acquire(FIXTURE_WAV, "gnaural", [1])
    const b = await source.acquire(FIXTURE_WAV, "gnaural", [2])
    const a2 = await source.acquire(FIXTURE_WAV, "gnaural", [1])

    expect(counter.count).toBe(2) // [1] and [2] each rendered once; the second [1] is shared
    expect(a.wavPath).toBe(a2.wavPath)
    expect(a.wavPath).not.toBe(b.wavPath)
    expect(source.cachedCount).toBe(2)

    await a.release()
    await a2.release()
    await b.release()
    expect(source.cachedCount).toBe(0)
  })

  test.skipIf(!fixtureExists)("renders once for concurrent holders; deletes on last release", async () => {
    const counter = { count: 0 }
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(counter) })

    const first = await source.acquire(FIXTURE_WAV, "gnaural")
    const second = await source.acquire(FIXTURE_WAV, "gnaural")

    expect(counter.count).toBe(1) // shared render
    expect(first.wavPath).toBe(second.wavPath)
    expect(source.cachedCount).toBe(1)

    await first.release()
    expect(existsSync(second.wavPath)).toBe(true) // still held by `second`

    await second.release()
    expect(existsSync(second.wavPath)).toBe(false)
    expect(source.cachedCount).toBe(0)
  })
})

describe("SpectrogramAudioSource + persistent disk cache (wave-spectrum-cache WC1.2/WC1.3)", () => {
  // A stand-in for MindWaveCore's disk cache: keyed by (content fingerprint, discriminator), it runs
  // the render closure only on a miss and returns a WAV OWNED by the cache (the source must not
  // delete it). renders counts how many times a fresh render actually ran.
  const makeFakeWavCache = () => {
    const store = new Map<string, string>()
    const requests: Array<{ sourcePath: string; fingerprint: string; discriminator: string }> = []
    const dirs: string[] = []
    const state = { renders: 0 }
    const fn: SpectrogramWavCacheFn = async ({ sourcePath, fingerprint, discriminator, render }) => {
      requests.push({ sourcePath, fingerprint, discriminator })
      const key = `${fingerprint}:${discriminator}`
      const hit = store.get(key)
      if (hit !== undefined) return hit
      const dir = await mkdtemp(join(tmpdir(), "fake-wavcache-"))
      dirs.push(dir)
      const out = join(dir, "cached.wav")
      await render(out)
      state.renders += 1
      store.set(key, out)
      return out
    }
    const cleanup = async () => {
      await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)))
    }
    return { fn, requests, state, cleanup }
  }

  const makeGnauralFixture = async (aXml: string): Promise<{ path: string; cleanup: () => Promise<void> }> => {
    const dir = await mkdtemp(join(tmpdir(), "gnaural-src-"))
    const path = join(dir, "schedule.gnaural")
    await writeFile(path, aXml)
    return { path, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined) }
  }

  test.skipIf(!fixtureExists)("routes the gnaural render through the cache, keyed by content sha1; not deleted on release", async () => {
    const cache = makeFakeWavCache()
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(), wavCache: cache.fn })
    const xml = "<gnaural><loops>5</loops></gnaural>"
    const fx = await makeGnauralFixture(xml)
    try {
      const handle = await source.acquire(fx.path, "gnaural")
      expect(cache.requests.length).toBe(1)
      expect(cache.requests[0]!.fingerprint).toBe(createHash("sha1").update(xml).digest("hex"))
      expect(cache.requests[0]!.discriminator).toBe("single-loop")
      expect(handle.rendered).toBe(false) // cache-owned, not a source temp render
      expect(existsSync(handle.wavPath)).toBe(true)

      await handle.release()
      expect(existsSync(handle.wavPath)).toBe(true) // the source must NOT delete a cache-owned WAV
      expect(source.cachedCount).toBe(0)
    } finally {
      await fx.cleanup()
      await cache.cleanup()
    }
  })

  test.skipIf(!fixtureExists)("content-addressed reuse across source instances (reload/restart): renders once", async () => {
    const cache = makeFakeWavCache()
    const fx = await makeGnauralFixture("<gnaural/>")
    try {
      const s1 = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(), wavCache: cache.fn })
      const h1 = await s1.acquire(fx.path, "gnaural")
      const firstPath = h1.wavPath
      await h1.release()
      await s1.dispose() // simulates the socket closing / server restart

      const s2 = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(), wavCache: cache.fn })
      const h2 = await s2.acquire(fx.path, "gnaural")
      expect(cache.state.renders).toBe(1) // second open reused the cached WAV — no re-render
      expect(h2.wavPath).toBe(firstPath)
      await h2.release()
    } finally {
      await fx.cleanup()
      await cache.cleanup()
    }
  })

  test.skipIf(!fixtureExists)("distinct solo sets produce distinct cache discriminators (normalized)", async () => {
    const cache = makeFakeWavCache()
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender(), wavCache: cache.fn })
    const fx = await makeGnauralFixture("<gnaural/>")
    try {
      const a = await source.acquire(fx.path, "gnaural", [2, 1, 2]) // normalized -> 1,2
      const b = await source.acquire(fx.path, "gnaural", [3])
      expect(cache.requests.map((r) => r.discriminator).sort()).toEqual([
        "single-loop|solo:1,2",
        "single-loop|solo:3",
      ])
      expect(a.wavPath).not.toBe(b.wavPath)
      expect(cache.state.renders).toBe(2)
      await a.release()
      await b.release()
    } finally {
      await fx.cleanup()
      await cache.cleanup()
    }
  })
})

// End-to-end: a non-WAV (gnaural) source -> rendered WAV -> worker open-analysis.
const workerExists = existsSync(resolveSpectrogramWorkerExe())
const canRunWorker = workerExists && fixtureExists

describe("SpectrogramAudioSource -> worker open-analysis (U1.2)", () => {
  test.skipIf(!canRunWorker)("open-analysis succeeds for a rendered non-WAV source", async () => {
    const source = new SpectrogramAudioSource({ renderGnaural: copyFixtureAsRender() })
    const handle = await source.acquire(FIXTURE_WAV, "gnaural")
    const worker = spawnSpectrogramWorker()
    try {
      const open = await worker.send({
        cmd: "open-analysis",
        analysisId: "u12",
        input: handle.wavPath,
        window: 2048,
        hop: 512,
      })
      expect(open.ok).toBe(true)
      expect(open.frameCount as number).toBeGreaterThan(0)
      await worker.send({ cmd: "close-analysis", analysisId: "u12" })
    } finally {
      await worker.close()
      await handle.release()
    }
  })
})

describe("worker persistent coarse-tile disk cache (wave-spectrum-cache WC2.2)", () => {
  const openMsg = (aCacheDir: string, aHash: string) => ({
    cmd: "open-analysis",
    analysisId: "wc22",
    input: FIXTURE_WAV,
    window: 2048,
    hop: 512,
    tileCacheDir: aCacheDir,
    tileContentHash: aHash,
  })
  // zoom>0 on a lazy (magnitude) analysis takes the coarse display-res path — the one we persist.
  const tileMsg = (aFrameCount: number) => ({
    cmd: "get-tile",
    analysisId: "wc22",
    frameStart: 0,
    frameCount: aFrameCount,
    zoom: 3,
    viewBinCount: 128,
  })

  test.skipIf(!canRunWorker)("a coarse tile is served from disk on a fresh worker (reload/restart) and a different content hash misses", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tileblob-"))
    try {
      // First worker: cold — computes the STFT and persists the blob.
      let firstB64 = ""
      let frameCount = 0
      const w1 = spawnSpectrogramWorker()
      try {
        const open1 = await w1.send(openMsg(cacheDir, "hashA"))
        expect(open1.ok).toBe(true)
        frameCount = open1.frameCount as number
        const t1 = await w1.send(tileMsg(frameCount))
        expect(t1.ok).toBe(true)
        expect(t1.diskTileCacheHit).toBe(false) // cold: computed
        firstB64 = t1.binsB64 as string
        expect(firstB64.length).toBeGreaterThan(0)
      } finally {
        await w1.close()
      }

      // Second worker = a fresh process (simulates a reload / server restart): the same key is served
      // from disk with no STFT, and the bytes are identical.
      const w2 = spawnSpectrogramWorker()
      try {
        await w2.send(openMsg(cacheDir, "hashA"))
        const t2 = await w2.send(tileMsg(frameCount))
        expect(t2.diskTileCacheHit).toBe(true)
        expect(t2.binsB64).toBe(firstB64)
      } finally {
        await w2.close()
      }

      // A different content hash must MISS (recompute) — never serve the wrong tile.
      const w3 = spawnSpectrogramWorker()
      try {
        await w3.send(openMsg(cacheDir, "hashB"))
        const t3 = await w3.send(tileMsg(frameCount))
        expect(t3.diskTileCacheHit).toBe(false)
      } finally {
        await w3.close()
      }
    } finally {
      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
