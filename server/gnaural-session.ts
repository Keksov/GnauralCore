import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import type { PipedSubprocess } from "bun"
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
  // Disk mtime of the schedule Gnaural currently holds in memory, and the one being loaded. Used to
  // notice that the .gnaural was edited (Save / voice mute) since it was loaded — see start().
  private loadedFileMtimeMs: number | undefined
  private pendingLoadMtimeMs: number | undefined
  // Position a seek was just asked for, and how long we still trust it. Gnaural keeps reporting the
  // PRE-seek position for a moment after acking a seek (measured: seek to 22.3 -> progress 0.077;
  // seek to 14.3 -> progress 31.0), and forwarding that yanks the playhead. Progress is ignored
  // until it agrees with the target; the deadline stops a never-agreeing seek freezing the cursor.
  private awaitingSeekPositionSec: number | null = null
  private awaitingSeekAtMs = 0
  private awaitingSeekUntilMs = 0
  private pendingRestartRequest: {
    readonly filePath: string,
    readonly fileKind: AudioFileKind,
    /** Where to resume after the restart; omitted = from the top (a plain Start). */
    readonly atPositionSec?: number,
  } | null = null
  private startQueue: Promise<void> = Promise.resolve()
  private commandWriteQueue: Promise<void> = Promise.resolve()

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

      // Owner 2026-07-15: a Save (or a voice mute) rewrites the .gnaural in place, so the path is
      // unchanged while the schedule Gnaural holds in memory is stale. Skipping `load` then replays
      // the OLD audio — the edit was only audible after restarting the app. Compare the disk mtime
      // (the same key SpectrogramAudioSource caches renders by) and re-load when it moved. Unknown
      // mtime (stat failed) falls through to a full load, which is always correct.
      // Read it BEFORE the restart branch below: that branch returns early, and the reload it
      // queues still needs to know which revision it is loading.
      const currentMtimeMs = await this.fileMtimeMs(resolvedFile.filePath)
      this.pendingLoadMtimeMs = currentMtimeMs

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
        this.loadedFileKind === resolvedFile.fileKind &&
        currentMtimeMs !== undefined &&
        this.loadedFileMtimeMs === currentMtimeMs

      // Where the user parked the cursor. pendingSeekPositionSec is NOT usable here: a seek on a
      // live session acks immediately and the ack consumes it, so by the time Play arrives it is
      // null and the old `pendingSeek ?? 0` rewound to the top. positionSec is the surviving truth
      // (the seek ack commits it; seek() sets it directly when there is no process yet).
      const desiredStartSec = this.positionSec ?? 0
      this.pendingLoadMtimeMs = currentMtimeMs


      if (canStartLoadedFileDirectly) {
        this.activeFilePath = resolvedFile.filePath
        this.activeFileKind = resolvedFile.fileKind
        this.pendingStartAfterLoad = false
        // Nothing is re-loaded here, so Gnaural still sits exactly where the last seek left it —
        // just start. (A seek that never reached it, i.e. no process, is replayed post-start.)
        if (this.pendingSeekPositionSec !== null) {
          this.sendSeekCommand(this.pendingSeekPositionSec)
        }
        this.sendCommand({ cmd: "start" })
        return
      }

      this.loadedSchedule = null
      this.loadedScheduleStartedAtMs = null
      // A `load` rewinds Gnaural to 0, so the parked cursor has to be replayed after `start`
      // (seeking between load and start hangs it for seconds — measured; see handleAck "load").
      this.pendingSeekPositionSec = desiredStartSec > 0 ? desiredStartSec : null
      this.transitionToLoading(resolvedFile.filePath, resolvedFile.fileKind)
    }

    const queuedStart = this.startQueue.then(runStart, runStart)
    this.startQueue = queuedStart.catch(() => undefined)
    return queuedStart
  }

  public stop(): void {
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
    void this.resumeInternal()
  }

  /**
   * Owner 2026-07-15: editing + saving while PAUSED used to keep playing the old audio. Pause
   * leaves the transport in `paused`, so the UI button becomes «Продолжить» and sends audio_resume
   * — which never reaches start() and its reload check, and Gnaural happily resumed the schedule it
   * still held. (Stop instead of Pause worked precisely because it goes through start().)
   * Gnaural rejects `start` while the audio output is open ("Already running"), so a reload from
   * here must go through `stop` — the same restart path start() uses for a non-idle session,
   * carrying the cursor so playback continues where it was rather than rewinding.
   */
  private async resumeInternal(): Promise<void> {
    const filePath = this.loadedFilePath
    const fileKind = this.loadedFileKind

    if (filePath !== undefined && fileKind !== undefined) {
      const currentMtimeMs = await this.fileMtimeMs(filePath)
      const staleRevision = currentMtimeMs !== undefined && currentMtimeMs !== this.loadedFileMtimeMs

      if (staleRevision) {
        this.pendingLoadMtimeMs = currentMtimeMs
        this.pendingStartAfterLoad = false
        this.pendingRestartRequest = { filePath, fileKind, atPositionSec: this.positionSec ?? 0 }
        this.transportState = "stopping"
        this.publishStatus()
        this.sendCommand({ cmd: "stop" })
        return
      }
    }

    this.sendCommand({ cmd: "resume" })
  }

  public seek(aPositionSec: number): void {
    if (!isNonNegativeNumber(aPositionSec)) {
      this.emitError("Seek position must be greater than or equal to 0", this.activeFilePath)
      return
    }

    this.pendingSeekPositionSec = aPositionSec

    // The session is not running yet (a file is selected but was never started): there is no
    // Gnaural process to seek. Remember the position and reflect it in the status so the cursor
    // stays where the user put it; start() applies it via pendingSeekPositionSec. Without this
    // the sendCommand below would fail with "Gnaural session is not active" and raise a spurious
    // error banner just for clicking on a track.
    if (!this.isProcessLive()) {
      this.positionSec = aPositionSec
      this.publishStatus()
      return
    }

    this.sendSeekCommand(aPositionSec)
  }

  /** Tolerance for "the seek landed": Gnaural reports progress in ~0.1s..1s steps. */
  private static readonly SEEK_SETTLE_TOLERANCE_SEC = 1.5
  /** Give up suppressing progress this long after a seek, so the cursor can never freeze. */
  private static readonly SEEK_SETTLE_TIMEOUT_MS = 2000

  /** The ONE place that issues a seek, so progress suppression can never be forgotten. */
  private sendSeekCommand(aPositionSec: number): void {
    this.awaitingSeekPositionSec = aPositionSec
    this.awaitingSeekAtMs = Date.now()
    this.awaitingSeekUntilMs = this.awaitingSeekAtMs + GnauralPlaybackSession.SEEK_SETTLE_TIMEOUT_MS
    this.sendCommand({ cmd: "seek", pos: aPositionSec })
  }

  /** Disk mtime of a schedule file, or undefined when it cannot be read (caller then re-loads). */
  private async fileMtimeMs(aPath: string): Promise<number | undefined> {
    try {
      return (await stat(aPath)).mtimeMs
    } catch {
      return undefined
    }
  }

  private isProcessLive(): boolean {
    return this.childProcess !== null && this.childProcess.exitCode === null && this.activeRunId !== null
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
    const child = this.childProcess
    if (child !== null) {
      this.sendCommand({ cmd: "quit" })
      try {
        await child.exited
      } catch {
        child.kill()
      }
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
    // Owner 2026-07-15: this is the SECOND load gate (start() has its own). It used to compare only
    // path+kind, so a Save — which rewrites the .gnaural in place — left needsLoad false and went
    // straight to `start`, replaying the schedule Gnaural still held in memory. That is why an edit
    // was only audible after restarting the app. Compare the on-disk revision too.
    const staleRevision = this.loadedFileMtimeMs !== this.pendingLoadMtimeMs
    const needsLoad = this.loadedFilePath !== aFilePath || this.loadedFileKind !== aFileKind || staleRevision
    if (needsLoad) {
      this.pendingStartAfterLoad = true
      this.sendCommand({ cmd: "load", file: aFilePath })
      return
    }

    this.pendingStartAfterLoad = false
    this.sendCommand({ cmd: "start" })
  }

  private transitionToLoading(aFilePath: string, aFileKind: AudioFileKind): void {
    this.activeFilePath = aFilePath
    this.activeFileKind = aFileKind
    this.durationSec = undefined
    // Start where the user parked the cursor. A seek made before playback started is kept in
    // pendingSeekPositionSec (it could not reach Gnaural — no process yet) and is applied right
    // after the `load` ack, before `start`. Clearing it here is what used to rewind Play to 0.
    this.positionSec = this.pendingSeekPositionSec ?? 0
    this.transportState = "loading"
    // Render-on-play removed (2026-07-15): the spectrogram is served single-loop by
    // SpectrogramAudioSource (the SpectrumCore worker analysis shown on the Tracks tab), and
    // playback audio comes from the live `--server` process below. The former full-file
    // render-on-play only fed a client-side buffer that is no longer displayed, so it is not
    // started here — pressing Play no longer triggers a full WAV render or the
    // "loading spectrogram WAV" reload.
    this.renderState = "idle"
    this.publishStatus()
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
        // Keep a cursor the user parked before pressing Play: this `loaded` status is published
        // before the post-start seek lands, so resetting to 0 here made the playhead visibly jump
        // to the top and back. pendingSeekPositionSec is cleared by the seek ack.
        this.positionSec = this.pendingSeekPositionSec ?? 0
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

        // A seek is in flight. Playback keeps running (and reporting) until Gnaural receives it, so
        // these reports are truthful but about to be invalidated — forwarding them yanks the
        // playhead. The clearest case is a start-then-seek: `start` begins at 0 and reports
        // `progress 0` before the seek lands, which would blink the cursor to the top of the track.
        // Judge each report against where playback should be by now (target + elapsed), and keep
        // the filter armed for the whole window rather than releasing on the first agreeing report.
        // The deadline is a safety net: a seek that never settles must not freeze the cursor.
        if (this.awaitingSeekPositionSec !== null) {
          if (Date.now() > this.awaitingSeekUntilMs) {
            this.awaitingSeekPositionSec = null
          } else {
            const expectedSec = this.awaitingSeekPositionSec + (Date.now() - this.awaitingSeekAtMs) / 1000
            if (Math.abs(progressEvent.positionSec - expectedSec) > GnauralPlaybackSession.SEEK_SETTLE_TOLERANCE_SEC) {
              return
            }
          }
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
        // Remember which on-disk revision Gnaural now holds, so a later Save forces a re-load.
        this.loadedFileMtimeMs = this.pendingLoadMtimeMs
        if (this.pendingStartAfterLoad) {
          this.pendingStartAfterLoad = false
          // Do NOT seek here. Measured 2026-07-15: `seek` between `load` and the first `start`
          // acks fast (~110ms) but then makes that `start` take 3.7s..99s, during which Gnaural
          // stops answering — every later command (even stop) queues behind it. `load` -> `start`
          // with no seek acks in ~0.7s, and a seek on a started session acks in ~50ms, so the
          // pending position is applied right after the start ack instead (see case "start").
          this.sendCommand({ cmd: "start" })
          return
        }
        this.pendingSeekPositionSec = null
        this.positionSec = 0
        this.publishStatus()
        return
      case "start":
        this.transportState = "playing"
        // Apply a cursor position parked before playback began, now that the session is live and
        // a seek is cheap. Costs a brief moment of audio from 0 before it takes effect.
        if (this.pendingSeekPositionSec !== null) {
          this.sendSeekCommand(this.pendingSeekPositionSec)
        }
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
          // A restart that has to land on a position (resume after the file was edited) carries it
          // here: the line above just wiped pendingSeekPositionSec, so re-arm it for the reload.
          const atSec = restartRequest.atPositionSec ?? 0
          this.pendingSeekPositionSec = atSec > 0 ? atSec : null
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