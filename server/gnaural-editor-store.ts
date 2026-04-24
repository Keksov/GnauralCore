import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import type { Subprocess } from 'bun'
import { XMLValidator } from 'fast-xml-parser'
import {
  getConfiguredAudioPresetsRoot,
  isPathInsideBase,
  resolveAllowedAudioFilePath,
} from './audio-file-utils'
import { resolveGnauralExecutablePath } from './gnaural-path'
import type {
  AudioEditorAutosaveRequest,
  AudioEditorDocumentResponse,
  AudioEditorHistoryContentResponse,
  AudioEditorHistoryEntry,
  AudioEditorHistoryResponse,
  AudioEditorRestoreRequest,
  AudioEditorRestoreResponse,
  AudioEditorSaveRequest,
  AudioEditorSaveResponse,
  AudioScheduleVoicePatchRequest,
  AudioSettings,
} from './protocol'

class GnauralEditorStoreError extends Error {
  public readonly status: number

  public constructor(aStatus: number, aMessage: string) {
    super(aMessage)
    this.name = 'GnauralEditorStoreError'
    this.status = aStatus
  }
}

interface ResolvedEditorFile {
  readonly baseName: string
  readonly filePath: string
  readonly historyDir: string
  readonly parentDir: string
}

interface SnapshotResult {
  readonly fileName: string
  readonly modifiedAtMs: number
}

interface PatchVoiceStateResult {
  readonly filePath: string
  readonly modifiedAtMs: number
  readonly savedAt: string
  readonly changed: boolean
  readonly historyFileName: string | null
  readonly voiceId: number
  readonly voiceIndex: number
}

interface PatchVoiceStatesItemResult {
  readonly voiceId: number
  readonly voiceIndex: number
  readonly changed: boolean
}

interface PatchVoiceStatesResult {
  readonly filePath: string
  readonly modifiedAtMs: number
  readonly savedAt: string
  readonly changed: boolean
  readonly historyFileName: string | null
  readonly items: readonly PatchVoiceStatesItemResult[]
}

interface PatchedVoiceXmlResult {
  readonly content: string
  readonly voiceIndex: number
}

const HISTORY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}/
const AUTOSAVE_MARKER = '--autosave--'
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

const escapeRegExp = (aValue: string): string => {
  return aValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const truncateModifiedAtMs = (aValue: number): number => {
  return Math.trunc(aValue)
}

const normalizeMessage = (aValue: string): string => {
  const normalized = aValue.replace(/\s+/g, ' ').trim()
  return normalized === '' ? 'Invalid XML document' : normalized
}

const formatTimestamp = (aDate: Date): string => {
  const year = aDate.getFullYear()
  const month = String(aDate.getMonth() + 1).padStart(2, '0')
  const day = String(aDate.getDate()).padStart(2, '0')
  const hours = String(aDate.getHours()).padStart(2, '0')
  const minutes = String(aDate.getMinutes()).padStart(2, '0')
  const seconds = String(aDate.getSeconds()).padStart(2, '0')
  const milliseconds = String(aDate.getMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}-${milliseconds}`
}

const isAutosaveHistoryFile = (aFileName: string, aBaseName: string): boolean => {
  const pattern = new RegExp(`^${HISTORY_TIMESTAMP_PATTERN.source}${escapeRegExp(AUTOSAVE_MARKER)}(?:\\d+-)?${escapeRegExp(aBaseName)}$`)
  return pattern.test(aFileName)
}

const isMatchingHistoryFile = (aFileName: string, aBaseName: string): boolean => {
  const escapedBaseName = escapeRegExp(aBaseName)
  const normalPattern = new RegExp(`^${HISTORY_TIMESTAMP_PATTERN.source}-(?:\\d+-)?${escapedBaseName}$`)
  const autosavePattern = new RegExp(`^${HISTORY_TIMESTAMP_PATTERN.source}${escapeRegExp(AUTOSAVE_MARKER)}(?:\\d+-)?${escapedBaseName}$`)
  return normalPattern.test(aFileName) || autosavePattern.test(aFileName)
}

const createHistoryFileName = (aBaseName: string, aAutosave: boolean): string => {
  const prefix = formatTimestamp(new Date())
  return aAutosave
    ? `${prefix}${AUTOSAVE_MARKER}${aBaseName}`
    : `${prefix}-${aBaseName}`
}

const createUniqueHistoryFileName = async (
  aHistoryDir: string,
  aBaseName: string,
  aAutosave: boolean,
): Promise<string> => {
  let attempt = 0

  while (attempt < 1000) {
    const nextBaseName = attempt === 0 ? aBaseName : `${attempt}-${aBaseName}`
    const nextName = createHistoryFileName(nextBaseName, aAutosave)

    if (!(await Bun.file(join(aHistoryDir, nextName)).exists())) {
      return nextName
    }

    attempt += 1
  }

  throw new GnauralEditorStoreError(500, 'Failed to allocate a unique history file name')
}

const validateXmlContent = (aContent: string): void => {
  const result = XMLValidator.validate(aContent)
  if (result === true) {
    return
  }

  const message = result.err.msg ?? 'Invalid XML document'
  throw new GnauralEditorStoreError(400, normalizeMessage(message))
}

const escapeXmlText = (aValue: string): string => {
  return aValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const normalizeHexColor = (aValue: string): string => {
  const trimmed = aValue.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new GnauralEditorStoreError(400, 'color must be a hex value in the #RRGGBB format')
  }

  return trimmed.toUpperCase()
}

const replaceOrInsertVoiceTag = (
  aVoiceBlock: string,
  aTagName: string,
  aTagValue: string,
  aChildIndent: string,
  aLineBreak: string,
): string => {
  const escapedTagName = escapeRegExp(aTagName)
  const tagPattern = new RegExp(`(<${escapedTagName}>)[\\s\\S]*?(</${escapedTagName}>)`)
  const encodedValue = escapeXmlText(aTagValue)

  if (tagPattern.test(aVoiceBlock)) {
    return aVoiceBlock.replace(tagPattern, `$1${encodedValue}$2`)
  }

  const insertion = `${aLineBreak}${aChildIndent}<${aTagName}>${encodedValue}</${aTagName}>`
  const anchors = ['entrycount', 'entries']

  for (const anchor of anchors) {
    const anchorPattern = new RegExp(`(${aLineBreak}[\\t ]*<${anchor}>)`)
    if (anchorPattern.test(aVoiceBlock)) {
      return aVoiceBlock.replace(anchorPattern, `${insertion}$1`)
    }
  }

  const closingPattern = new RegExp(`(${aLineBreak}[\\t ]*</voice>)`)
  if (closingPattern.test(aVoiceBlock)) {
    return aVoiceBlock.replace(closingPattern, `${insertion}$1`)
  }

  return `${aVoiceBlock}${insertion}${aLineBreak}</voice>`
}

const patchVoiceXmlState = (
  aContent: string,
  aVoiceId: number,
  aPatch: {
    readonly hidden?: boolean
    readonly muted?: boolean
    readonly color?: string
  },
): PatchedVoiceXmlResult => {
  if (aPatch.hidden === undefined && aPatch.muted === undefined && aPatch.color === undefined) {
    throw new GnauralEditorStoreError(400, 'At least one of hidden, muted, or color must be provided')
  }

  const lineBreak = aContent.includes('\r\n') ? '\r\n' : '\n'
  const voicePattern = /<voice>[\s\S]*?<\/voice>/g
  const voiceIdPattern = new RegExp(`<id>\\s*${aVoiceId}\\s*<\\/id>`)
  let voiceIndex = 0

  for (const match of aContent.matchAll(voicePattern)) {
    const voiceBlock = match[0]
    if (!voiceIdPattern.test(voiceBlock)) {
      voiceIndex += 1
      continue
    }

    const startIndex = match.index ?? 0
    const childIndent = voiceBlock.match(/\r?\n([\t ]+)<id>/)?.[1] ?? '    '
    let nextVoiceBlock = voiceBlock

    if (aPatch.muted !== undefined) {
      nextVoiceBlock = replaceOrInsertVoiceTag(nextVoiceBlock, 'voice_mute', aPatch.muted ? '1' : '0', childIndent, lineBreak)
    }

    if (aPatch.hidden !== undefined) {
      nextVoiceBlock = replaceOrInsertVoiceTag(nextVoiceBlock, 'mindwave_hidden', aPatch.hidden ? '1' : '0', childIndent, lineBreak)
    }

    if (aPatch.color !== undefined) {
      nextVoiceBlock = replaceOrInsertVoiceTag(nextVoiceBlock, 'mindwave_color', aPatch.color, childIndent, lineBreak)
    }

    if (nextVoiceBlock === voiceBlock) {
      return {
        content: aContent,
        voiceIndex,
      }
    }

    return {
      content: `${aContent.slice(0, startIndex)}${nextVoiceBlock}${aContent.slice(startIndex + voiceBlock.length)}`,
      voiceIndex,
    }
  }

  throw new GnauralEditorStoreError(404, 'Voice not found in Gnaural file')
}

export interface GnauralEditorStore {
  loadDocument(aRequestedPath: string, aSettings: AudioSettings): Promise<AudioEditorDocumentResponse>
  saveDocument(aRequest: AudioEditorSaveRequest, aSettings: AudioSettings): Promise<AudioEditorSaveResponse>
  autosaveDocument(aRequest: AudioEditorAutosaveRequest, aSettings: AudioSettings): Promise<AudioEditorHistoryEntry>
  listHistory(aRequestedPath: string, aSettings: AudioSettings): Promise<AudioEditorHistoryResponse>
  loadHistoryContent(aRequestedPath: string, aHistoryFileName: string, aSettings: AudioSettings): Promise<AudioEditorHistoryContentResponse>
  restoreDocument(aRequest: AudioEditorRestoreRequest, aSettings: AudioSettings): Promise<AudioEditorRestoreResponse>
  patchVoiceState(aRequest: AudioScheduleVoicePatchRequest, aSettings: AudioSettings): Promise<PatchVoiceStateResult>
  patchVoiceStates(aRequests: readonly AudioScheduleVoicePatchRequest[], aSettings: AudioSettings): Promise<PatchVoiceStatesResult>
}

class GnauralEditorStoreImpl implements GnauralEditorStore {
  private readonly gnauralCwd: string
  private readonly gnauralExePath: string
  private readonly writeQueues = new Map<string, Promise<void>>()

  public constructor(aServerDir: string) {
    void aServerDir
    const gnauralPathInfo = resolveGnauralExecutablePath()
    this.gnauralCwd = gnauralPathInfo.gnauralCwd
    this.gnauralExePath = gnauralPathInfo.gnauralExePath
  }

  public async loadDocument(aRequestedPath: string, aSettings: AudioSettings): Promise<AudioEditorDocumentResponse> {
    const resolvedFile = await this.resolveEditorFile(aRequestedPath, aSettings)
    const file = Bun.file(resolvedFile.filePath)
    if (!(await file.exists())) {
      throw new GnauralEditorStoreError(404, 'Gnaural file not found')
    }

    const fileStat = await stat(resolvedFile.filePath)
    return {
      filePath: resolvedFile.filePath,
      content: await file.text(),
      modifiedAtMs: truncateModifiedAtMs(fileStat.mtimeMs),
    }
  }

  public async saveDocument(aRequest: AudioEditorSaveRequest, aSettings: AudioSettings): Promise<AudioEditorSaveResponse> {
    return this.withFileLock(aRequest.path, async () => {
      const resolvedFile = await this.resolveEditorFile(aRequest.path, aSettings)
      const currentDocument = await this.readLiveDocument(resolvedFile)
      this.assertExpectedModifiedAt(currentDocument.modifiedAtMs, aRequest.expectedModifiedAtMs)

      if (currentDocument.content === aRequest.content) {
        return {
          filePath: resolvedFile.filePath,
          modifiedAtMs: currentDocument.modifiedAtMs,
          savedAt: new Date(currentDocument.modifiedAtMs).toISOString(),
          changed: false,
          historyFileName: null,
        }
      }

      validateXmlContent(aRequest.content)
      await this.ensureCurrentVersionSnapshotted(resolvedFile, currentDocument.content)
      await this.commitValidatedContent(resolvedFile, aRequest.content)

      const updatedStat = await stat(resolvedFile.filePath)
      const historySnapshot = await this.createHistorySnapshot(resolvedFile, aRequest.content, false)

      return {
        filePath: resolvedFile.filePath,
        modifiedAtMs: truncateModifiedAtMs(updatedStat.mtimeMs),
        savedAt: new Date(updatedStat.mtimeMs).toISOString(),
        changed: true,
        historyFileName: historySnapshot.fileName,
      }
    })
  }

  public async autosaveDocument(aRequest: AudioEditorAutosaveRequest, aSettings: AudioSettings): Promise<AudioEditorHistoryEntry> {
    return this.withFileLock(aRequest.path, async () => {
      const resolvedFile = await this.resolveEditorFile(aRequest.path, aSettings)
      const snapshot = await this.createHistorySnapshot(resolvedFile, aRequest.content, true)
      return {
        fileName: snapshot.fileName,
        createdAt: new Date(snapshot.modifiedAtMs).toISOString(),
        modifiedAtMs: snapshot.modifiedAtMs,
        size: new Blob([aRequest.content]).size,
        isAutosave: true,
      }
    })
  }

  public async listHistory(aRequestedPath: string, aSettings: AudioSettings): Promise<AudioEditorHistoryResponse> {
    const resolvedFile = await this.resolveEditorFile(aRequestedPath, aSettings)
    const items = await this.readHistoryEntries(resolvedFile)

    return {
      filePath: resolvedFile.filePath,
      items,
    }
  }

  public async loadHistoryContent(
    aRequestedPath: string,
    aHistoryFileName: string,
    aSettings: AudioSettings,
  ): Promise<AudioEditorHistoryContentResponse> {
    const resolvedFile = await this.resolveEditorFile(aRequestedPath, aSettings)
    const historyPath = await this.resolveHistoryFilePath(resolvedFile, aHistoryFileName)
    const file = Bun.file(historyPath)
    if (!(await file.exists())) {
      throw new GnauralEditorStoreError(404, 'History entry not found')
    }

    const fileStat = await stat(historyPath)

    return {
      filePath: resolvedFile.filePath,
      historyFileName: basename(historyPath),
      content: await file.text(),
      modifiedAtMs: truncateModifiedAtMs(fileStat.mtimeMs),
      isAutosave: isAutosaveHistoryFile(basename(historyPath), resolvedFile.baseName),
    }
  }

  public async restoreDocument(aRequest: AudioEditorRestoreRequest, aSettings: AudioSettings): Promise<AudioEditorRestoreResponse> {
    return this.withFileLock(aRequest.path, async () => {
      const resolvedFile = await this.resolveEditorFile(aRequest.path, aSettings)
      const currentDocument = await this.readLiveDocument(resolvedFile)
      this.assertExpectedModifiedAt(currentDocument.modifiedAtMs, aRequest.expectedModifiedAtMs)

      const historyPath = await this.resolveHistoryFilePath(resolvedFile, aRequest.historyFileName)
      const historyContent = await Bun.file(historyPath).text()
      validateXmlContent(historyContent)

      if (historyContent === currentDocument.content) {
        const historyStat = await stat(historyPath)
        return {
          filePath: resolvedFile.filePath,
          modifiedAtMs: currentDocument.modifiedAtMs,
          restoredAt: new Date(currentDocument.modifiedAtMs).toISOString(),
          restoredFrom: basename(historyPath),
          historyFileName: basename(historyPath),
        }
      }

      await this.ensureCurrentVersionSnapshotted(resolvedFile, currentDocument.content)
      await this.commitValidatedContent(resolvedFile, historyContent)

      const updatedStat = await stat(resolvedFile.filePath)
      const restoredSnapshot = await this.createHistorySnapshot(resolvedFile, historyContent, false)

      return {
        filePath: resolvedFile.filePath,
        modifiedAtMs: truncateModifiedAtMs(updatedStat.mtimeMs),
        restoredAt: new Date(updatedStat.mtimeMs).toISOString(),
        restoredFrom: basename(historyPath),
        historyFileName: restoredSnapshot.fileName,
      }
    })
  }

  public async patchVoiceState(aRequest: AudioScheduleVoicePatchRequest, aSettings: AudioSettings): Promise<PatchVoiceStateResult> {
    const result = await this.patchVoiceStates([aRequest], aSettings)
    const item = result.items[0]

    return {
      filePath: result.filePath,
      modifiedAtMs: result.modifiedAtMs,
      savedAt: result.savedAt,
      changed: item?.changed ?? result.changed,
      historyFileName: result.historyFileName,
      voiceId: item?.voiceId ?? aRequest.voiceId,
      voiceIndex: item?.voiceIndex ?? 0,
    }
  }

  public async patchVoiceStates(
    aRequests: readonly AudioScheduleVoicePatchRequest[],
    aSettings: AudioSettings,
  ): Promise<PatchVoiceStatesResult> {
    if (aRequests.length === 0) {
      throw new GnauralEditorStoreError(400, 'At least one voice-state patch is required')
    }

    const basePath = aRequests[0].path
    if (basePath.trim() === '') {
      throw new GnauralEditorStoreError(400, 'path is required')
    }

    for (const request of aRequests) {
      if (request.path !== basePath) {
        throw new GnauralEditorStoreError(400, 'All voice-state patches must target the same file')
      }

      if (request.hidden === undefined && request.muted === undefined && request.color === undefined) {
        throw new GnauralEditorStoreError(400, 'At least one of hidden, muted, or color is required')
      }
    }

    return this.withFileLock(basePath, async () => {
      const resolvedFile = await this.resolveEditorFile(basePath, aSettings)
      const currentDocument = await this.readLiveDocument(resolvedFile)
      let nextContent = currentDocument.content
      const items: PatchVoiceStatesItemResult[] = []

      for (const request of aRequests) {
        const normalizedPatch = {
          hidden: request.hidden,
          muted: request.muted,
          color: request.color === undefined ? undefined : normalizeHexColor(request.color),
        }
        const nextDocument = patchVoiceXmlState(nextContent, request.voiceId, normalizedPatch)
        const changed = nextDocument.content !== nextContent

        items.push({
          voiceId: request.voiceId,
          voiceIndex: nextDocument.voiceIndex,
          changed,
        })
        nextContent = nextDocument.content
      }

      if (nextContent === currentDocument.content) {
        return {
          filePath: resolvedFile.filePath,
          modifiedAtMs: currentDocument.modifiedAtMs,
          savedAt: new Date(currentDocument.modifiedAtMs).toISOString(),
          changed: false,
          historyFileName: null,
          items,
        }
      }

      validateXmlContent(nextContent)
      await this.ensureCurrentVersionSnapshotted(resolvedFile, currentDocument.content)
      await this.commitValidatedContent(resolvedFile, nextContent)

      const updatedStat = await stat(resolvedFile.filePath)
      const historySnapshot = await this.createHistorySnapshot(resolvedFile, nextContent, false)

      return {
        filePath: resolvedFile.filePath,
        modifiedAtMs: truncateModifiedAtMs(updatedStat.mtimeMs),
        savedAt: new Date(updatedStat.mtimeMs).toISOString(),
        changed: true,
        historyFileName: historySnapshot.fileName,
        items,
      }
    })
  }

  private async resolveEditorFile(aRequestedPath: string, aSettings: AudioSettings): Promise<ResolvedEditorFile> {
    const resolvedAudioFile = resolveAllowedAudioFilePath(aRequestedPath, aSettings)
    if (resolvedAudioFile === null) {
      throw new GnauralEditorStoreError(403, 'Requested audio file is outside the configured presets root or has an unsupported type')
    }

    if (resolvedAudioFile.fileKind !== 'gnaural') {
      throw new GnauralEditorStoreError(400, 'Only .gnaural files support editor access')
    }

    const presetsRoot = getConfiguredAudioPresetsRoot(aSettings)
    if (presetsRoot === null) {
      throw new GnauralEditorStoreError(400, 'Configured presets root is missing')
    }

    const canonicalRoot = await this.canonicalizePath(presetsRoot)
    const parentDir = dirname(resolvedAudioFile.filePath)
    const canonicalParentDir = await this.canonicalizePath(parentDir)
    const historyDir = join(canonicalParentDir, '.history')
    if (!isPathInsideBase(canonicalRoot, historyDir)) {
      throw new GnauralEditorStoreError(403, 'History directory would be created outside the configured presets root')
    }

    return {
      baseName: basename(resolvedAudioFile.filePath),
      filePath: resolvedAudioFile.filePath,
      historyDir,
      parentDir: canonicalParentDir,
    }
  }

  private async canonicalizePath(aPath: string): Promise<string> {
    try {
      return await realpath(aPath)
    } catch {
      return resolve(aPath)
    }
  }

  private async readLiveDocument(aResolvedFile: ResolvedEditorFile): Promise<AudioEditorDocumentResponse> {
    const file = Bun.file(aResolvedFile.filePath)
    if (!(await file.exists())) {
      throw new GnauralEditorStoreError(404, 'Gnaural file not found')
    }

    const fileStat = await stat(aResolvedFile.filePath)

    return {
      filePath: aResolvedFile.filePath,
      content: await file.text(),
      modifiedAtMs: truncateModifiedAtMs(fileStat.mtimeMs),
    }
  }

  private assertExpectedModifiedAt(aActualModifiedAtMs: number, aExpectedModifiedAtMs: number): void {
    if (aActualModifiedAtMs !== truncateModifiedAtMs(aExpectedModifiedAtMs)) {
      throw new GnauralEditorStoreError(409, 'The file was changed outside the editor. Reload it before saving again.')
    }
  }

  private async ensureHistoryDir(aResolvedFile: ResolvedEditorFile): Promise<void> {
    await mkdir(aResolvedFile.historyDir, { recursive: true })
  }

  private async readHistoryEntries(aResolvedFile: ResolvedEditorFile): Promise<readonly AudioEditorHistoryEntry[]> {
    try {
      const entries = await readdir(aResolvedFile.historyDir, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile() && isMatchingHistoryFile(entry.name, aResolvedFile.baseName))
        .map(async (entry): Promise<AudioEditorHistoryEntry> => {
          const filePath = join(aResolvedFile.historyDir, entry.name)
          const fileStat = await stat(filePath)

          return {
            fileName: entry.name,
            createdAt: new Date(fileStat.mtimeMs).toISOString(),
            modifiedAtMs: truncateModifiedAtMs(fileStat.mtimeMs),
            size: fileStat.size,
            isAutosave: isAutosaveHistoryFile(entry.name, aResolvedFile.baseName),
          }
        })

      const resolvedEntries = await Promise.all(files)
      return resolvedEntries.sort((left, right) => {
        if (left.modifiedAtMs !== right.modifiedAtMs) {
          return right.modifiedAtMs - left.modifiedAtMs
        }

        return right.fileName.localeCompare(left.fileName)
      })
    } catch {
      return []
    }
  }

  private async resolveHistoryFilePath(aResolvedFile: ResolvedEditorFile, aHistoryFileName: string): Promise<string> {
    const trimmed = aHistoryFileName.trim()
    if (trimmed === '' || basename(trimmed) !== trimmed || !isMatchingHistoryFile(trimmed, aResolvedFile.baseName)) {
      throw new GnauralEditorStoreError(400, 'Invalid history file name')
    }

    const resolvedPath = join(aResolvedFile.historyDir, trimmed)
    const canonicalResolvedPath = await this.canonicalizePath(resolvedPath)
    if (!isPathInsideBase(aResolvedFile.historyDir, canonicalResolvedPath)) {
      throw new GnauralEditorStoreError(403, 'Requested history file is outside the .history directory')
    }

    return resolvedPath
  }

  private async ensureCurrentVersionSnapshotted(aResolvedFile: ResolvedEditorFile, aCurrentContent: string): Promise<void> {
    const historyEntries = await this.readHistoryEntries(aResolvedFile)
    const latestEntry = historyEntries[0]
    if (latestEntry !== undefined) {
      const latestContent = await Bun.file(join(aResolvedFile.historyDir, latestEntry.fileName)).text()
      if (latestContent === aCurrentContent) {
        return
      }
    }

    await this.createHistorySnapshot(aResolvedFile, aCurrentContent, false)
  }

  private async createHistorySnapshot(
    aResolvedFile: ResolvedEditorFile,
    aContent: string,
    aAutosave: boolean,
  ): Promise<SnapshotResult> {
    await this.ensureHistoryDir(aResolvedFile)

    const fileName = await createUniqueHistoryFileName(aResolvedFile.historyDir, aResolvedFile.baseName, aAutosave)
    const filePath = join(aResolvedFile.historyDir, fileName)
    await Bun.write(filePath, aContent)

    const fileStat = await stat(filePath)
    return {
      fileName,
      modifiedAtMs: truncateModifiedAtMs(fileStat.mtimeMs),
    }
  }

  private async commitValidatedContent(aResolvedFile: ResolvedEditorFile, aContent: string): Promise<void> {
    const tempFilePath = join(aResolvedFile.parentDir, `.${aResolvedFile.baseName}.tmp-${randomUUID()}.gnaural`)

    try {
      await Bun.write(tempFilePath, aContent)
      await this.validateStagedFile(tempFilePath)
      await rename(tempFilePath, aResolvedFile.filePath)
    } finally {
      await rm(tempFilePath, { force: true }).catch(() => {
        // Ignore temp cleanup failures.
      })
    }
  }

  private async validateStagedFile(aTempFilePath: string): Promise<void> {
    let child: Subprocess<'ignore', 'ignore', 'pipe'>

    try {
      child = Bun.spawn([
        this.gnauralExePath,
        '--dump-schedule',
        aTempFilePath,
      ], {
        cwd: this.gnauralCwd,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to spawn Gnaural validation process'
      throw new GnauralEditorStoreError(500, message)
    }

    let stderrText = ''
    let exitCode = 0

    try {
      const result = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ])
      stderrText = result[0]
      exitCode = result[1]
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read Gnaural validation output'
      throw new GnauralEditorStoreError(500, message)
    }

    if (exitCode !== 0) {
      const message = stderrText.trim() || `Gnaural validation failed with exit code ${exitCode}`
      throw new GnauralEditorStoreError(400, message)
    }
  }

  private async withFileLock<T>(aFilePath: string, aAction: () => Promise<T>): Promise<T> {
    const queueKey = resolve(aFilePath).toLowerCase()
    const previous = this.writeQueues.get(queueKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(aAction)

    const queueTail = next.then(() => undefined, () => undefined)
    this.writeQueues.set(queueKey, queueTail)

    try {
      return await next
    } finally {
      if (this.writeQueues.get(queueKey) === queueTail) {
        this.writeQueues.delete(queueKey)
      }
    }
  }
}

export const isGnauralEditorStoreError = (aValue: unknown): aValue is GnauralEditorStoreError => {
  return aValue instanceof GnauralEditorStoreError
}

export const createGnauralEditorStore = (aServerDir: string): GnauralEditorStore => {
  return new GnauralEditorStoreImpl(aServerDir)
}