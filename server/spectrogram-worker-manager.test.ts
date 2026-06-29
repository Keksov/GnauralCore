import { existsSync } from "node:fs"
import { describe, expect, test } from "bun:test"

import {
  resolveSpectrogramWorkerExe,
  SpectrogramWorkerManager,
  type SpectrogramWorker,
  type WorkerResponse,
} from "./spectrogram-bridge"

// A controllable in-memory worker for deterministic lifecycle tests (no process).
interface FakeWorker {
  readonly worker: SpectrogramWorker
  /** Simulate an unexpected process exit. */
  crash(aCode?: number): void
  isClosed(): boolean
}

const makeFakeWorker = (aSend: (aCommand: Record<string, unknown>) => Promise<WorkerResponse>): FakeWorker => {
  let resolveExit: (aCode: number) => void = () => undefined
  const exited = new Promise<number>((resolvePromise) => {
    resolveExit = resolvePromise
  })
  let closed = false
  const worker: SpectrogramWorker = {
    exited,
    send: (aCommand) => aSend(aCommand),
    close: async () => {
      if (!closed) {
        closed = true
        resolveExit(0)
      }
    },
  }
  return {
    worker,
    crash: (aCode = 1) => {
      if (!closed) {
        closed = true
        resolveExit(aCode)
      }
    },
    isClosed: () => closed,
  }
}

const okEcho = async (aCommand: Record<string, unknown>): Promise<WorkerResponse> => ({
  ok: true,
  cmd: aCommand.cmd as string,
})

const flushMicrotasks = (): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, 0))

describe("SpectrogramWorkerManager lifecycle (U1.1)", () => {
  test("send rejects on timeout and poisons the worker", async () => {
    const created: FakeWorker[] = []
    const manager = new SpectrogramWorkerManager({
      requestTimeoutMs: 20,
      spawn: () => {
        const fake = makeFakeWorker(() => new Promise<WorkerResponse>(() => undefined))
        created.push(fake)
        return fake.worker
      },
    })

    await expect(manager.send({ cmd: "ping" })).rejects.toThrow(/timed out/)
    expect(created.length).toBe(1)
    expect(created[0]?.isClosed()).toBe(true)
    expect(manager.isRunning).toBe(false)

    await manager.shutdown()
  })

  test("auto-respawns after the worker crashes", async () => {
    const created: FakeWorker[] = []
    const manager = new SpectrogramWorkerManager({
      spawn: () => {
        const fake = makeFakeWorker(okEcho)
        created.push(fake)
        return fake.worker
      },
    })

    const first = await manager.send({ cmd: "ping" })
    expect(first.ok).toBe(true)
    expect(manager.spawnCount).toBe(1)

    created[0]?.crash()
    await flushMicrotasks()
    expect(manager.isRunning).toBe(false)

    const second = await manager.send({ cmd: "ping" })
    expect(second.ok).toBe(true)
    expect(manager.spawnCount).toBe(2)

    await manager.shutdown()
  })

  test("restart() drops the current worker; next send spawns a fresh one", async () => {
    const created: FakeWorker[] = []
    const manager = new SpectrogramWorkerManager({
      spawn: () => {
        const fake = makeFakeWorker(okEcho)
        created.push(fake)
        return fake.worker
      },
    })

    await manager.send({ cmd: "ping" })
    expect(manager.spawnCount).toBe(1)

    await manager.restart()
    expect(created[0]?.isClosed()).toBe(true)

    await manager.send({ cmd: "ping" })
    expect(manager.spawnCount).toBe(2)

    await manager.shutdown()
  })

  test("gives up after maxConsecutiveRestarts without a healthy response", async () => {
    const manager = new SpectrogramWorkerManager({
      maxConsecutiveRestarts: 3,
      spawn: () =>
        makeFakeWorker(async () => {
          throw new Error("boom")
        }).worker,
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(manager.send({ cmd: "ping" })).rejects.toThrow(/boom/)
    }
    await expect(manager.send({ cmd: "ping" })).rejects.toThrow(/exceeded 3 consecutive restarts/)
    expect(manager.spawnCount).toBe(3)

    await manager.shutdown()
  })

  test("shutdown() disposes; further sends throw", async () => {
    const manager = new SpectrogramWorkerManager({ spawn: () => makeFakeWorker(okEcho).worker })
    await manager.send({ cmd: "ping" })
    await manager.shutdown()
    await expect(manager.send({ cmd: "ping" })).rejects.toThrow(/disposed/)
  })
})

// Real-process coverage (dev-only worker, DU3): skip gracefully where not built.
const canRunReal = existsSync(resolveSpectrogramWorkerExe())

describe("SpectrogramWorkerManager real process (U1.1)", () => {
  test.skipIf(!canRunReal)("FIFO framing handles concurrent pings in order", async () => {
    const manager = new SpectrogramWorkerManager()
    const [a, b] = await Promise.all([manager.send({ cmd: "ping" }), manager.send({ cmd: "ping" })])
    expect(a.ok).toBe(true)
    expect(a.cmd).toBe("ping")
    expect(b.ok).toBe(true)
    expect(b.cmd).toBe("ping")
    await manager.shutdown()
  })

  test.skipIf(!canRunReal)("restart() yields a new live process", async () => {
    const manager = new SpectrogramWorkerManager()
    const before = await manager.send({ cmd: "ping" })
    expect(before.ok).toBe(true)
    expect(manager.spawnCount).toBe(1)

    await manager.restart()

    const after = await manager.send({ cmd: "ping" })
    expect(after.ok).toBe(true)
    expect(manager.spawnCount).toBe(2)

    await manager.shutdown()
  })
})
