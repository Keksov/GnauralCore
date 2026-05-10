import { randomUUID } from "node:crypto"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PipedSubprocess, Subprocess } from "bun"
import {
  resolveAllowedAudioFilePath,
} from "./audio-file-utils"
import { resolveGnauralExecutablePath } from "./gnaural-path"
import { isRecord, parseJsonLine } from "./protocol"
import type {
  AudioFileKind,
  AudioProgressEvent,
  AudioRenderState,
  AudioScheduleLoadedEvent,
  AudioServerEvent,
  AudioSettings,
  AudioStatusEvent,
  AudioTransportState,
  GnauralScheduleData,
  GnauralScheduleEntry,
  GnauralScheduleVoice,
} from "./protocol"

type PlaybackChildProcess = PipedSubprocess
type RenderChildProcess = Subprocess<"pipe", "ignore", "pipe">

const isNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value)
}

const isString = (value: unknown): value is string => {
  return typeof value === "string"
}

const isNonNegativeNumber = (value: number): boolean => {
  return Number.isFinite(value) && value >= 0
}

const isUnitInterval = (value: number): boolean => {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

const forEachLine = async (
  aStream: ReadableStream<Uint8Array<ArrayBuffer>> | null,
  aLineHandler: (aLine: string) => void | Promise<void>,
): Promise<void> => {
  if (aStream === null) {
    return
  }

  const decoder = new TextDecoder()
  let tail = ""

  for await (const chunk of aStream) {
    tail += decoder.decode(chunk, { stream: true })

    while (true) {
      const endIndex = tail.indexOf("\n")
      if (endIndex < 0) {
        break
      }

      const line = tail.slice(0, endIndex).replace(/\r$/, "")
      tail = tail.slice(endIndex + 1)
      if (line !== "") {
        await aLineHandler(line)
      }
    }
  }

  tail += decoder.decode()
  const finalLine = tail.replace(/\r$/, "")
  if (finalLine !== "") {
    await aLineHandler(finalLine)
  }
}

const ensureFileExists = async (aPath: string): Promise<boolean> => {
  try {
    return (await stat(aPath)).isFile()
  } catch {
    return false
  }
}

const parsePlaybackProgressEvent = (value: unknown): AudioProgressEvent | null => {
  if (!isRecord(value) || value.event !== "playback_progress" || !isNumber(value.pos)) {
    return null
  }

  return {
    type: "audio_progress",
    positionSec: value.pos,
  }
}

const parseAck = (value: unknown): { readonly cmd: string, readonly ok: boolean, readonly error?: string } | null => {
  if (!isRecord(value) || value.event !== "stdio_ack" || !isString(value.cmd) || typeof value.ok !== "boolean") {
    return null
  }

  return {
    cmd: value.cmd,
    ok: value.ok,
    error: isString(value.error) ? value.error : undefined,
  }
}

const parseScheduleEntry = (value: unknown): GnauralScheduleEntry | null => {
  if (!isRecord(value)) {
    return null
  }

  if (
    !isNumber(value.startSec) ||
    !isNumber(value.endSec) ||
    !isNumber(value.durationSec) ||
    !isNumber(value.baseFreqStart) ||
    !isNumber(value.baseFreqEnd) ||
    !isNumber(value.beatFreqHalfStart) ||
    !isNumber(value.beatFreqHalfEnd) ||
    !isNumber(value.volLStart) ||
    !isNumber(value.volLEnd) ||
    !isNumber(value.volRStart) ||
    !isNumber(value.volREnd)
  ) {
    return null
  }

  return {
    startSec: value.startSec,
    endSec: value.endSec,
    durationSec: value.durationSec,
    baseFreqStart: value.baseFreqStart,
    baseFreqEnd: value.baseFreqEnd,
    beatFreqHalfStart: value.beatFreqHalfStart,
    beatFreqHalfEnd: value.beatFreqHalfEnd,
    volLStart: value.volLStart,
    volLEnd: value.volLEnd,
    volRStart: value.volRStart,
    volREnd: value.volREnd,
  }
}

const parseScheduleVoice = (value: unknown): GnauralScheduleVoice | null => {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return null
  }

  if (
    !isNumber(value.id) ||
    !isString(value.type) ||
    !isNumber(value.typeIndex) ||
    !isString(value.description) ||
    typeof value.hidden !== "boolean" ||
    typeof value.muted !== "boolean" ||
    typeof value.mono !== "boolean" ||
    !(value.color === null || isString(value.color)) ||
    !isString(value.audioFilePath) ||
    !isNumber(value.totalDurationSec) ||
    !isNumber(value.entryCount)
  ) {
    return null
  }

  const entries = value.entries
    .map(parseScheduleEntry)
    .filter((entry): entry is GnauralScheduleEntry => entry !== null)

  return {
    id: value.id,
    type: value.type,
    typeIndex: value.typeIndex,
    description: value.description,
    hidden: value.hidden,
    muted: value.muted,
    mono: value.mono,
    color: value.color,
    audioFilePath: value.audioFilePath,
    totalDurationSec: value.totalDurationSec,
    entryCount: value.entryCount,
    entries,
  }
}

const parseSchedule = (value: unknown): GnauralScheduleData | null => {
  if (!isRecord(value) || !Array.isArray(value.voices)) {
    return null
  }

  if (
    !isString(value.title) ||
    !isString(value.author) ||
    !isString(value.description) ||
    !isNumber(value.totalTimeSec) ||
    !isNumber(value.loopCount) ||
    !isNumber(value.overallVolL) ||
    !isNumber(value.overallVolR) ||
    typeof value.stereoSwap !== "boolean" ||
    !isNumber(value.voiceCount)
  ) {
    return null
  }

  const voices = value.voices
    .map(parseScheduleVoice)
    .filter((voice): voice is GnauralScheduleVoice => voice !== null)

  return {
    title: value.title,
    author: value.author,
    description: value.description,
    totalTimeSec: value.totalTimeSec,
    loopCount: value.loopCount,
    overallVolL: value.overallVolL,
    overallVolR: value.overallVolR,
    stereoSwap: value.stereoSwap,
    voiceCount: value.voiceCount,
    voices,
  }
}

const parseLoadedEvent = (value: unknown): {
  readonly durationSec?: number,
  readonly filePath?: string,
  readonly schedule?: GnauralScheduleData,
} | null => {
  if (!isRecord(value) || value.event !== "loaded") {
    return null
  }

  const parsedSchedule = value.schedule === undefined ? null : parseSchedule(value.schedule)
  const scheduleDurationSec = parsedSchedule === null
    ? undefined
    : parsedSchedule.totalTimeSec * Math.max(1, parsedSchedule.loopCount)

  return {
    durationSec: scheduleDurationSec ?? (isNumber(value.duration) ? value.duration : undefined),
    filePath: isString(value.file) ? value.file : undefined,
    schedule: parsedSchedule ?? undefined,
  }
}

const isPlaybackCompletedEvent = (value: unknown): boolean => {
  return isRecord(value) && value.event === "playback_completed"
}

const isServerReadyEvent = (value: unknown): boolean => {
  return isRecord(value) && (value.event === "server_ready" || value.event === "stdio_ready")
}

export interface GnauralSession {
  getStatus(): AudioStatusEvent
  getLoadedSchedule(): GnauralScheduleData | null
  getLoadedScheduleStartedAtMs(): number | null
  getServableRoots(): readonly string[]
  start(aFilePath: string, aSettings: AudioSettings, aExtraRoots?: readonly string[]): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  seek(aPositionSec: number): void
  setVolume(aLeft: number, aRight: number): void
  setVoiceMute(aVoiceIndex: number, aMuted: boolean): void
  dispose(): Promise<void>
}

interface CreateGnauralSessionOptions {
  readonly onEvent: (aEvent: AudioServerEvent) => void
}

class GnauralPlaybackSession implements GnauralSession {
  private readonly gnauralCwd: string
  private readonly gnauralExePath: string
  private readonly onEvent: (aEvent: AudioServerEvent) => void
  private readonly stdinEncoder = new TextEncoder()
  private childProcess: PlaybackChildProcess | null = null
  private transportState: AudioTransportState = "idle"
  private renderState: AudioRenderState = "idle"
  private activeRunId: string | null = null
  private activeFilePath: string | undefined
  private activeFileKind: AudioFileKind | undefined
  private loadedFilePath: string | undefined
  private loadedFileKind: AudioFileKind | undefined
  private loadedSchedule: GnauralScheduleData | null = null
  private loadedScheduleStartedAtMs: number | null = null
  private durationSec: number | undefined
  private positionSec: number | undefined
  private pendingStartAfterLoad = false
  private pendingSeekPositionSec: number | null = null
  private pendingRestartRequest: { readonly filePath: string, readonly fileKind: AudioFileKind } | null = null
  private startQueue: Promise<void> = Promise.resolve()
  private commandWriteQueue: Promise<void> = Promise.resolve()
  private renderProcess: RenderChildProcess | null = null
  private renderRunId: string | null = null
  private renderFilePath: string | undefined
  private renderTempWavPath: string | undefined
  private tempDirPath: string | null = null
  private tempDirPromise: Promise<string> | null = null

  public constructor(aServerDir: string, aOptions: CreateGnauralSessionOptions) {
    void aServerDir
    const gnauralPathInfo = resolveGnauralExecutablePath()
    this.gnauralCwd = gnauralPathInfo.gnauralCwd
    this.gnauralExePath = gnauralPathInfo.gnauralExePath
    this.onEvent = aOptions.onEvent
  }

  public getStatus(): AudioStatusEvent {
    return {
      type: "audio_status",
      transportState: this.transportState,
      renderState: this.renderState,
      filePath: this.activeFilePath,
      fileKind: this.activeFileKind,
      runId: this.activeRunId ?? undefined,
      positionSec: this.positionSec,
      durationSec: this.durationSec,
    }
  }

  public getLoadedSchedule(): GnauralScheduleData | null {
    return this.loadedSchedule
  }

  public getLoadedScheduleStartedAtMs(): number | null {
    return this.loadedScheduleStartedAtMs
  }

  public getServableRoots(): readonly string[] {
    return this.tempDirPath === null ? [] : [this.tempDirPath]
  }

  public start(aFilePath: string, aSettings: AudioSettings, aExtraRoots: readonly string[] = []): Promise<void> {
    const runStart = async (): Promise<void> => {
      const resolvedFile = resolveAllowedAudioFilePath(aFilePath, aSettings, aExtraRoots)
      if (resolvedFile === null) {
        this.emitError("Requested audio file is outside the configured presets root or has an unsupported type", aFilePath)
        return
      }

      if (resolvedFile.fileKind !== "gnaural") {
        this.emitError("Direct WAV playback is not implemented yet", resolvedFile.filePath)
        return
      }

      const currentTransportState = this.transportState
      const createdProcess = await this.ensureProcess()

      if (currentTransportState !== "idle") {
        this.pendingStartAfterLoad = false
        this.transportState = "stopping"
        this.pendingRestartRequest = {
          filePath: resolvedFile.filePath,
          fileKind: resolvedFile.fileKind,
        }
        this.publishStatus()
        this.sendCommand({ cmd: "stop" })
        return
      }

      const canStartLoadedFileDirectly =
        !createdProcess &&
        this.loadedFilePath === resolvedFile.filePath &&
        this.loadedFileKind === resolvedFile.fileKind

      if (canStartLoadedFileDirectly) {
        this.activeFilePath = resolvedFile.filePath
        this.activeFileKind = resolvedFile.fileKind
        this.pendingStartAfterLoad = false
        this.sendCommand({ cmd: "start" })
        return
      }

      this.loadedSchedule = null
      this.loadedScheduleStartedAtMs = null
      this.transitionToLoading(resolvedFile.filePath, resolvedFile.fileKind)
    }

    const queuedStart = this.startQueue.then(runStart, runStart)
    this.startQueue = queuedStart.catch(() => undefined)
    return queuedStart
  }

  public stop(): void {
    if (this.renderState === "rendering") {
      this.cancelRender()
    }

    if (this.childProcess === null) {
      this.transportState = "idle"
      this.positionSec = 0
      this.pendingSeekPositionSec = null
      this.publishStatus()
      return
    }

    this.publishStatus()
    this.sendCommand({ cmd: "stop" })
  }

  public pause(): void {
    this.sendCommand({ cmd: "pause" })
  }

  public resume(): void {
    this.sendCommand({ cmd: "resume" })
  }

  public seek(aPositionSec: number): void {
    if (!isNonNegativeNumber(aPositionSec)) {
      this.emitError("Seek position must be greater than or equal to 0", this.activeFilePath)
      return
    }

    this.pendingSeekPositionSec = aPositionSec
    this.sendCommand({ cmd: "seek", pos: aPositionSec })
  }

  public setVolume(aLeft: number, aRight: number): void {
    if (!isUnitInterval(aLeft) || !isUnitInterval(aRight)) {
      this.emitError("Volume values must be within the 0..1 range", this.activeFilePath)
      return
    }

    this.sendCommand({ cmd: "set_volume", left: aLeft, right: aRight })
  }

  public setVoiceMute(aVoiceIndex: number, aMuted: boolean): void {
    if (!Number.isInteger(aVoiceIndex) || aVoiceIndex < 0) {
      this.emitError("Voice index must be a non-negative integer", this.activeFilePath)
      return
    }

    this.sendCommand({ cmd: "mute_voice", voice_id: aVoiceIndex, muted: aMuted })
  }

  public async dispose(): Promise<void> {
    this.cancelRender()

    const child = this.childProcess
    if (child !== null) {
      this.sendCommand({ cmd: "quit" })
      try {
        await child.exited
      } catch {
        child.kill()
      }
    }

    try {
      if (this.tempDirPath !== null) {
        await rm(this.tempDirPath, { recursive: true, force: true })
      }
    } catch {
      // Ignore temp directory cleanup failures during shutdown.
    } finally {
      this.tempDirPath = null
      this.tempDirPromise = null
    }
  }

  private emit(aEvent: AudioServerEvent): void {
    this.onEvent(aEvent)
  }

  private emitError(aMessage: string, aFilePath?: string): void {
    this.emit({
      type: "audio_error",
      message: aMessage,
      filePath: aFilePath,
    })
  }

  private publishStatus(): void {
    this.emit(this.getStatus())
  }

  private async ensureProcess(): Promise<boolean> {
    if (this.childProcess !== null && this.childProcess.exitCode === null) {
      return false
    }

    const runId = randomUUID()
    let child: PlaybackChildProcess

    try {
      child = Bun.spawn([
        this.gnauralExePath,
        "--server",
      ], {
        cwd: this.gnauralCwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to spawn Gnaural.exe"
      this.emitError(message, this.activeFilePath)
      throw error
    }

    this.childProcess = child
    this.activeRunId = runId
    this.commandWriteQueue = Promise.resolve()
    void this.forwardStream(runId, child.stdout, "stdout")
    void this.forwardStream(runId, child.stderr, "stderr")
    void this.watchExit(runId, child)
    this.publishStatus()
    return true
  }

  private beginStartSequence(aFilePath: string, aFileKind: AudioFileKind): void {
    const needsLoad = this.loadedFilePath !== aFilePath || this.loadedFileKind !== aFileKind
    if (needsLoad) {
      this.pendingStartAfterLoad = true
      this.sendCommand({ cmd: "load", file: aFilePath })
      return
    }

    this.pendingStartAfterLoad = false
    this.sendCommand({ cmd: "start" })
  }

  private async ensureTempDir(): Promise<string> {
    if (this.tempDirPath !== null) {
      return this.tempDirPath
    }

    if (this.tempDirPromise !== null) {
      return this.tempDirPromise
    }

    this.tempDirPromise = mkdtemp(join(tmpdir(), "mindwave-gnaural-"))
      .then((tempDirPath) => {
        this.tempDirPath = tempDirPath
        return tempDirPath
      })
      .finally(() => {
        this.tempDirPromise = null
      })

    return this.tempDirPromise
  }

  private async removeTempWav(aTempWavPath?: string): Promise<void> {
    if (aTempWavPath === undefined) {
      return
    }

    try {
      await rm(aTempWavPath, { force: true })
    } catch {
      // Ignore temp file cleanup failures; they should not break playback.
    }
  }

  private cancelRender(): void {
    const child = this.renderProcess
    const tempWavPath = this.renderTempWavPath

    this.renderProcess = null
    this.renderRunId = null
    this.renderFilePath = undefined
    this.renderTempWavPath = undefined
    this.renderState = "idle"

    if (child !== null && child.exitCode === null) {
      child.kill()
    }

    void this.removeTempWav(tempWavPath)
  }

  private async startRender(aFilePath: string): Promise<void> {
    const renderRunId = randomUUID()
    const previousRender = this.renderProcess
    const previousTempWavPath = this.renderTempWavPath

    this.renderProcess = null
    this.renderRunId = renderRunId
    this.renderFilePath = aFilePath
    this.renderTempWavPath = undefined
    this.renderState = "rendering"

    if (previousRender !== null && previousRender.exitCode === null) {
      previousRender.kill()
    }

    await this.removeTempWav(previousTempWavPath)

    this.emit({
      type: "audio_render_progress",
      filePath: aFilePath,
    })
    this.publishStatus()

    let tempDirPath: string
    try {
      tempDirPath = await this.ensureTempDir()
    } catch (error) {
      if (this.renderRunId !== renderRunId) {
        return
      }

      this.renderRunId = null
      this.renderFilePath = undefined
      this.renderState = "failed"
      this.publishStatus()
      this.emitError(
        error instanceof Error ? error.message : "Failed to create a temp directory for Gnaural render output",
        aFilePath,
      )
      return
    }

    if (this.renderRunId !== renderRunId) {
      return
    }

    const tempWavPath = join(tempDirPath, `${renderRunId}.wav`)
    let child: RenderChildProcess

    try {
      child = Bun.spawn([
        this.gnauralExePath,
        aFilePath,
        "-o",
        tempWavPath,
      ], {
        cwd: this.gnauralCwd,
        stdout: "ignore",
        stderr: "pipe",
      })
    } catch (error) {
      if (this.renderRunId !== renderRunId) {
        return
      }

      this.renderRunId = null
      this.renderFilePath = undefined
      this.renderState = "failed"
      this.publishStatus()
      this.emitError(error instanceof Error ? error.message : "Failed to spawn Gnaural render process", aFilePath)
      return
    }

    this.renderProcess = child
    this.renderTempWavPath = tempWavPath
    void this.forwardRenderErrorStream(renderRunId, child.stderr, aFilePath)
    void this.watchRenderExit(renderRunId, child, aFilePath, tempWavPath)
  }

  private async forwardRenderErrorStream(
    aRenderRunId: string,
    aStream: ReadableStream<Uint8Array<ArrayBuffer>> | null,
    aFilePath: string,
  ): Promise<void> {
    await forEachLine(aStream, async (line) => {
      if (this.renderRunId !== aRenderRunId) {
        return
      }

      this.emitError(line, aFilePath)
    })
  }

  private async watchRenderExit(
    aRenderRunId: string,
    aChild: RenderChildProcess,
    aFilePath: string,
    aTempWavPath: string,
  ): Promise<void> {
    const exitCode = await aChild.exited
    if (this.renderRunId !== aRenderRunId) {
      await this.removeTempWav(aTempWavPath)
      return
    }

    this.renderProcess = null
    this.renderRunId = null
    this.renderFilePath = undefined

    if (exitCode !== 0 || !(await ensureFileExists(aTempWavPath))) {
      this.renderTempWavPath = undefined
      this.renderState = "failed"
      await this.removeTempWav(aTempWavPath)
      this.publishStatus()
      this.emitError(`Gnaural render failed with exit code ${exitCode}`, aFilePath)
      return
    }

    this.renderTempWavPath = aTempWavPath
    this.renderState = "ready"
    this.emit({
      type: "audio_render_done",
      filePath: aFilePath,
      tempWavPath: aTempWavPath,
    })
    this.publishStatus()
  }

  private transitionToLoading(aFilePath: string, aFileKind: AudioFileKind): void {
    this.activeFilePath = aFilePath
    this.activeFileKind = aFileKind
    this.durationSec = undefined
    this.positionSec = 0
    this.pendingSeekPositionSec = null
    this.transportState = "loading"
    this.renderState = "rendering"
    this.publishStatus()
    void this.startRender(aFilePath)
    this.beginStartSequence(aFilePath, aFileKind)
  }

  private sendCommand(aCommand: Record<string, unknown>): void {
    const child = this.childProcess
    const runId = this.activeRunId
    if (child === null || child.exitCode !== null || runId === null) {
      this.emitError("Gnaural session is not active", this.activeFilePath)
      return
    }

    const line = JSON.stringify(aCommand) + "\n"
    this.commandWriteQueue = this.commandWriteQueue
      .then(async () => {
        if (this.childProcess !== child || this.activeRunId !== runId || child.exitCode !== null) {
          return
        }

        await Promise.resolve(child.stdin.write(this.stdinEncoder.encode(line)))
      })
      .catch((error) => {
        const message = error instanceof Error
          ? `Failed to write command to Gnaural stdin: ${error.message}`
          : "Failed to write command to Gnaural stdin"
        this.emitError(message, this.activeFilePath)
      })
  }

  private async forwardStream(
    aRunId: string,
    aStream: ReadableStream<Uint8Array<ArrayBuffer>> | null,
    aStreamName: "stdout" | "stderr",
  ): Promise<void> {
    await forEachLine(aStream, async (line) => {
      if (this.activeRunId !== aRunId) {
        return
      }

      const parsedJson = parseJsonLine(line)
      if (parsedJson === null) {
        if (aStreamName === "stderr") {
          this.emitError(line, this.activeFilePath)
        }
        return
      }

      const ack = parseAck(parsedJson)
      if (ack !== null) {
        this.handleAck(ack)
        return
      }

      if (isServerReadyEvent(parsedJson)) {
        this.publishStatus()
        return
      }

      const loadedEvent = parseLoadedEvent(parsedJson)
      if (loadedEvent !== null) {
        if (this.transportState === "stopping") {
          return
        }

        this.durationSec = loadedEvent.durationSec
        this.positionSec = 0
        this.loadedSchedule = loadedEvent.schedule ?? null
        this.loadedScheduleStartedAtMs = loadedEvent.schedule === undefined ? null : Date.now()
        this.publishStatus()

        if (loadedEvent.schedule !== undefined) {
          this.emitScheduleLoaded({
            type: "audio_schedule_loaded",
            filePath: loadedEvent.filePath ?? this.activeFilePath ?? this.loadedFilePath ?? "",
            schedule: loadedEvent.schedule,
            loadedAtMs: this.loadedScheduleStartedAtMs ?? undefined,
          })
        }
        return
      }

      if (isPlaybackCompletedEvent(parsedJson)) {
        this.transportState = "idle"
        this.positionSec = 0
        this.pendingSeekPositionSec = null
        this.publishStatus()
        return
      }

      const progressEvent = parsePlaybackProgressEvent(parsedJson)
      if (progressEvent !== null) {
        if (this.transportState === "stopping") {
          return
        }

        this.positionSec = progressEvent.positionSec
        this.emit(progressEvent)
        return
      }

      if (isRecord(parsedJson) && parsedJson.level === "error" && isString(parsedJson.message)) {
        this.emitError(parsedJson.message, this.activeFilePath)
      }
    })
  }

  private handleAck(aAck: { readonly cmd: string, readonly ok: boolean, readonly error?: string }): void {
    if (aAck.cmd === "load" && this.transportState === "stopping") {
      return
    }

    if (!aAck.ok) {
      if (aAck.cmd === "load") {
        this.pendingStartAfterLoad = false
        this.loadedFilePath = undefined
        this.loadedFileKind = undefined
        this.durationSec = undefined
      }

      if (aAck.cmd === "seek") {
        this.pendingSeekPositionSec = null
      }

      if (aAck.cmd === "stop") {
        this.pendingRestartRequest = null
      }

      this.emitError(aAck.error ?? `Gnaural command failed: ${aAck.cmd}`, this.activeFilePath)
      if (aAck.cmd === "load" || aAck.cmd === "start") {
        this.transportState = "idle"
        this.publishStatus()
      }
      return
    }

    switch (aAck.cmd) {
      case "load":
        this.loadedFilePath = this.activeFilePath
        this.loadedFileKind = this.activeFileKind
        this.pendingSeekPositionSec = null
        if (this.pendingStartAfterLoad) {
          this.pendingStartAfterLoad = false
          this.sendCommand({ cmd: "start" })
          return
        }
        this.positionSec = 0
        this.publishStatus()
        return
      case "start":
        this.transportState = "playing"
        this.publishStatus()
        return
      case "pause":
        this.transportState = "paused"
        this.publishStatus()
        return
      case "resume":
        this.transportState = "playing"
        this.publishStatus()
        return
      case "seek":
        if (this.pendingSeekPositionSec !== null) {
          this.positionSec = this.pendingSeekPositionSec
        }
        this.pendingSeekPositionSec = null
        this.publishStatus()
        return
      case "stop":
        this.pendingSeekPositionSec = null
        if (this.pendingRestartRequest !== null) {
          const restartRequest = this.pendingRestartRequest
          this.pendingRestartRequest = null
          this.transitionToLoading(restartRequest.filePath, restartRequest.fileKind)
          return
        }
        this.transportState = "idle"
        this.positionSec = 0
        this.loadedSchedule = null
        this.loadedScheduleStartedAtMs = null
        this.publishStatus()
        return
      case "quit":
        this.transportState = "idle"
        this.positionSec = 0
        this.pendingSeekPositionSec = null
        this.loadedSchedule = null
        this.loadedScheduleStartedAtMs = null
        this.publishStatus()
        return
    }
  }

  private emitScheduleLoaded(aEvent: AudioScheduleLoadedEvent): void {
    if (aEvent.filePath === "") {
      return
    }

    this.emit(aEvent)
  }

  private async watchExit(aRunId: string, aChild: PlaybackChildProcess): Promise<void> {
    const exitCode = await aChild.exited
    if (this.activeRunId !== aRunId) {
      return
    }

    this.childProcess = null
    this.activeRunId = null
    this.commandWriteQueue = Promise.resolve()
    this.transportState = "idle"
    this.pendingStartAfterLoad = false
    this.pendingSeekPositionSec = null
    this.pendingRestartRequest = null
    this.loadedFilePath = undefined
    this.loadedFileKind = undefined
    this.positionSec = 0
    this.emit({
      type: "audio_exit",
      role: "playback",
      exitCode,
      runId: aRunId,
      filePath: this.activeFilePath,
    })
    this.publishStatus()
  }
}

export const createGnauralSession = (
  aServerDir: string,
  aOptions: CreateGnauralSessionOptions,
): GnauralSession => {
  return new GnauralPlaybackSession(aServerDir, aOptions)
}