import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { resolveGnauralExecutablePath } from "./gnaural-path"
import { muteNonSoloVoices } from "./gnaural-solo-render"
import type { AudioFileKind } from "./protocol"

/**
 * Audio source resolution for the spectrogram bridge (Spectrogram UI plan, U1.2).
 *
 * The SpectrumCore worker decodes WAV + flac/ogg/mp3/opus natively (worker
 * audio-formats plan), so audio files pass through untouched. Only `.gnaural`
 * (a schedule, not an audio file) is rendered to a temp WAV via the Gnaural exe
 * (the same `<exe> <input> -o <out>` pipeline the audio session uses).
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
  /**
   * Source-file mtime (ms) this handle was resolved for. Part of the render cache key, and
   * surfaced so callers (the session's warm-analysis LRU) can invalidate on edit — for a
   * pass-through wav/flac the wavPath is stable across edits, so mtime is the only signal.
   */
  readonly mtimeMs: number
  /** Release this acquisition; deletes the temp render when the last holder releases. */
  release(): Promise<void>
}

interface CacheEntry {
  readonly wavPath: string
  readonly tempDir: string | null
  refs: number
}

// GT7.1: for the spectrogram STFT we only need ONE loop. Rendering every loop of a file like
// AndromedaHell (1 s x 4900 loops) would produce an ~868 MB WAV and a 4900 s STFT on the worker.
// So render a temp copy with <loops>1</loops>; if there's no such tag, render as-is.
const GNAURAL_LOOPS_TAG = /<loops>\s*\d+\s*<\/loops>/i

const defaultRenderGnaural =
  (aExePath: string, aCwd: string): GnauralRenderFn =>
  async (aInputPath, aOutputWavPath) => {
    const original = await readFile(aInputPath, "utf8")
    const singleLoop = original.replace(GNAURAL_LOOPS_TAG, "<loops>1</loops>")
    let renderInputPath = aInputPath
    let tempInputPath: string | null = null
    if (singleLoop !== original) {
      // GT10.11 (owner req. 59): the temp copy MUST live next to the source — Gnaural resolves
      // preparse generators AND pcm audio files relative to the schedule's own directory.
      tempInputPath = join(dirname(aInputPath), `.sl-${process.pid}-${randomUUID()}.gnaural`)
      await writeFile(tempInputPath, singleLoop)
      renderInputPath = tempInputPath
    }

    try {
      const child = Bun.spawn([aExePath, renderInputPath, "-o", aOutputWavPath], {
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
    } finally {
      if (tempInputPath !== null) {
        await unlink(tempInputPath).catch(() => undefined)
      }
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

  /**
   * Resolve a (validated) source file to a WAV handle the worker can open.
   *
   * GT4.3 (GT-D17): `aSoloVoiceIds` (gnaural only) renders a "solo" copy with just those voices
   * audible (all others muted) so a lane can show the spectrum/waveform of exactly its voice set.
   * The set is normalized (sorted, deduped) into the cache key, so each distinct solo shares one
   * render and is refcounted/cleaned up like any other. An empty set = the full mix (unchanged).
   */
  async acquire(
    aFilePath: string,
    aFileKind: AudioFileKind,
    aSoloVoiceIds: readonly number[] = [],
  ): Promise<SpectrogramWavHandle> {
    const resolvedPath = resolve(aFilePath)
    const { mtimeMs } = await this.statFile(resolvedPath)
    const solo = [...new Set(aSoloVoiceIds)].sort((a, b) => a - b)
    const key = `${aFileKind}:${resolvedPath}:${mtimeMs}:solo=${solo.join(",")}`

    let entry = this.cache.get(key)
    if (entry === undefined) {
      entry = await this.createEntry(resolvedPath, aFileKind, solo)
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
      mtimeMs,
      release,
    }
  }

  private async createEntry(
    aResolvedPath: string,
    aFileKind: AudioFileKind,
    aSoloVoiceIds: readonly number[],
  ): Promise<CacheEntry> {
    // wav + flac (and any other worker-decodable audio) pass straight to the worker.
    if (aFileKind === "wav" || aFileKind === "flac") {
      return { wavPath: aResolvedPath, tempDir: null, refs: 0 }
    }
    if (aFileKind === "gnaural") {
      const tempDir = await mkdtemp(join(this.tempRoot, "mindwave-spectrogram-"))
      const wavPath = join(tempDir, "source.wav")
      // GT4.3: for a solo render, mute the non-solo voices in a temp copy and render that.
      // GT10.11 (owner req. 59): that copy MUST live next to the source (not in tempDir) —
      // Gnaural resolves preparse generators + pcm audio files relative to the schedule's dir.
      let soloInput: string | null = null
      try {
        let renderInput = aResolvedPath
        if (aSoloVoiceIds.length > 0) {
          const sourceXml = await readFile(aResolvedPath, "utf8")
          soloInput = join(dirname(aResolvedPath), `.solo-${process.pid}-${randomUUID()}.gnaural`)
          await writeFile(soloInput, muteNonSoloVoices(sourceXml, aSoloVoiceIds))
          renderInput = soloInput
        }
        await this.renderGnaural(renderInput, wavPath)
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      } finally {
        if (soloInput !== null) {
          await unlink(soloInput).catch(() => undefined)
        }
      }
      return { wavPath, tempDir, refs: 0 }
    }
    throw new Error(`spectrogram: unsupported audio kind "${aFileKind}"`)
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
