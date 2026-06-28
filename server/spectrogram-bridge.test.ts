import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe, smokeOpenAndGetTile } from "./spectrogram-bridge"

// Dev fixture from the SpectrumCore tree (sibling repo).
const FIXTURE_WAV = resolve(
  import.meta.dir,
  "../../SpectrumCore/tests/fixtures/sine440_1s_mono_44k.wav",
)

const workerExe = resolveSpectrogramWorkerExe()
// The native worker is dev-only (DU3); skip gracefully where it is not built so
// this test is portable, but run for real wherever the exe + fixture exist.
const canRun = existsSync(workerExe) && existsSync(FIXTURE_WAV)

interface TileFrame {
  readonly frameIndex: number
  readonly timeSec: number
  readonly bins: readonly number[]
}

describe("spectrogram-bridge skeleton (U0.2)", () => {
  test("resolves a worker exe path", () => {
    expect(resolveSpectrogramWorkerExe().length).toBeGreaterThan(0)
  })

  test.skipIf(!canRun)(
    "spawns the worker, opens an analysis and returns one well-shaped tile",
    async () => {
      const { open, tile } = await smokeOpenAndGetTile(FIXTURE_WAV)

      expect(open.ok).toBe(true)
      expect(open.cmd).toBe("open-analysis")
      expect(typeof open.sampleRate).toBe("number")
      expect(open.frameCount as number).toBeGreaterThan(0)
      expect(open.binCount as number).toBeGreaterThan(0)

      expect(tile.ok).toBe(true)
      expect(tile.cmd).toBe("get-tile")
      expect(Array.isArray(tile.frames)).toBe(true)

      const frames = tile.frames as TileFrame[]
      const binCount = tile.binCount as number
      const binFrequenciesHz = tile.binFrequenciesHz as number[]

      expect(frames.length).toBe(tile.emittedFrameCount as number)
      expect(frames.length).toBeGreaterThan(0)
      expect(Array.isArray(binFrequenciesHz)).toBe(true)
      expect(binFrequenciesHz.length).toBe(binCount)
      expect(frames[0]?.bins.length).toBe(binCount)
    },
  )
})
