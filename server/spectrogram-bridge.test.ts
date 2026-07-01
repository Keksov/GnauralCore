import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe, smokeOpenAndGetTile, workerPlatformDir } from "./spectrogram-bridge"

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

describe("resolveSpectrogramWorkerExe precedence (WP1.1)", () => {
  const base = {
    cwd: "/app/server",
    moduleDir: "/repo/GnauralCore/server",
    platformDir: "win64",
    fileExists: () => false,
  }
  const norm = (aPath: string): string => aPath.replace(/\\/g, "/")

  test("ENV override wins over everything", () => {
    expect(resolveSpectrogramWorkerExe({ ...base, env: "C:/custom/worker.exe" })).toBe("C:/custom/worker.exe")
    expect(resolveSpectrogramWorkerExe({ ...base, env: "   " })).not.toBe("   ") // blank env ignored
  })

  test("bundled copy is used when it exists", () => {
    const p = norm(resolveSpectrogramWorkerExe({ ...base, env: undefined, fileExists: (x) => x.includes("vendor") }))
    expect(p).toContain("vendor/spectrumcore/win64/SpectrumCoreFftwWorkerProbe.exe")
  })

  test("falls back to the SpectrumCore dev build when no bundle", () => {
    const p = norm(resolveSpectrogramWorkerExe({ ...base, env: undefined, fileExists: () => false }))
    expect(p).toContain("SpectrumCore/build/win64/SpectrumCoreFftwWorkerProbe.exe")
  })
})

describe("workerPlatformDir (WP1.1)", () => {
  test("maps platform/arch to the bundle subdir", () => {
    expect(workerPlatformDir("win32", "x64")).toBe("win64")
    expect(workerPlatformDir("linux", "x64")).toBe("linux-x86_64")
    expect(workerPlatformDir("darwin", "arm64")).toBe("macos-arm64")
    expect(workerPlatformDir("darwin", "x64")).toBe("macos-x86_64")
  })
})

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
