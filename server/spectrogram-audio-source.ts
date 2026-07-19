import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
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

/**
 * wave-spectrum-cache WC1.2/WC1.3 (WC-D2/WC-D4): an injectable PERSISTENT (disk) render cache. Given
 * the source identity — path (provenance), content fingerprint (sha1 of the .gnaural, so a touch /
 * no-op re-save reuses the render) and a discriminator (solo set) — plus a `render` closure that
 * produces the WAV on a cache miss, it returns a WAV path OWNED BY THE CACHE. The audio source must
 * NOT delete that path (unlike its own mkdtemp renders). When no wavCache is injected, the audio
 * source falls back to its ephemeral per-open render (unchanged behavior, e.g. in tests).
 */
export type SpectrogramWavCacheFn = (aRequest: {
  readonly sourcePath: string
  readonly fingerprint: string
  readonly discriminator: string
  readonly render: (aOutWavPath: string) => Promise<void>
}) => Promise<string>

export interface SpectrogramAudioSourceOptions {
  readonly gnauralExePath?: string
  readonly gnauralCwd?: string
  readonly tempRoot?: string
  /** Injectable render (tests); defaults to spawning the Gnaural exe. */
  readonly renderGnaural?: GnauralRenderFn
  /** Injectable stat (tests); defaults to node:fs/promises stat. */
  readonly statFile?: StatFileFn
  /** Persistent disk render cache (wave-spectrum-cache); when absent, renders are ephemeral. */
  readonly wavCache?: SpectrogramWavCacheFn
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
  /**
   * wave-spectrum-cache WC2.3: a stable identity for the analyzed audio, sent to the worker as
   * `tileContentHash` so the persistent coarse-tile disk cache is content-addressed. For a .gnaural
   * it is sha1(schedule content + solo set) — a touch reuses tiles, an edit or a different solo does
   * not. For a pass-through wav/flac it is sha1(kind + path + mtime).
   */
  readonly contentHash: string
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
  private readonly wavCache?: SpectrogramWavCacheFn
  private readonly cache = new Map<string, CacheEntry>()

  constructor(aOptions: SpectrogramAudioSourceOptions = {}) {
    const gnauralPath = resolveGnauralExecutablePath()
    this.gnauralExePath = aOptions.gnauralExePath ?? gnauralPath.gnauralExePath
    this.gnauralCwd = aOptions.gnauralCwd ?? gnauralPath.gnauralCwd
    this.tempRoot = aOptions.tempRoot ?? tmpdir()
    this.renderGnaural =
      aOptions.renderGnaural ?? defaultRenderGnaural(this.gnauralExePath, this.gnauralCwd)
    this.statFile = aOptions.statFile ?? defaultStatFile
    this.wavCache = aOptions.wavCache
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

    // wave-spectrum-cache WC2.3: content-address identity for the tile disk cache. A .gnaural hashes
    // its schedule content (+ solo), so a touch reuses tiles but an edit/solo change does not; a
    // pass-through wav/flac hashes kind+path+mtime (mtime is the only edit signal for a raw file).
    const contentHash =
      aFileKind === "gnaural"
        ? createHash("sha1")
            .update(await readFile(resolvedPath, "utf8"))
            .update("|solo:")
            .update(solo.join(","))
            .digest("hex")
        : createHash("sha1").update(`${aFileKind}|${resolvedPath}|${mtimeMs}`).digest("hex")

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
      contentHash,
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
      // wave-spectrum-cache WC1.3 (WC-D2): with a persistent disk cache, key the render on the
      // .gnaural CONTENT (sha1) + solo discriminator, so a re-open across a reload/restart reuses the
      // cached WAV instead of re-spawning Gnaural. The returned path is owned by the cache (tempDir
      // null -> never deleted here). The single-loop key namespace matches the HTTP render path, so
      // an unchanged full-mix schedule shares one WAV with the audio player/export.
      if (this.wavCache !== undefined) {
        const sourceXml = await readFile(aResolvedPath, "utf8")
        const fingerprint = createHash("sha1").update(sourceXml).digest("hex")
        const discriminator =
          aSoloVoiceIds.length > 0 ? `single-loop|solo:${aSoloVoiceIds.join(",")}` : "single-loop"
        const wavPath = await this.wavCache({
          sourcePath: aResolvedPath,
          fingerprint,
          discriminator,
          render: (aOutWavPath) => this.renderToWav(aResolvedPath, aSoloVoiceIds, aOutWavPath),
        })
        return { wavPath, tempDir: null, refs: 0 }
      }

      const tempDir = await mkdtemp(join(this.tempRoot, "mindwave-spectrogram-"))
      const wavPath = join(tempDir, "source.wav")
      try {
        await this.renderToWav(aResolvedPath, aSoloVoiceIds, wavPath)
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { wavPath, tempDir, refs: 0 }
    }
    throw new Error(`spectrogram: unsupported audio kind "${aFileKind}"`)
  }

  /**
   * Render a .gnaural to a single-loop WAV at aOutWavPath (via the injected/default renderGnaural).
   * GT4.3: for a solo render, mute the non-solo voices in a temp copy and render that.
   * GT10.11 (owner req. 59): the solo copy MUST live next to the source (not in a temp dir) — Gnaural
   * resolves preparse generators + pcm audio files relative to the schedule's own directory.
   */
  private async renderToWav(
    aResolvedPath: string,
    aSoloVoiceIds: readonly number[],
    aOutWavPath: string,
  ): Promise<void> {
    let soloInput: string | null = null
    try {
      let renderInput = aResolvedPath
      if (aSoloVoiceIds.length > 0) {
        const sourceXml = await readFile(aResolvedPath, "utf8")
        soloInput = join(dirname(aResolvedPath), `.solo-${process.pid}-${randomUUID()}.gnaural`)
        await writeFile(soloInput, muteNonSoloVoices(sourceXml, aSoloVoiceIds))
        renderInput = soloInput
      }
      await this.renderGnaural(renderInput, aOutWavPath)
    } finally {
      if (soloInput !== null) {
        await unlink(soloInput).catch(() => undefined)
      }
    }
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
