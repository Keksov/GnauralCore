import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  checkBundleCompat,
  checkSpectrogramWorkerHealth,
  evaluateWorkerBundle,
  resolveSpectrogramWorkerExe,
  smokeOpenAndGetTile,
  SPECTROGRAM_WORKER_PROTOCOL,
  workerPlatformDir,
} from "./spectrogram-bridge"

// Dev fixture from the SpectrumCore tree (sibling repo).
const FIXTURE_WAV = resolve(
  import.meta.dir,
  "../../SpectrumCore/tests/fixtures/sine440_1s_mono_44k.wav",
)

const workerExe = resolveSpectrogramWorkerExe()
// The native worker is dev-only (DU3); skip gracefully where it is not built so
// this test is portable, but run for real wherever the exe + fixture exist.
const canRun = existsSync(workerExe) && existsSync(FIXTURE_WAV)


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

describe("checkBundleCompat (WP2.1)", () => {
  test("null manifest (dev/ENV) is treated as compatible", () => {
    expect(checkBundleCompat(null).ok).toBe(true)
  })
  test("matching workerProtocol is compatible", () => {
    expect(checkBundleCompat({ workerProtocol: SPECTROGRAM_WORKER_PROTOCOL }).ok).toBe(true)
  })
  test("manifest without workerProtocol is assumed compatible", () => {
    expect(checkBundleCompat({ platform: "win64" }).ok).toBe(true)
  })
  test("mismatched workerProtocol fails with a reason", () => {
    const result = checkBundleCompat({ workerProtocol: SPECTROGRAM_WORKER_PROTOCOL + 1 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("!= expected")
  })
})

describe("evaluateWorkerBundle (WP2.2)", () => {
  const exe = "/app/vendor/spectrumcore/win64/SpectrumCoreFftwWorkerProbe.exe"

  test("exe-missing when the file is absent", () => {
    const h = evaluateWorkerBundle(exe, { fileExists: () => false, manifest: null })
    expect(h.ok).toBe(false)
    expect(h.stage).toBe("exe-missing")
  })

  test("files-missing when a manifest file is absent", () => {
    const manifest = {
      workerProtocol: SPECTROGRAM_WORKER_PROTOCOL,
      files: [
        { name: "SpectrumCoreFftwWorkerProbe.exe", bytes: 1, sha256: "a" },
        { name: "libogg.dll", bytes: 1, sha256: "b" },
      ],
    }
    const h = evaluateWorkerBundle(exe, { fileExists: (p) => !p.endsWith("libogg.dll"), manifest })
    expect(h.stage).toBe("files-missing")
    expect(h.message).toContain("libogg.dll")
  })

  test("incompatible when the protocol mismatches", () => {
    const h = evaluateWorkerBundle(exe, {
      fileExists: () => true,
      manifest: { workerProtocol: SPECTROGRAM_WORKER_PROTOCOL + 1 },
    })
    expect(h.stage).toBe("incompatible")
  })

  test("ok when exe + files present and protocol matches", () => {
    const h = evaluateWorkerBundle(exe, {
      fileExists: () => true,
      manifest: {
        workerProtocol: SPECTROGRAM_WORKER_PROTOCOL,
        files: [{ name: "SpectrumCoreFftwWorkerProbe.exe", bytes: 1, sha256: "a" }],
      },
    })
    expect(h.ok).toBe(true)
    expect(h.stage).toBe("ok")
  })
})

describe("checkSpectrogramWorkerHealth real worker (WP2.2)", () => {
  test.skipIf(!existsSync(resolveSpectrogramWorkerExe()))("spawns + pings the worker -> ok", async () => {
    const health = await checkSpectrogramWorkerHealth()
    expect(health.ok).toBe(true)
    expect(health.stage).toBe("ok")
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

      const binCount = tile.binCount as number
      const binFrequenciesHz = tile.binFrequenciesHz as number[]
      const emittedFrameCount = tile.emittedFrameCount as number

      expect(emittedFrameCount).toBeGreaterThan(0)
      expect(Array.isArray(binFrequenciesHz)).toBe(true)
      expect(binFrequenciesHz.length).toBe(binCount)
      // SF11.6: bins arrive as a base64 float32 blob, row-major [frame][bin].
      expect(typeof tile.binsB64).toBe("string")
      const binBytes = Buffer.from(tile.binsB64 as string, "base64")
      expect(binBytes.length).toBe(emittedFrameCount * binCount * 4)
    },
  )
})
