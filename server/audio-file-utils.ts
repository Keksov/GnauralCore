import { realpathSync } from "node:fs"
import { extname, isAbsolute, relative, resolve } from "node:path"
import type { AudioFileKind } from "./protocol"

const AUDIO_FILE_EXTENSIONS = new Map<string, AudioFileKind>([
  [".wav", "wav"],
  [".flac", "flac"],
  [".gnaural", "gnaural"],
])

export interface ResolvedAudioFile {
  readonly filePath: string
  readonly fileKind: AudioFileKind
}

const sanitizeAsciiFilename = (aFileName: string): string => {
  const normalized = aFileName
    .replace(/[\r\n]+/g, " ")
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim()

  return normalized === "" ? "download" : normalized
}

const encodeDispositionFilename = (aFileName: string): string => {
  const normalized = aFileName.replace(/[\r\n]+/g, " ").trim() || "download"

  return encodeURIComponent(normalized).replace(/[!'()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  })
}

export const buildInlineContentDisposition = (aFileName: string): string => {
  const asciiFileName = sanitizeAsciiFilename(aFileName)
  const utf8FileName = encodeDispositionFilename(aFileName)
  return `inline; filename="${asciiFileName}"; filename*=UTF-8''${utf8FileName}`
}

export const getAudioFileKind = (aPath: string): AudioFileKind | null => {
  return AUDIO_FILE_EXTENSIONS.get(extname(aPath).toLowerCase()) ?? null
}

const canonicalizePathForCheck = (aPath: string): string => {
  try {
    return realpathSync(aPath)
  } catch {
    return resolve(aPath)
  }
}

export const isPathInsideBase = (aBasePath: string, aCandidatePath: string): boolean => {
  const relativePath = relative(aBasePath, aCandidatePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

// audio-panel-cleanup AC3.1/AC-D2: the single configured `presetsRoot` was removed. Callers now pass
// the explicit set of allowed roots (on the MindWaveCore side these are the fs-browser roots — the
// whole machine, AC-D6 — while the LAN exposure of the byte-serving endpoints is closed by a separate
// loopback gate, AC3.2). A file is allowed iff it resolves inside ANY allowed root.
export const resolveAllowedAudioFilePath = (
  aRequestedPath: string,
  aAllowedRoots: readonly string[],
): ResolvedAudioFile | null => {
  const resolvedPath = resolve(aRequestedPath)
  const canonicalResolvedPath = canonicalizePathForCheck(resolvedPath)
  const allowedRoots = aAllowedRoots
    .map((rootPath) => canonicalizePathForCheck(resolve(rootPath)))
    .filter((rootPath, index, rootPaths) => {
      return rootPath !== "" && rootPaths.indexOf(rootPath) === index
    })

  if (allowedRoots.length === 0) {
    return null
  }

  const isAllowed = allowedRoots.some((rootPath) => isPathInsideBase(rootPath, canonicalResolvedPath))
  if (!isAllowed) {
    return null
  }

  const fileKind = getAudioFileKind(resolvedPath)
  if (fileKind === null) {
    return null
  }

  return {
    filePath: resolvedPath,
    fileKind,
  }
}