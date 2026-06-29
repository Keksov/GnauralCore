import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe, spawnSpectrogramWorker } from "./spectrogram-bridge"
import { SpectrogramAudioSource, type GnauralRenderFn } from "./spectrogram-audio-source"

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

  test("flac is rejected with a clear, actionable error", async () => {
    const source = new SpectrogramAudioSource({
      statFile: async () => ({ mtimeMs: 1 }),
    })
    await expect(source.acquire("C:/whatever/track.flac", "flac")).rejects.toThrow(
      /not yet supported/,
    )
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
