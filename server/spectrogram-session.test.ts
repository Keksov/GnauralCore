import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe, type SpectrogramWorkerManager } from "./spectrogram-bridge"
import { SpectrogramAudioSource } from "./spectrogram-audio-source"
import { SpectrogramSession, type SpectrogramResolvedSource } from "./spectrogram-session"
import type { SpectrogramServerMessage, SpectrogramTile } from "./protocol"

const FIXTURE_WAV = resolve(
  import.meta.dir,
  "../../SpectrumCore/tests/fixtures/sine440_1s_mono_44k.wav",
)
const canRun = existsSync(resolveSpectrogramWorkerExe()) && existsSync(FIXTURE_WAV)

const wavSource: SpectrogramResolvedSource = { filePath: FIXTURE_WAV, fileKind: "wav" }

describe("SpectrogramSession contract (U1.3)", () => {
  test.skipIf(!canRun)(
    "open -> get-tile -> point-query -> area-query -> reconfigure -> close",
    async () => {
      const session = new SpectrogramSession({ resolveSource: async () => wavSource })
      try {
        const opened = await session.handle({
          type: "spectrogram:open",
          requestId: "r-open",
          window: 2048,
          hop: 512,
        })
        expect(opened.type).toBe("spectrogram:opened")
        if (opened.type !== "spectrogram:opened") return
        expect(opened.requestId).toBe("r-open")
        expect(opened.analysis.sampleRate).toBe(44100)
        expect(opened.analysis.windowSize).toBe(2048)
        expect(opened.analysis.frameCount).toBeGreaterThan(0)
        expect(opened.analysis.binCount).toBeGreaterThan(0)

        const tileMsg = await session.handle({
          type: "spectrogram:get-tile",
          requestId: "r-tile",
          analysisId: opened.analysis.analysisId,
          timeStartSec: 0,
          timeEndSec: 0.5,
          zoom: 0,
          viewBinCount: 16,
        })
        expect(tileMsg.type).toBe("spectrogram:tile")
        if (tileMsg.type !== "spectrogram:tile") return
        const tile: SpectrogramTile = tileMsg.tile
        expect(tile.emittedFrameCount).toBeGreaterThan(0)
        expect(tile.binFrequenciesHz.length).toBe(tile.binCount)
        // SF11.6: bins arrive as a base64 float32 blob, row-major [frame][bin].
        expect(typeof tile.binsB64).toBe("string")
        const binBytes = Buffer.from(tile.binsB64 ?? "", "base64")
        expect(binBytes.length).toBe(tile.emittedFrameCount * tile.binCount * 4)

        const pointMsg = await session.handle({
          type: "spectrogram:point-query",
          requestId: "r-point",
          analysisId: opened.analysis.analysisId,
          timeSec: 0.5,
          frequencyHz: 440,
        })
        expect(pointMsg.type).toBe("spectrogram:point")
        if (pointMsg.type !== "spectrogram:point") return
        expect(pointMsg.point.binHz).toBeGreaterThan(0)
        expect(Number.isFinite(pointMsg.point.normalized)).toBe(true)

        const areaMsg = await session.handle({
          type: "spectrogram:area-query",
          requestId: "r-area",
          analysisId: opened.analysis.analysisId,
          timeStartSec: 0.4,
          timeEndSec: 0.6,
          freqStartHz: 400,
          freqEndHz: 500,
        })
        expect(areaMsg.type).toBe("spectrogram:area")
        if (areaMsg.type !== "spectrogram:area") return
        expect(areaMsg.area.cellCount).toBeGreaterThan(0)
        expect(areaMsg.area.peakFreqHz).toBeGreaterThan(0)

        const reconfMsg = await session.handle({
          type: "spectrogram:reconfigure",
          requestId: "r-reconf",
          analysisId: opened.analysis.analysisId,
          window: 1024,
        })
        expect(reconfMsg.type).toBe("spectrogram:reconfigured")
        if (reconfMsg.type !== "spectrogram:reconfigured") return
        expect(reconfMsg.analysis.windowSize).toBe(1024) // re-analysis took effect

        const closedMsg = await session.handle({
          type: "spectrogram:close",
          requestId: "r-close",
          analysisId: reconfMsg.analysis.analysisId,
        })
        expect(closedMsg.type).toBe("spectrogram:closed")

        // SF7.3: close keeps the analysis WARM (LRU) so returning to the file reuses
        // it -> querying the just-closed analysis still succeeds until it is evicted.
        const afterClose = await session.handle({
          type: "spectrogram:get-tile",
          requestId: "r-after",
          analysisId: reconfMsg.analysis.analysisId,
          timeStartSec: 0,
          timeEndSec: 0.1,
          zoom: 0,
          viewBinCount: 8,
        })
        expect(afterClose.type).toBe("spectrogram:tile")
      } finally {
        await session.dispose()
      }
    },
  )

  test.skipIf(!canRun)(
    "SF7.3: reopening the same file+params reuses the warm (LRU) analysis",
    async () => {
      const session = new SpectrogramSession({ resolveSource: async () => wavSource })
      try {
        const first = await session.handle({ type: "spectrogram:open", requestId: "a", window: 2048, hop: 512 })
        expect(first.type).toBe("spectrogram:opened")
        if (first.type !== "spectrogram:opened") return

        // Client switches away -> close keeps the analysis warm.
        await session.handle({ type: "spectrogram:close", requestId: "a-c", analysisId: first.analysis.analysisId })

        // Reopen same file+params -> reuse the same analysisId (no re-decode/re-open).
        const second = await session.handle({ type: "spectrogram:open", requestId: "b", window: 2048, hop: 512 })
        expect(second.type).toBe("spectrogram:opened")
        if (second.type !== "spectrogram:opened") return
        expect(second.analysis.analysisId).toBe(first.analysis.analysisId)

        // Different params -> a distinct analysis (not reused).
        const third = await session.handle({ type: "spectrogram:open", requestId: "c", window: 1024, hop: 512 })
        expect(third.type).toBe("spectrogram:opened")
        if (third.type !== "spectrogram:opened") return
        expect(third.analysis.analysisId).not.toBe(first.analysis.analysisId)
      } finally {
        await session.dispose()
      }
    },
  )

  test("SF11.2: identical get-tile is served from the per-analysis cache (no worker recompute)", async () => {
    let getTileCalls = 0
    const mockManager = {
      send: async (aCmd: Record<string, unknown>) => {
        if (aCmd.cmd === "open-analysis") {
          return {
            ok: true, sampleRate: 44100, windowSize: 2048, hopSize: 512, fftLength: 2048,
            zeroPaddingFactor: 1, binCount: 4, frameCount: 8, durationS: 1,
            data: "magnitude", fscale: "log", scale: "log", startHz: 0, stopHz: 22050, mode: "combined",
          }
        }
        if (aCmd.cmd === "get-tile") {
          getTileCalls += 1
          return {
            ok: true, frameStart: 0, frameCount: 8, emittedFrameCount: 8, zoom: 0,
            binStart: 0, binCount: 4, data: "magnitude", fscale: "log", viewStartHz: 0, viewStopHz: 22050,
            binFrequenciesHz: [0, 100, 200, 300], frames: [{ frameIndex: 0, timeSec: 0, bins: [1, 2, 3, 4] }],
          }
        }
        return { ok: true }
      },
      shutdown: async () => undefined,
    }
    const mockSource = {
      acquire: async () => ({ wavPath: "/fake.wav", release: async () => undefined }),
      dispose: async () => undefined,
    }
    const session = new SpectrogramSession({
      resolveSource: async () => wavSource,
      workerManager: mockManager as unknown as SpectrogramWorkerManager,
      audioSource: mockSource as unknown as SpectrogramAudioSource,
    })
    try {
      const opened = await session.handle({ type: "spectrogram:open", requestId: "o", window: 2048, hop: 512 })
      expect(opened.type).toBe("spectrogram:opened")
      if (opened.type !== "spectrogram:opened") return
      const analysisId = opened.analysis.analysisId
      const base = { type: "spectrogram:get-tile" as const, analysisId, timeStartSec: 0, timeEndSec: 0.5, zoom: 0, viewBinCount: 4 }

      const t1 = await session.handle({ ...base, requestId: "t1" })
      const t2 = await session.handle({ ...base, requestId: "t2" })
      expect(t1.type).toBe("spectrogram:tile")
      expect(t2.type).toBe("spectrogram:tile")
      // Second identical request is served from cache -> the worker computed only once.
      expect(getTileCalls).toBe(1)

      // A different view range recomputes (cache miss).
      await session.handle({ ...base, requestId: "t3", timeStartSec: 0.5, timeEndSec: 1 })
      expect(getTileCalls).toBe(2)
    } finally {
      await session.dispose()
    }
  })

  test("get-tile before open returns an error message (no worker needed)", async () => {
    const session = new SpectrogramSession({
      resolveSource: async () => {
        throw new Error("resolveSource should not be called")
      },
    })
    try {
      const result: SpectrogramServerMessage = await session.handle({
        type: "spectrogram:get-tile",
        requestId: "r1",
        analysisId: "none",
        timeStartSec: 0,
        timeEndSec: 1,
        zoom: 0,
        viewBinCount: 8,
      })
      expect(result.type).toBe("spectrogram:error")
      if (result.type === "spectrogram:error") {
        expect(result.requestId).toBe("r1")
        expect(result.error).toMatch(/no active analysis/)
      }
    } finally {
      await session.dispose()
    }
  })
})
