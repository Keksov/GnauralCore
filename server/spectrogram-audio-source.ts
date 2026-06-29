import { existsSync } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { resolveGnauralExecutablePath } from "./gnaural-path"
import type { AudioFileKind } from "./protocol"

/**
 * Audio source resolution for the spectrogram bridge (Spectrogram UI plan, U1.2).
 *
 * The SpectrumCore worker reads WAV only, so the selected track is resolved to a
 * WAV path the worker can open: `.wav` passes through; `.gnaural` is rendered to
 * a temp WAV via the Gnaural exe (the same `<exe> <input> -o <out>` pipeline the
 * audio session uses); `.flac` is not yet supported (no decoder on the worker or
 * server — a follow-up that needs either worker-side uos decode or a server
 * flac->wav step).
 *
 * Renders are cached + refcounted by (kind, path, mtime): concurrent opens of the
 * same source share one render, and the temp WAV is removed only when the last
 * holder releases — kept for the analysis lifetime because the worker may re-read
 * the source WAV (e.g. mdct-edit-preview), so callers release on close-analysis.
 */

export type GnauralRenderFn = (aInputPath: string, aOutputWavPath: string) => Promise<void>
export type StatFileFn = (aPath: string) => Promise<{ readonly mtimeMs: number }>

export interface SpectrogramAudioSourceOptions {
  readonly gnauralExePath?: string
  readonly gnauralCwd?: string
  readonly tempRoot?: string
  /** Injectable render (tests); defaults to spawning the Gnaural exe. */
  readonly renderGnaural?: GnauralRenderFn
  /** Injectable stat (tests); defaults to node:fs/promises stat. */
  readonly statFile?: StatFileFn
}

export interface SpectrogramWavHandle {
  /** A WAV path the worker can open. */
  readonly wavPath: string
  readonly fileKind: AudioFileKind
  /** True when wavPath is a temp render (vs a pass-through source WAV). */
  readonly rendered: boolean
  /** Release this acquisition; deletes the temp render when the last holder releases. */
  release(): Promise<void>
}

interface CacheEntry {
  readonly wavPath: string
  readonly tempDir: string | null
  refs: number
}

const defaultRenderGnaural =
  (aExePath: string, aCwd: string): GnauralRenderFn =>
  async (aInputPath, aOutputWavPath) => {
    const child = Bun.spawn([aExePath, aInputPath, "-o", aOutputWavPath], {
      cwd: aCwd,
      stdout: "ignore",
      stderr: "pipe",
    })
    const [stderrText, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(`gnaural render failed (exit ${exitCode}): ${stderrText.trim()}`)
    }
    if (!existsSync(aOutputWavPath)) {
      throw new Error("gnaural render produced no output WAV")
    }
  }

const defaultStatFile: StatFileFn = async (aPath) => {
  const info = await stat(aPath)
  return { mtimeMs: info.mtimeMs }
}

export class SpectrogramAudioSource {
  private readonly gnauralExePath: string
  private readonly gnauralCwd: string
  private readonly tempRoot: string
  private readonly renderGnaural: GnauralRenderFn
  private readonly statFile: StatFileFn
  private readonly cache = new Map<string, CacheEntry>()

  constructor(aOptions: SpectrogramAudioSourceOptions = {}) {
    const gnauralPath = resolveGnauralExecutablePath()
    this.gnauralExePath = aOptions.gnauralExePath ?? gnauralPath.gnauralExePath
    this.gnauralCwd = aOptions.gnauralCwd ?? gnauralPath.gnauralCwd
    this.tempRoot = aOptions.tempRoot ?? tmpdir()
    this.renderGnaural =
      aOptions.renderGnaural ?? defaultRenderGnaural(this.gnauralExePath, this.gnauralCwd)
    this.statFile = aOptions.statFile ?? defaultStatFile
  }

  /** Resolve a (validated) source file to a WAV handle the worker can open. */
  async acquire(aFilePath: string, aFileKind: AudioFileKind): Promise<SpectrogramWavHandle> {
    const resolvedPath = resolve(aFilePath)
    const { mtimeMs } = await this.statFile(resolvedPath)
    const key = `${aFileKind}:${resolvedPath}:${mtimeMs}`

    let entry = this.cache.get(key)
    if (entry === undefined) {
      entry = await this.createEntry(resolvedPath, aFileKind)
      this.cache.set(key, entry)
    }
    entry.refs += 1
    const acquired = entry

    let released = false
    const release = async (): Promise<void> => {
      if (released) {
        return
      }
      released = true
      acquired.refs -= 1
      if (acquired.refs <= 0) {
        this.cache.delete(key)
        if (acquired.tempDir !== null) {
          await rm(acquired.tempDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    }

    return {
      wavPath: acquired.wavPath,
      fileKind: aFileKind,
      rendered: acquired.tempDir !== null,
      release,
    }
  }

  private async createEntry(aResolvedPath: string, aFileKind: AudioFileKind): Promise<CacheEntry> {
    if (aFileKind === "wav") {
      return { wavPath: aResolvedPath, tempDir: null, refs: 0 }
    }
    if (aFileKind === "gnaural") {
      const tempDir = await mkdtemp(join(this.tempRoot, "mindwave-spectrogram-"))
      const wavPath = join(tempDir, "source.wav")
      try {
        await this.renderGnaural(aResolvedPath, wavPath)
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { wavPath, tempDir, refs: 0 }
    }
    throw new Error(
      `spectrogram: audio kind "${aFileKind}" is not yet supported ` +
        `(worker reads WAV only; flac needs worker-side decode or a server flac->wav step)`,
    )
  }

  /** Number of cached (live) entries — for tests/diagnostics. */
  get cachedCount(): number {
    return this.cache.size
  }

  /** Delete all outstanding temp renders (e.g. on server shutdown). */
  async dispose(): Promise<void> {
    const entries = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(
      entries.map((entry) =>
        entry.tempDir === null
          ? Promise.resolve()
          : rm(entry.tempDir, { recursive: true, force: true }).catch(() => undefined),
      ),
    )
  }
}
