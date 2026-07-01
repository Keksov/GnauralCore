import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Subprocess } from "bun"

/**
 * SpectrumCore worker bridge (Spectrogram UI plan, Phase 1).
 *
 * `spawnSpectrogramWorker` is the low-level handle around a single long-lived
 * `SpectrumCoreFftwWorkerProbe` process (one JSON object per line over
 * stdin/stdout, see SpectrumCore/spec/fftw-worker-probe-contract.md).
 * `SpectrogramWorkerManager` (U1.1) adds lifecycle: request timeouts, crash
 * detection + lazy restart, a restart-loop guard and clean shutdown.
 *
 * Correlation is FIFO: the worker answers commands in order and its responses
 * carry no request id, so a per-process queue is the correlation. A timeout
 * therefore *poisons* the worker (a late response would map to the wrong next
 * request) — the manager kills it and respawns clean on the next send.
 *
 * The worker exe is located from config/ENV (dev-only, DU3).
 */

const WORKER_BASENAME = "SpectrumCoreFftwWorkerProbe"
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_CONSECUTIVE_RESTARTS = 5

/** Per-platform bundle subdir + exe name (worker packaging plan, WP-D2). */
export function workerPlatformDir(
  aPlatform: string = process.platform,
  aArch: string = process.arch,
): string {
  if (aPlatform === "win32") return "win64"
  if (aPlatform === "linux") return "linux-x86_64"
  if (aPlatform === "darwin") return aArch === "arm64" ? "macos-arm64" : "macos-x86_64"
  return `${aPlatform}-${aArch}`
}

function workerExeName(aPlatformDir: string): string {
  return aPlatformDir.startsWith("win") ? `${WORKER_BASENAME}.exe` : WORKER_BASENAME
}

export interface WorkerExeResolveOptions {
  readonly env?: string | undefined
  readonly cwd?: string
  readonly moduleDir?: string
  readonly platformDir?: string
  readonly fileExists?: (aPath: string) => boolean
}

/**
 * Locate the worker exe (worker packaging plan, WP1.1). Precedence:
 *   1. `SPECTRUMCORE_WORKER_EXE` (explicit override),
 *   2. the bundled copy `<cwd>/vendor/spectrumcore/<platform>/<exe>` (prod / folder-copy),
 *   3. the SpectrumCore dev build `<module>/../../SpectrumCore/build/<platform>/<exe>`.
 * Options are injectable for tests.
 */
export const resolveSpectrogramWorkerExe = (aOptions: WorkerExeResolveOptions = {}): string => {
  const env = aOptions.env ?? process.env.SPECTRUMCORE_WORKER_EXE
  if (env !== undefined && env.trim() !== "") {
    return env
  }
  const exists = aOptions.fileExists ?? existsSync
  const cwd = aOptions.cwd ?? process.cwd()
  const moduleDir = aOptions.moduleDir ?? import.meta.dir
  const platformDir = aOptions.platformDir ?? workerPlatformDir()
  const exeName = workerExeName(platformDir)

  const bundled = resolve(cwd, "vendor", "spectrumcore", platformDir, exeName)
  if (exists(bundled)) {
    return bundled
  }
  return resolve(moduleDir, "..", "..", "SpectrumCore", "build", platformDir, exeName)
}

/** Worker JSON/stdio protocol version the server expects (worker packaging WP2.1). */
export const SPECTROGRAM_WORKER_PROTOCOL = 1

export interface WorkerBundleManifest {
  readonly schemaVersion?: number
  readonly platform?: string
  readonly workerProtocol?: number
  readonly generatedAtUtc?: string
  readonly files?: ReadonlyArray<{ readonly name: string; readonly bytes: number; readonly sha256: string }>
}

/** Read the bundle manifest.json sitting next to the worker exe (null if absent/invalid). */
export function readBundleManifest(aExePath: string): WorkerBundleManifest | null {
  try {
    const manifestPath = join(dirname(aExePath), "manifest.json")
    if (!existsSync(manifestPath)) return null
    return JSON.parse(readFileSync(manifestPath, "utf8")) as WorkerBundleManifest
  } catch {
    return null
  }
}

export interface WorkerBundleCompat {
  readonly ok: boolean
  readonly reason?: string
}

/**
 * Check the bundled worker's declared protocol against what the server expects.
 * A missing manifest (dev / ENV worker) or a manifest without a version is treated
 * as "not checkable" (ok) so dev flows keep working; only a present-but-mismatched
 * version fails.
 */
export function checkBundleCompat(
  aManifest: WorkerBundleManifest | null,
  aExpected: number = SPECTROGRAM_WORKER_PROTOCOL,
): WorkerBundleCompat {
  if (aManifest === null) {
    return { ok: true, reason: "no bundle manifest (dev/ENV worker); compatibility not checked" }
  }
  const got = aManifest.workerProtocol
  if (typeof got !== "number") {
    return { ok: true, reason: "bundle manifest has no workerProtocol; assuming compatible" }
  }
  if (got !== aExpected) {
    return { ok: false, reason: `bundled worker protocol ${got} != expected ${aExpected}` }
  }
  return { ok: true }
}

export interface WorkerResponse {
  readonly ok: boolean
  readonly cmd?: string
  readonly error?: string
  readonly [key: string]: unknown
}

export interface SpectrogramWorker {
  /** Send one worker command line and resolve its response line (FIFO). */
  send(aCommand: Record<string, unknown>): Promise<WorkerResponse>
  /** End stdin, kill the process and reject any in-flight requests. */
  close(): Promise<void>
  /** Resolves with the process exit code once it has terminated. */
  readonly exited: Promise<number>
}

export interface SpawnSpectrogramWorkerOptions {
  /** Called per stderr line (diagnostics); stderr is always drained regardless. */
  readonly onStderr?: (aLine: string) => void
}

interface PendingResolver {
  readonly resolve: (aValue: WorkerResponse) => void
  readonly reject: (aError: Error) => void
}

const drainLines = (
  aStream: ReadableStream<Uint8Array>,
  aOnLine: (aLine: string) => void,
): Promise<void> =>
  (async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of aStream) {
      buffer += decoder.decode(chunk, { stream: true })
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        aOnLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf("\n")
      }
    }
    const tail = buffer.trim()
    if (tail !== "") {
      aOnLine(tail)
    }
  })()

/**
 * Spawn a worker process and return a minimal request/response handle. Throws
 * synchronously if the exe is missing so callers fail fast with a clear message.
 */
export const spawnSpectrogramWorker = (
  aExePath: string = resolveSpectrogramWorkerExe(),
  aOptions: SpawnSpectrogramWorkerOptions = {},
): SpectrogramWorker => {
  if (!existsSync(aExePath)) {
    throw new Error(
      `SpectrumCore worker exe not found: ${aExePath} (set SPECTRUMCORE_WORKER_EXE or build it)`,
    )
  }

  const child: Subprocess<"pipe", "pipe", "pipe"> = Bun.spawn([aExePath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  const pending: PendingResolver[] = []

  const failAll = (aError: Error): void => {
    while (pending.length > 0) {
      pending.shift()?.reject(aError)
    }
  }

  // stdout: dispatch each response line to the oldest pending request (FIFO).
  void drainLines(child.stdout, (aLine) => {
    const line = aLine.trim()
    if (line === "") {
      return
    }
    const waiter = pending.shift()
    if (waiter === undefined) {
      return
    }
    try {
      waiter.resolve(JSON.parse(line) as WorkerResponse)
    } catch {
      waiter.reject(new Error(`malformed JSON line from worker: ${line}`))
    }
  }).catch((error: unknown) => {
    failAll(error instanceof Error ? error : new Error(String(error)))
  })

  // stderr: always drained (avoid backpressure); forward to the optional sink.
  void drainLines(child.stderr, (aLine) => {
    if (aOptions.onStderr !== undefined && aLine.trim() !== "") {
      aOptions.onStderr(aLine)
    }
  }).catch(() => undefined)

  // crash safety: if the process exits, no further responses will arrive.
  void child.exited.then(() => {
    failAll(new Error("worker process exited"))
  })

  const writer = child.stdin
  let closed = false

  return {
    exited: child.exited,
    send(aCommand: Record<string, unknown>): Promise<WorkerResponse> {
      if (closed) {
        return Promise.reject(new Error("worker is closed"))
      }
      return new Promise<WorkerResponse>((resolvePromise, rejectPromise) => {
        pending.push({ resolve: resolvePromise, reject: rejectPromise })
        writer.write(`${JSON.stringify(aCommand)}\n`)
        void writer.flush()
      })
    },
    async close(): Promise<void> {
      if (closed) {
        return
      }
      closed = true
      try {
        void writer.end()
      } catch {
        // stdin may already be gone; ignore
      }
      child.kill()
      await child.exited
      failAll(new Error("worker closed"))
    },
  }
}

export type SpectrogramWorkerFactory = (aExePath: string) => SpectrogramWorker

export interface SpectrogramWorkerManagerOptions {
  readonly exePath?: string
  /** Per-request timeout; on expiry the worker is poisoned + restarted. */
  readonly requestTimeoutMs?: number
  /** Restart-loop guard: max spawns without a healthy response before giving up. */
  readonly maxConsecutiveRestarts?: number
  readonly onStderr?: (aLine: string) => void
  /** Injectable spawn for tests; defaults to the real `spawnSpectrogramWorker`. */
  readonly spawn?: SpectrogramWorkerFactory
}

/**
 * Manages one worker process with lifecycle guarantees: lazy (re)spawn, per
 * request timeout, crash detection + restart, a restart-loop guard and clean
 * shutdown. A healthy response resets the restart budget. Does NOT transparently
 * retry: analysis state lives in the process, so a restarted worker has no open
 * analyses — the WS session layer (U1.3) re-opens after a restart.
 */
export class SpectrogramWorkerManager {
  private readonly exePath: string
  private readonly requestTimeoutMs: number
  private readonly maxConsecutiveRestarts: number
  private readonly spawnWorker: SpectrogramWorkerFactory
  private current: SpectrogramWorker | undefined
  private consecutiveRestarts = 0
  private totalSpawns = 0
  private disposed = false

  constructor(aOptions: SpectrogramWorkerManagerOptions = {}) {
    this.exePath = aOptions.exePath ?? resolveSpectrogramWorkerExe()
    this.requestTimeoutMs = aOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxConsecutiveRestarts = aOptions.maxConsecutiveRestarts ?? DEFAULT_MAX_CONSECUTIVE_RESTARTS
    this.spawnWorker =
      aOptions.spawn ?? ((aPath) => spawnSpectrogramWorker(aPath, { onStderr: aOptions.onStderr }))
  }

  /** Total worker processes spawned over this manager's life (test/diagnostic). */
  get spawnCount(): number {
    return this.totalSpawns
  }

  get isRunning(): boolean {
    return this.current !== undefined
  }

  private ensureWorker(): SpectrogramWorker {
    if (this.disposed) {
      throw new Error("worker manager is disposed")
    }
    if (this.current !== undefined) {
      return this.current
    }
    if (this.consecutiveRestarts >= this.maxConsecutiveRestarts) {
      throw new Error(
        `worker exceeded ${this.maxConsecutiveRestarts} consecutive restarts without a healthy response`,
      )
    }
    const worker = this.spawnWorker(this.exePath)
    this.current = worker
    this.totalSpawns += 1
    this.consecutiveRestarts += 1
    // crash detection: if it exits while still current, drop it so the next send respawns.
    void worker.exited.then(() => {
      if (this.current === worker) {
        this.current = undefined
      }
    })
    return worker
  }

  /** Send a command, (re)spawning as needed and enforcing the request timeout. */
  async send(
    aCommand: Record<string, unknown>,
    aTimeoutMs: number = this.requestTimeoutMs,
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race<WorkerResponse>([
        worker.send(aCommand),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`worker request timed out after ${aTimeoutMs}ms`)),
            aTimeoutMs,
          )
        }),
      ])
      this.consecutiveRestarts = 0
      return response
    } catch (error) {
      // Timeout desyncs FIFO; a crash already broke the pipe. Either way poison
      // this worker so the next send starts a clean process.
      if (this.current === worker) {
        this.current = undefined
        await worker.close().catch(() => undefined)
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }

  /** Gracefully stop the current worker; the next send spawns a fresh one. */
  async restart(): Promise<void> {
    const worker = this.current
    this.current = undefined
    this.consecutiveRestarts = 0
    if (worker !== undefined) {
      await worker.close().catch(() => undefined)
    }
  }

  /** Permanently stop; further sends throw. */
  async shutdown(): Promise<void> {
    this.disposed = true
    const worker = this.current
    this.current = undefined
    if (worker !== undefined) {
      await worker.close().catch(() => undefined)
    }
  }
}

export interface SpectrogramSmokeResult {
  readonly open: WorkerResponse
  readonly tile: WorkerResponse
}

/**
 * Smoke path: spawn the worker on a fixture WAV, open an analysis, request one
 * tile and return both responses for the caller to assert on. Always closes the
 * worker, even on failure.
 */
export const smokeOpenAndGetTile = async (
  aInputWavPath: string,
  aExePath?: string,
): Promise<SpectrogramSmokeResult> => {
  const worker = spawnSpectrogramWorker(aExePath)
  const analysisId = "smoke"
  try {
    const open = await worker.send({
      cmd: "open-analysis",
      analysisId,
      input: aInputWavPath,
      window: 2048,
      hop: 512,
    })
    if (open.ok !== true) {
      throw new Error(`open-analysis failed: ${open.error ?? "unknown error"}`)
    }

    const tile = await worker.send({
      cmd: "get-tile",
      analysisId,
      frameStart: 0,
      frameCount: 2,
      viewBinCount: 16,
    })
    if (tile.ok !== true) {
      throw new Error(`get-tile failed: ${tile.error ?? "unknown error"}`)
    }

    await worker.send({ cmd: "close-analysis", analysisId })
    return { open, tile }
  } finally {
    await worker.close()
  }
}
