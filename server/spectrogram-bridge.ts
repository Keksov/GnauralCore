import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { Subprocess } from "bun"

/**
 * SpectrumCore worker bridge — skeleton (Spectrogram UI plan, U0.2).
 *
 * Spawns the long-lived `SpectrumCoreFftwWorkerProbe` (one JSON object per line
 * over stdin/stdout, see SpectrumCore/spec/fftw-worker-probe-contract.md), sends
 * one command at a time and resolves the matching response line. Correlation is
 * FIFO here because the probe answers requests in order; U1.1 hardens this with
 * explicit id-correlation, timeouts and crash-restart. The exe is located from
 * config/ENV (dev-only, DU3).
 */

const DEV_WORKER_RELATIVE = "../../SpectrumCore/build/win64/SpectrumCoreFftwWorkerProbe.exe"

/**
 * Locate the worker exe: `SPECTRUMCORE_WORKER_EXE` wins, otherwise fall back to
 * the sibling SpectrumCore dev build output (DU3 — dev-only; packaging later).
 */
export const resolveSpectrogramWorkerExe = (): string => {
  const fromEnv = process.env.SPECTRUMCORE_WORKER_EXE
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv
  }
  return resolve(import.meta.dir, DEV_WORKER_RELATIVE)
}

export interface WorkerResponse {
  readonly ok: boolean
  readonly cmd?: string
  readonly error?: string
  readonly [key: string]: unknown
}

export interface SpectrogramWorker {
  /** Send one worker command line and resolve its response line. */
  send(aCommand: Record<string, unknown>): Promise<WorkerResponse>
  /** End stdin, kill the process and reject any in-flight requests. */
  close(): Promise<void>
}

interface PendingResolver {
  readonly resolve: (aValue: WorkerResponse) => void
  readonly reject: (aError: Error) => void
}

/**
 * Spawn a worker process and return a minimal request/response handle. Throws
 * synchronously if the exe is missing so callers fail fast with a clear message.
 */
export const spawnSpectrogramWorker = (
  aExePath: string = resolveSpectrogramWorkerExe(),
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
  let closed = false

  const failAll = (aError: Error): void => {
    while (pending.length > 0) {
      pending.shift()?.reject(aError)
    }
  }

  void (async () => {
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for await (const chunk of child.stdout) {
        buffer += decoder.decode(chunk, { stream: true })
        let newlineIndex = buffer.indexOf("\n")
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line !== "") {
            const waiter = pending.shift()
            if (waiter !== undefined) {
              try {
                waiter.resolve(JSON.parse(line) as WorkerResponse)
              } catch {
                waiter.reject(new Error(`malformed JSON line from worker: ${line}`))
              }
            }
          }
          newlineIndex = buffer.indexOf("\n")
        }
      }
    } catch (error) {
      failAll(error instanceof Error ? error : new Error(String(error)))
      return
    }
    failAll(new Error("worker stdout closed before a response arrived"))
  })()

  const writer = child.stdin

  return {
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

export interface SpectrogramSmokeResult {
  readonly open: WorkerResponse
  readonly tile: WorkerResponse
}

/**
 * U0.2 smoke path: spawn the worker on a fixture WAV, open an analysis, request
 * one tile and return both responses for the caller to assert on. Always closes
 * the worker, even on failure.
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
