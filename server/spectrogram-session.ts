import { randomUUID } from "node:crypto"

import { SpectrogramAudioSource, type SpectrogramWavHandle } from "./spectrogram-audio-source"
import { SpectrogramWorkerManager, type WorkerResponse } from "./spectrogram-bridge"
import type {
  AudioFileKind,
  SpectrogramAnalysisInfo,
  SpectrogramAnalysisParams,
  SpectrogramAreaResult,
  SpectrogramChannelMode,
  SpectrogramClientMessage,
  SpectrogramDataMode,
  SpectrogramFScale,
  SpectrogramOpenRequest,
  SpectrogramPointResult,
  SpectrogramReconfigureRequest,
  SpectrogramScale,
  SpectrogramServerMessage,
  SpectrogramTile,
} from "./protocol"

/**
 * Per-connection spectrogram session (Spectrogram UI plan, U1.3).
 *
 * Routes UI WS messages (SpectrogramClientMessage) to the SpectrumCore worker via
 * SpectrogramWorkerManager and maps worker responses back to SpectrogramServerMessage.
 * One analysis per session: `open` resolves+acquires the source WAV and opens the
 * analysis; `reconfigure` re-analyses on the same source with new params (the worker
 * sets analysis params at open, so a reconfigure is a close+reopen); get-tile /
 * point-query / area-query are forwarded; `close` closes the analysis and releases
 * the source. Calls are serialized per session so state transitions stay ordered.
 *
 * The transport supplies `resolveSource` (trackId -> authorized {filePath, fileKind}),
 * keeping audio-settings/authorization in the WS layer.
 */

export interface SpectrogramResolvedSource {
  readonly filePath: string
  readonly fileKind: AudioFileKind
}

export type SpectrogramSourceResolver = (
  aRequest: SpectrogramOpenRequest,
) => Promise<SpectrogramResolvedSource>

export interface SpectrogramSessionOptions {
  readonly resolveSource: SpectrogramSourceResolver
  readonly workerManager?: SpectrogramWorkerManager
  readonly audioSource?: SpectrogramAudioSource
  /** True when this session owns (and should dispose) the manager/source. */
  readonly ownsDependencies?: boolean
}

const numberOf = (aValue: unknown): number => (typeof aValue === "number" ? aValue : Number.NaN)
const stringOf = (aValue: unknown): string => (typeof aValue === "string" ? aValue : "")
const numberArrayOf = (aValue: unknown): number[] =>
  Array.isArray(aValue) ? (aValue as unknown[]).map((entry) => numberOf(entry)) : []

const paramKeys: readonly (keyof SpectrogramAnalysisParams)[] = [
  "window",
  "zeroPaddingFactor",
  "hop",
  "overlap",
  "channel",
  "winFunc",
  "data",
  "fscale",
  "scale",
  "start",
  "stop",
  "gain",
  "frequencyGain",
  "drange",
  "limit",
  "saturation",
  "mode",
]

const pickParams = (aMessage: SpectrogramAnalysisParams): SpectrogramAnalysisParams => {
  const out: Record<string, unknown> = {}
  for (const key of paramKeys) {
    const value = (aMessage as Record<string, unknown>)[key]
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out as SpectrogramAnalysisParams
}

const toWorkerParams = (aParams: SpectrogramAnalysisParams): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (aParams.window !== undefined) out.window = aParams.window
  if (aParams.zeroPaddingFactor !== undefined) out.zeroPaddingFactor = aParams.zeroPaddingFactor
  if (aParams.hop !== undefined) out.hop = aParams.hop
  if (aParams.overlap !== undefined) out.overlap = aParams.overlap
  if (aParams.channel !== undefined) out.channel = aParams.channel
  if (aParams.winFunc !== undefined) out.win_func = aParams.winFunc
  if (aParams.data !== undefined) out.data = aParams.data
  if (aParams.fscale !== undefined) out.fscale = aParams.fscale
  if (aParams.scale !== undefined) out.scale = aParams.scale
  if (aParams.start !== undefined) out.start = aParams.start
  if (aParams.stop !== undefined) out.stop = aParams.stop
  if (aParams.gain !== undefined) out.gain = aParams.gain
  if (aParams.frequencyGain !== undefined) out.frequencyGain = aParams.frequencyGain
  if (aParams.drange !== undefined) out.drange = aParams.drange
  if (aParams.limit !== undefined) out.limit = aParams.limit
  if (aParams.saturation !== undefined) out.saturation = aParams.saturation
  if (aParams.mode !== undefined) out.mode = aParams.mode
  return out
}

const toAnalysisInfo = (aAnalysisId: string, aResponse: WorkerResponse): SpectrogramAnalysisInfo => ({
  analysisId: aAnalysisId,
  sampleRate: numberOf(aResponse.sampleRate),
  windowSize: numberOf(aResponse.windowSize),
  hopSize: numberOf(aResponse.hopSize),
  fftLength: numberOf(aResponse.fftLength),
  zeroPaddingFactor: numberOf(aResponse.zeroPaddingFactor),
  binCount: numberOf(aResponse.binCount),
  frameCount: numberOf(aResponse.frameCount),
  durationSec: numberOf(aResponse.durationS),
  data: stringOf(aResponse.data) as SpectrogramDataMode,
  fscale: stringOf(aResponse.fscale) as SpectrogramFScale,
  scale: stringOf(aResponse.scale) as SpectrogramScale,
  startHz: numberOf(aResponse.startHz),
  stopHz: numberOf(aResponse.stopHz),
  mode: stringOf(aResponse.mode) as SpectrogramChannelMode,
})

const toTile = (aAnalysisId: string, aResponse: WorkerResponse): SpectrogramTile => {
  const frames = Array.isArray(aResponse.frames) ? (aResponse.frames as Record<string, unknown>[]) : []
  return {
    analysisId: aAnalysisId,
    frameStart: numberOf(aResponse.frameStart),
    frameCount: numberOf(aResponse.frameCount),
    emittedFrameCount: numberOf(aResponse.emittedFrameCount),
    zoom: numberOf(aResponse.zoom),
    binStart: numberOf(aResponse.binStart),
    binCount: numberOf(aResponse.binCount),
    data: stringOf(aResponse.data) as SpectrogramDataMode,
    fscale: stringOf(aResponse.fscale) as SpectrogramFScale,
    viewStartHz: numberOf(aResponse.viewStartHz),
    viewStopHz: numberOf(aResponse.viewStopHz),
    binFrequenciesHz: numberArrayOf(aResponse.binFrequenciesHz),
    frames: frames.map((frame) => ({
      frameIndex: numberOf(frame.frameIndex),
      timeSec: numberOf(frame.timeSec),
      bins: numberArrayOf(frame.bins),
    })),
  }
}

const toPoint = (aAnalysisId: string, aResponse: WorkerResponse): SpectrogramPointResult => ({
  analysisId: aAnalysisId,
  frameIndex: numberOf(aResponse.frameIndex),
  binIndex: numberOf(aResponse.binIndex),
  frameTimeSec: numberOf(aResponse.frameTimeSec),
  binHz: numberOf(aResponse.binHz),
  value: numberOf(aResponse.value),
  magnitude: numberOf(aResponse.magnitude),
  db: numberOf(aResponse.db),
  displayDb: numberOf(aResponse.displayDb),
  normalized: numberOf(aResponse.normalized),
  scaled: numberOf(aResponse.scaled),
  phase: numberOf(aResponse.phase),
  unwrappedPhase: numberOf(aResponse.unwrappedPhase),
})

const toArea = (aAnalysisId: string, aResponse: WorkerResponse): SpectrogramAreaResult => ({
  analysisId: aAnalysisId,
  frameStart: numberOf(aResponse.frameStart),
  frameEnd: numberOf(aResponse.frameEnd),
  binStart: numberOf(aResponse.binStart),
  binEnd: numberOf(aResponse.binEnd),
  cellCount: numberOf(aResponse.cellCount),
  meanValue: numberOf(aResponse.meanValue),
  peakValue: numberOf(aResponse.peakValue),
  peakFrameIndex: numberOf(aResponse.peakFrameIndex),
  peakBinIndex: numberOf(aResponse.peakBinIndex),
  peakTimeSec: numberOf(aResponse.peakTimeSec),
  peakFreqHz: numberOf(aResponse.peakFreqHz),
})

// Heavy worker ops on long files far exceed the manager's default 15s request
// timeout (which poisons + restarts the worker on expiry): a full-file STFT
// (open-analysis) and wide overview tiles (get-tile) can take tens of seconds.
// Give them generous budgets so a large file doesn't time out and loop-restart.
const OPEN_ANALYSIS_TIMEOUT_MS = 120_000
const GET_TILE_TIMEOUT_MS = 60_000

export class SpectrogramSession {
  private readonly resolveSource: SpectrogramSourceResolver
  private readonly manager: SpectrogramWorkerManager
  private readonly audioSource: SpectrogramAudioSource
  private readonly ownsDependencies: boolean
  private analysisId: string | undefined
  private wavHandle: SpectrogramWavHandle | undefined
  private currentParams: SpectrogramAnalysisParams = {}
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(aOptions: SpectrogramSessionOptions) {
    this.resolveSource = aOptions.resolveSource
    this.manager = aOptions.workerManager ?? new SpectrogramWorkerManager()
    this.audioSource = aOptions.audioSource ?? new SpectrogramAudioSource()
    this.ownsDependencies = aOptions.ownsDependencies ?? aOptions.workerManager === undefined
  }

  /** Route one client message; never rejects — failures become an error message. */
  handle(aMessage: SpectrogramClientMessage): Promise<SpectrogramServerMessage> {
    const run = this.queue.then(
      () => this.dispatch(aMessage),
      () => this.dispatch(aMessage),
    )
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async dispatch(aMessage: SpectrogramClientMessage): Promise<SpectrogramServerMessage> {
    try {
      if (this.disposed) {
        throw new Error("session is disposed")
      }
      switch (aMessage.type) {
        case "spectrogram:open":
          return await this.onOpen(aMessage)
        case "spectrogram:reconfigure":
          return await this.onReconfigure(aMessage)
        case "spectrogram:get-tile":
          return await this.onGetTile(aMessage)
        case "spectrogram:point-query":
          return await this.onPointQuery(aMessage)
        case "spectrogram:area-query":
          return await this.onAreaQuery(aMessage)
        case "spectrogram:close":
          return await this.onClose(aMessage)
        default: {
          const unknownMessage = aMessage as { type?: string; requestId?: string }
          throw new Error(`unknown spectrogram message type: ${String(unknownMessage.type)}`)
        }
      }
    } catch (error) {
      return {
        type: "spectrogram:error",
        requestId: aMessage.requestId,
        analysisId: this.analysisId,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private requireOk(aResponse: WorkerResponse, aWhat: string): WorkerResponse {
    if (aResponse.ok !== true) {
      throw new Error(`${aWhat} failed: ${aResponse.error ?? "unknown worker error"}`)
    }
    return aResponse
  }

  private async closeCurrentAnalysis(): Promise<void> {
    if (this.analysisId !== undefined) {
      await this.manager.send({ cmd: "close-analysis", analysisId: this.analysisId }).catch(() => undefined)
      this.analysisId = undefined
    }
  }

  private async releaseSource(): Promise<void> {
    if (this.wavHandle !== undefined) {
      await this.wavHandle.release().catch(() => undefined)
      this.wavHandle = undefined
    }
  }

  private async onOpen(aMessage: SpectrogramOpenRequest): Promise<SpectrogramServerMessage> {
    // One analysis per session: drop any previous analysis + source first.
    await this.closeCurrentAnalysis()
    await this.releaseSource()

    const source = await this.resolveSource(aMessage)
    this.wavHandle = await this.audioSource.acquire(source.filePath, source.fileKind)
    this.currentParams = pickParams(aMessage)

    const analysisId = randomUUID()
    const response = this.requireOk(
      await this.manager.send({
        cmd: "open-analysis",
        analysisId,
        input: this.wavHandle.wavPath,
        ...toWorkerParams(this.currentParams),
      }, OPEN_ANALYSIS_TIMEOUT_MS),
      "open-analysis",
    )
    this.analysisId = analysisId
    return { type: "spectrogram:opened", requestId: aMessage.requestId, analysis: toAnalysisInfo(analysisId, response) }
  }

  private async onReconfigure(aMessage: SpectrogramReconfigureRequest): Promise<SpectrogramServerMessage> {
    if (this.wavHandle === undefined) {
      throw new Error("no open analysis to reconfigure")
    }
    // The worker sets analysis params at open -> reconfigure is a close + reopen on
    // the same source (kept acquired); crash-restart is transparent here because the
    // manager respawns and we re-open below.
    await this.closeCurrentAnalysis()
    this.currentParams = { ...this.currentParams, ...pickParams(aMessage) }

    const analysisId = randomUUID()
    const response = this.requireOk(
      await this.manager.send({
        cmd: "open-analysis",
        analysisId,
        input: this.wavHandle.wavPath,
        ...toWorkerParams(this.currentParams),
      }, OPEN_ANALYSIS_TIMEOUT_MS),
      "reconfigure (reopen)",
    )
    this.analysisId = analysisId
    return {
      type: "spectrogram:reconfigured",
      requestId: aMessage.requestId,
      analysis: toAnalysisInfo(analysisId, response),
    }
  }

  private async onGetTile(
    aMessage: Extract<SpectrogramClientMessage, { type: "spectrogram:get-tile" }>,
  ): Promise<SpectrogramServerMessage> {
    const analysisId = this.requireAnalysis()
    const response = this.requireOk(
      await this.manager.send({
        cmd: "get-tile",
        analysisId,
        timeStartSec: aMessage.timeStartSec,
        timeEndSec: aMessage.timeEndSec,
        zoom: aMessage.zoom ?? 0,
        viewBinCount: aMessage.viewBinCount,
      }, GET_TILE_TIMEOUT_MS),
      "get-tile",
    )
    return { type: "spectrogram:tile", requestId: aMessage.requestId, tile: toTile(analysisId, response) }
  }

  private async onPointQuery(
    aMessage: Extract<SpectrogramClientMessage, { type: "spectrogram:point-query" }>,
  ): Promise<SpectrogramServerMessage> {
    const analysisId = this.requireAnalysis()
    const response = this.requireOk(
      await this.manager.send({
        cmd: "point-query",
        analysisId,
        timeSec: aMessage.timeSec,
        frequencyHz: aMessage.frequencyHz,
      }),
      "point-query",
    )
    return { type: "spectrogram:point", requestId: aMessage.requestId, point: toPoint(analysisId, response) }
  }

  private async onAreaQuery(
    aMessage: Extract<SpectrogramClientMessage, { type: "spectrogram:area-query" }>,
  ): Promise<SpectrogramServerMessage> {
    const analysisId = this.requireAnalysis()
    const response = this.requireOk(
      await this.manager.send({
        cmd: "area-query",
        analysisId,
        timeStartSec: aMessage.timeStartSec,
        timeEndSec: aMessage.timeEndSec,
        freqStartHz: aMessage.freqStartHz,
        freqEndHz: aMessage.freqEndHz,
      }),
      "area-query",
    )
    return { type: "spectrogram:area", requestId: aMessage.requestId, area: toArea(analysisId, response) }
  }

  private async onClose(
    aMessage: Extract<SpectrogramClientMessage, { type: "spectrogram:close" }>,
  ): Promise<SpectrogramServerMessage> {
    const analysisId = this.analysisId ?? aMessage.analysisId
    await this.closeCurrentAnalysis()
    await this.releaseSource()
    return { type: "spectrogram:closed", requestId: aMessage.requestId, analysisId }
  }

  private requireAnalysis(): string {
    if (this.analysisId === undefined) {
      throw new Error("no active analysis; send spectrogram:open first")
    }
    return this.analysisId
  }

  /** Tear down on connection close: close the analysis, release the source, stop deps if owned. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true
    await this.closeCurrentAnalysis()
    await this.releaseSource()
    if (this.ownsDependencies) {
      await this.manager.shutdown().catch(() => undefined)
      await this.audioSource.dispose().catch(() => undefined)
    }
  }
}
