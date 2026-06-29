import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

import { resolveSpectrogramWorkerExe } from "./spectrogram-bridge"
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
        expect(tile.frames.length).toBe(tile.emittedFrameCount)
        expect(tile.frames.length).toBeGreaterThan(0)
        expect(tile.binFrequenciesHz.length).toBe(tile.binCount)
        expect(tile.frames[0]?.bins.length).toBe(tile.binCount)

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

        // after close, querying must error (no active analysis)
        const afterClose = await session.handle({
          type: "spectrogram:get-tile",
          requestId: "r-after",
          analysisId: reconfMsg.analysis.analysisId,
          timeStartSec: 0,
          timeEndSec: 0.1,
          zoom: 0,
          viewBinCount: 8,
        })
        expect(afterClose.type).toBe("spectrogram:error")
      } finally {
        await session.dispose()
      }
    },
  )

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
