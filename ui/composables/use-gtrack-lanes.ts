// GT2.2 — lane management for the gtrack editor. Builds a GTrackModel from the current .gnaural
// schedule and manages the set of editor lanes (each shows one or more voices under a display
// mode). Config (which voices, which mode, order, hidden) persists per file. Kept in a composable
// so AudioPage only renders + delegates.

import { computed, effectScope, ref, shallowRef, watch, type Ref } from 'vue'

import type { GnauralScheduleData, ProjectUndoLogBranch, ProjectUndoLogCommit, ProjectUndoLogCommitInput, ProjectUndoLogGcPolicy } from '@protocol'

import { audioApi } from '../audio-api'
import { useAudioStore } from '../stores/audio'
import { GTrackModel, clampPointTime, createGTrackHistory, scheduleContentSignature, trimUndoJournal, type GTrackPoint, type GTrackSchedule, type GTrackUndoJournal, type GTrackUndoStep, type GTrackVoice } from './gtrack-model'
import { useUndoJournalSettings } from './use-undo-journal-settings'
import { GTRACK_MODES, valuePatchForMode, type GTrackBaseScale, type GTrackMode } from './gtrack-render'
import { findPreparseVoiceIds, patchGnauralXml } from './gtrack-xml'
import { applyEndClickFix, applyLoopClickFix, lintSchedule, type GTrackDiagnostic } from './gtrack-lint'
import { mergeStoredSettings, type SpectrogramSettings } from './spectrogram-settings'
import {
  appendProjectUndoLogNowFor,
  clearProjectUndoLogFor,
  deleteProjectUndoLogBranchFor,
  discardPendingUndoLogFor,
  flushProjectUndoLogFor,
  queueProjectUndoLogCommitsFor,
  queueProjectUndoLogRefsFor,
  readProjectSectionFor,
  readProjectUndoLogBranchesFor,
  readProjectUndoLogChainFor,
  setUndoLogAppendResultHandler,
  writeProjectSectionFor,
} from './use-project'
import { commitToStep, planUndoLogAdoption, snapshotSig, stepToCommitInput } from './undo-log-adoption'

/** VL5.1 (undo-versioned-log): a pre-window history row for the panel — a commit older than the
 *  in-memory undo window, living only in the log. Delta rows carry the mapped step (tooltips). */
export interface GTrackDeepUndoRow {
  readonly cid: string
  readonly type: 'delta' | 'snapshot' | 'meta'
  readonly kind: string
  readonly label: string
  readonly atMs: number
  readonly step: GTrackUndoStep | null
}

/** GT4.3/GT4.1 (GT-D17): per-lane solo audio of the lane's voice set — waveform, spectrum, both, or
 *  none. Rendered from a muted-others .gnaural render (also how audiofile/noise voices show audio). */
export type GTrackSoloMode = 'off' | 'wave' | 'spectrum' | 'both' | 'overlay'
// VS4.6 (owner): 'overlay' = «Волна+Спектр» — ONE combined graph, the wave drawn over the spectrum
// (the lane mirror of the overall 'overlay' view mode), unlike 'both' = two separate sub-graphs.
const SOLO_MODES: readonly GTrackSoloMode[] = ['off', 'wave', 'spectrum', 'both', 'overlay']

export interface GTrackLane {
  id: number
  voiceIds: number[]
  /** VS4.1 (owner phase 4): the CHECKED display modes — the lane renders one curve graph per mode,
   *  stacked (canonical GTRACK_MODES order). Empty = the lane is hidden from the stack (VS-D5). */
  modes: GTrackMode[]
  hidden: boolean
  /** VS4.1: per-mode graph heights (px); unset entries fall back to curveHeight (the legacy single
   *  curve height, kept as the seed/default). */
  modeHeights?: Partial<Record<GTrackMode, number>>
  /** GT4.3: show the solo audio of this lane's voices ('off' when absent). */
  soloMode?: GTrackSoloMode
  /** GT4.2 (GT-D17): true = solo audio UNDER the curves (inline underlay); false = below as a sub-lane. */
  soloInline?: boolean
  /** GT10.4 (owner req. 48): solo-wave colour + opacity so the wave stays distinguishable. */
  soloWaveColor?: string
  soloWaveOpacity?: number
  /** VS2.5 (VS-D4 rev 2): solo-wave amplitude scale — the lane reuses the overall waveform settings
   *  dialog (mono), whose form has lin/dB, so the lane stores it too. */
  soloWaveScale?: 'linear' | 'db'
  /** owner 2026-07-14: on a Base-freq lane, shade the binaural beat band (base ± beat/2), like the
   *  Schedule tab. Only rendered in 'base' mode. */
  beatBand?: boolean
  /** VB-D1 (owner 2026-07-17): on a Volume lane, shade the stereo-balance corridor [volL, volR] around
   *  the volume mean line V=(volL+volR)/2 (mirror of beatBand). Only rendered in 'volume' mode. */
  balanceBand?: boolean
  /** GT11.5 (owner 2026-07-14): collapse this track's graphs (curve + solo wave/spectrum sub-lanes)
   *  down to just its header bar. Persisted per file. */
  folded?: boolean
  /** GT11.8 (owner 2026-07-14): individually hide the solo wave/spectrum SUB-graphs (their own eye
   *  button); restored from the track header eye (GT11.11). Distinct from soloMode (which sub-graphs
   *  the lane HAS) and from folded (collapses the whole track). */
  soloWaveHidden?: boolean
  soloSpectrumHidden?: boolean
  /** GT11.7 (owner 2026-07-14): per-graph heights (px). Each gtrack graph — the curve and its solo
   *  wave/spectrum sub-lanes — resizes independently (own handle); persisted per file. Unset = the
   *  derived default (curve = global lane height; wave 0.7x; spectrum 0.9x). */
  curveHeight?: number
  soloWaveHeight?: number
  soloSpectrumHeight?: number
}

/** GT3.1: a vertex reference within a lane. */
export interface GTrackPointRef {
  readonly voiceId: number
  readonly pointIndex: number
}
/** GT3.1: the globally-selected vertex (which lane + which point). */
export interface GTrackSelection extends GTrackPointRef {
  readonly laneId: number
}
/** GT3.2: payload emitted by GTrackView while dragging a vertex. */
export interface GTrackDragMove {
  readonly point: GTrackPointRef
  readonly timeSec: number
  readonly value: number
}
/** GT11.4: payload emitted by GTrackView while dragging a beat-band edge (base ± beat/2). */
export interface GTrackBeatDragMove {
  readonly point: GTrackPointRef
  readonly beatFreqHalf: number
}
/** VB2.1 (owner 2026-07-17): payload emitted by GTrackView while dragging a balance-corridor edge. */
export interface GTrackBalanceDragMove {
  readonly point: GTrackPointRef
  readonly balance: number
}

/** GT3.10 (GT-D16): point-drag behaviour — clamp within neighbours, or cross over them. */
export type GTrackPointDragMode = 'clamp' | 'crossover'

/** GT3.6: payload emitted by GTrackView when double-clicking a curve to add a point. */
export interface GTrackAddPoint {
  readonly voiceId: number
  readonly timeSec: number
}

export interface ResolvedGTrackLane {
  readonly id: number
  /** VS4.1: checked display modes in canonical order (may be empty — such a lane is not rendered). */
  readonly modes: readonly GTrackMode[]
  /** VS4.1: resolved per-mode graph heights (every checked mode has an entry). */
  readonly modeHeights: Readonly<Partial<Record<GTrackMode, number>>>
  readonly voiceIds: readonly number[]
  readonly voices: readonly GTrackVoice[]
  readonly soloMode: GTrackSoloMode
  readonly soloInline: boolean
  readonly soloWaveColor: string
  readonly soloWaveOpacity: number
  readonly soloWaveScale: 'linear' | 'db'
  readonly beatBand: boolean
  readonly balanceBand: boolean
  readonly folded: boolean
  readonly soloWaveHidden: boolean
  readonly soloSpectrumHidden: boolean
  readonly curveHeight: number
  readonly soloWaveHeight: number
  readonly soloSpectrumHeight: number
}

interface StoredLane {
  id: number
  voiceIds: number[]
  /** Pre-VS4.1 single mode — still WRITTEN (modes[0]) for downgrade safety, READ as the fallback. */
  mode: string
  /** VS4.1: the checked display modes. */
  modes?: string[]
  modeHeights?: Record<string, number>
  hidden: boolean
  soloMode?: string
  soloInline?: boolean
  soloWaveColor?: string
  soloWaveOpacity?: number
  soloWaveScale?: string
  beatBand?: boolean
  balanceBand?: boolean
  folded?: boolean
  soloWaveHidden?: boolean
  soloSpectrumHidden?: boolean
  curveHeight?: number
  soloWaveHeight?: number
  soloSpectrumHeight?: number
}

const STORAGE_KEY = 'mindwave-gtrack-lanes'
// GT8.1 (GT-D19): per-file, per-lane spectrum-settings OVERRIDE. A lane WITHOUT an entry uses the
// global spectrogram settings (unchanged behaviour); customizing a lane's solo spectrum stores a
// full independent SpectrogramSettings here (each spectrogram independent, owner req. 36).
const STORAGE_SPECTRUM_KEY = 'mindwave-gtrack-lane-spectrum'
const STORAGE_HEIGHT_KEY = 'mindwave-gtrack-lane-height'
const STORAGE_MIX_KEY = 'mindwave-gtrack-mix-excluded'
// project-store PR2.1 (PR-D11): the per-file lane state now lives in project sections; the
// localStorage keys above stay as a transition safety net + one-time migration seed.
const SECTION_LANES = 'gtrackLanes'
const SECTION_LANE_SPECTRUM = 'laneSpectrum'
const SECTION_MIX_EXCLUDED = 'mixExcluded'
const LANE_HEIGHT_DEFAULT = 120
const LANE_HEIGHT_MIN = 60
const LANE_HEIGHT_MAX = 600

function isTonal(voice: GTrackVoice): boolean {
  return voice.points.some((p) => p.baseFreq > 0)
}

function loadAllStored(): Record<string, StoredLane[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, StoredLane[]>) : {}
  } catch {
    return {}
  }
}

function toMode(v: unknown): GTrackMode {
  return typeof v === 'string' && (GTRACK_MODES as readonly string[]).includes(v) ? (v as GTrackMode) : 'base'
}
/** VS4.1: sanitize stored per-mode heights (junk-tolerant, numbers only). */
function sanitizeModeHeights(v: unknown): Partial<Record<GTrackMode, number>> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Partial<Record<GTrackMode, number>> = {}
  for (const m of GTRACK_MODES) {
    const h = (v as Record<string, unknown>)[m]
    if (typeof h === 'number' && Number.isFinite(h)) out[m] = h
  }
  return Object.keys(out).length > 0 ? out : undefined
}
/** VS4.1: sanitize a stored modes list; falls back to the legacy single `mode` field. */
function toModes(v: unknown, legacyMode: unknown): GTrackMode[] {
  if (Array.isArray(v)) {
    const valid = GTRACK_MODES.filter((m) => v.includes(m))
    if (valid.length > 0 || v.length === 0) return valid // an explicit [] means "hidden by modes"
  }
  return [toMode(legacyMode)]
}

export function useGtrackLanes(schedule: Ref<GnauralScheduleData | null>, filePath: Ref<string | null>) {
  const model = ref<GTrackModel | null>(null)
  const lanes = ref<GTrackLane[]>([])
  let nextLaneId = 1

  const laneHeight = ref<number>(loadHeight())
  function loadHeight(): number {
    try {
      const raw = localStorage.getItem(STORAGE_HEIGHT_KEY)
      const n = raw === null ? NaN : Number(raw)
      return Number.isFinite(n) ? clampHeight(n) : LANE_HEIGHT_DEFAULT
    } catch {
      return LANE_HEIGHT_DEFAULT
    }
  }
  function clampHeight(n: number): number {
    return Math.max(LANE_HEIGHT_MIN, Math.min(LANE_HEIGHT_MAX, Math.round(n)))
  }
  function setLaneHeight(n: number): void {
    laneHeight.value = clampHeight(n)
    try { localStorage.setItem(STORAGE_HEIGHT_KEY, String(laneHeight.value)) } catch { /* ignore */ }
  }

  // GT3.2: the GTrackModel is a plain class — its internal edits are NOT Vue-reactive. This
  // shallowRef mirrors the model's schedule (a fresh reference is produced on every edit, so
  // assigning it re-triggers voices/visibleLanes). Call syncSchedule() after any model mutation.
  const scheduleRef = shallowRef<GTrackSchedule | null>(model.value?.schedule ?? null)
  function syncSchedule(): void {
    scheduleRef.value = model.value !== null ? model.value.schedule : null
  }
  const voices = computed<readonly GTrackVoice[]>(() => scheduleRef.value?.voices ?? [])
  // durationSec is ONE loop (totalTimeSec) — the width of the Tracks axis; the whole stack (curves,
  // wave, spectrum) is drawn one loop wide, since every loop is identical. loopCount/fullDurationSec
  // describe the actual playback session (TP2.1): the server plays totalTimeSec x max(1, loopCount),
  // so the transport position runs 0..fullDurationSec while the axis stays one loop. TP2.2/TP2.3 use
  // these for a cyclic playhead + the status bar; the axis itself does NOT change.
  const durationSec = computed(() => schedule.value?.totalTimeSec ?? 0)
  const loopCount = computed(() => Math.max(1, Math.floor(schedule.value?.loopCount ?? 1)))
  const fullDurationSec = computed(() => durationSec.value * loopCount.value)
  // GT9.1/GT9.2 (owner req. 42): live schedule lint — re-runs on every edit (scheduleRef changes).
  const diagnostics = computed<GTrackDiagnostic[]>(() =>
    scheduleRef.value === null ? [] : lintSchedule(scheduleRef.value),
  )

  // GT3.1/3.2: point-edit mode + selection (ephemeral). Declared before the immediate schedule
  // watch (which clears the selection) to avoid a temporal-dead-zone reference.
  const pointModeLanes = ref<Set<number>>(new Set())
  const selection = ref<GTrackSelection | null>(null)

  function voiceById(id: number): GTrackVoice | undefined {
    return voices.value.find((v) => v.id === id)
  }

  // VS4.1 (VS-D5): a lane with NO checked modes is hidden from the stack (and listed with the
  // hidden ones so the eye menu can bring it back — setLaneHidden(false) re-seeds a mode).
  const visibleLanes = computed<ResolvedGTrackLane[]>(() =>
    lanes.value
      .filter((lane) => !lane.hidden && lane.modes.length > 0)
      .map((lane) => resolveLane(lane)),
  )
  const hiddenLanes = computed<ResolvedGTrackLane[]>(() =>
    lanes.value.filter((lane) => lane.hidden || lane.modes.length === 0).map((lane) => resolveLane(lane)),
  )
  function resolveLane(lane: GTrackLane): ResolvedGTrackLane {
    // Canonical GTRACK_MODES order — the stack renders top-to-bottom in this order regardless of
    // the order the checkboxes were ticked in.
    const modes = GTRACK_MODES.filter((m) => lane.modes.includes(m))
    const modeHeights: Partial<Record<GTrackMode, number>> = {}
    for (const m of modes) modeHeights[m] = clampHeight(lane.modeHeights?.[m] ?? lane.curveHeight ?? laneHeight.value)
    return {
      id: lane.id,
      modes,
      modeHeights,
      voiceIds: lane.voiceIds,
      voices: lane.voiceIds.map(voiceById).filter((v): v is GTrackVoice => v !== undefined),
      soloMode: lane.soloMode ?? 'off',
      soloInline: lane.soloInline ?? false,
      // amber default — distinct from the voice-curve palette so the wave stays visible (req 48)
      soloWaveColor: lane.soloWaveColor ?? '#f59e0b',
      soloWaveOpacity: lane.soloWaveOpacity ?? 0.6,
      soloWaveScale: lane.soloWaveScale ?? 'linear',
      beatBand: lane.beatBand ?? false,
      balanceBand: lane.balanceBand ?? false,
      folded: lane.folded ?? false,
      soloWaveHidden: lane.soloWaveHidden ?? false,
      soloSpectrumHidden: lane.soloSpectrumHidden ?? false,
      curveHeight: clampHeight(lane.curveHeight ?? laneHeight.value),
      soloWaveHeight: clampHeight(lane.soloWaveHeight ?? Math.round(laneHeight.value * 0.7)),
      soloSpectrumHeight: clampHeight(lane.soloSpectrumHeight ?? Math.round(laneHeight.value * 0.9)),
    }
  }

  // --- persistence ---
  function storedLanesSnapshot(): StoredLane[] {
    return lanes.value.map((l) => ({ id: l.id, voiceIds: l.voiceIds.slice(), mode: l.modes[0] ?? 'base', modes: l.modes.slice(), modeHeights: l.modeHeights === undefined ? undefined : { ...l.modeHeights }, hidden: l.hidden, soloMode: l.soloMode ?? 'off', soloInline: l.soloInline ?? false, soloWaveColor: l.soloWaveColor, soloWaveOpacity: l.soloWaveOpacity, soloWaveScale: l.soloWaveScale, beatBand: l.beatBand ?? false, balanceBand: l.balanceBand ?? false, folded: l.folded ?? false, soloWaveHidden: l.soloWaveHidden ?? false, soloSpectrumHidden: l.soloSpectrumHidden ?? false, curveHeight: l.curveHeight, soloWaveHeight: l.soloWaveHeight, soloSpectrumHeight: l.soloSpectrumHeight }))
  }
  function persist(): void {
    const key = filePath.value
    if (key === null) return
    const snapshot = storedLanesSnapshot()
    try {
      const all = loadAllStored()
      all[key] = snapshot
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {
      // ignore
    }
    // PR2.1: the project section is the source of truth; localStorage above is the safety net.
    writeProjectSectionFor(key, SECTION_LANES, snapshot)
  }

  // GT8.1 (GT-D19): per-lane spectrum-settings override, persisted per file. Absent -> the lane's
  // solo spectrum uses the global settings; present -> an independent SpectrogramSettings.
  const laneSpectrum = ref<Record<number, SpectrogramSettings>>({})
  function loadAllSpectrum(): Record<string, Record<number, unknown>> {
    try {
      const raw = localStorage.getItem(STORAGE_SPECTRUM_KEY)
      const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Record<number, unknown>>) : {}
    } catch {
      return {}
    }
  }
  function restoreSpectrum(): void {
    const key = filePath.value
    const stored = key === null ? undefined : loadAllSpectrum()[key]
    const out: Record<number, SpectrogramSettings> = {}
    if (stored !== undefined && stored !== null && typeof stored === 'object') {
      for (const [idStr, raw] of Object.entries(stored)) out[Number(idStr)] = mergeStoredSettings(raw)
    }
    laneSpectrum.value = out
  }
  function persistSpectrum(): void {
    const key = filePath.value
    if (key === null) return
    try {
      const all = loadAllSpectrum()
      all[key] = laneSpectrum.value
      localStorage.setItem(STORAGE_SPECTRUM_KEY, JSON.stringify(all))
    } catch {
      // ignore
    }
    writeProjectSectionFor(key, SECTION_LANE_SPECTRUM, laneSpectrum.value)
  }
  function getLaneSpectrum(laneId: number): SpectrogramSettings | null {
    return laneSpectrum.value[laneId] ?? null
  }
  /** Create a lane override (seeded from `seed`, usually the global settings) if absent; return it. */
  function ensureLaneSpectrum(laneId: number, seed: SpectrogramSettings): SpectrogramSettings {
    const existing = laneSpectrum.value[laneId]
    if (existing !== undefined) return existing
    const created: SpectrogramSettings = { ...seed }
    laneSpectrum.value = { ...laneSpectrum.value, [laneId]: created }
    persistSpectrum()
    return created
  }
  function setLaneSpectrum(laneId: number, settings: SpectrogramSettings): void {
    laneSpectrum.value = { ...laneSpectrum.value, [laneId]: { ...settings } }
    persistSpectrum()
  }
  function clearLaneSpectrum(laneId: number): void {
    if (laneSpectrum.value[laneId] === undefined) return
    const next = { ...laneSpectrum.value }
    delete next[laneId]
    laneSpectrum.value = next
    persistSpectrum()
  }

  // owner 2026-07-13: per-voice inclusion in the OVERALL (combined) wave/spectrum — independent of the
  // eye (curve-lane display) and mute (audio). Persisted per file like the lane config, so a same-file
  // reload (Save / mute) keeps it while a file switch loads the new file's set.
  const excludedFromMix = ref<Set<number>>(new Set())
  function loadAllMix(): Record<string, number[]> {
    try {
      const raw = localStorage.getItem(STORAGE_MIX_KEY)
      const parsed = raw === null ? null : (JSON.parse(raw) as unknown)
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number[]>) : {}
    } catch {
      return {}
    }
  }
  function restoreMix(): void {
    const key = filePath.value
    const stored = key === null ? undefined : loadAllMix()[key]
    excludedFromMix.value = new Set(Array.isArray(stored) ? stored : [])
  }
  function persistMix(): void {
    const key = filePath.value
    if (key === null) return
    try {
      const all = loadAllMix()
      all[key] = [...excludedFromMix.value]
      localStorage.setItem(STORAGE_MIX_KEY, JSON.stringify(all))
    } catch {
      // ignore
    }
    writeProjectSectionFor(key, SECTION_MIX_EXCLUDED, [...excludedFromMix.value])
  }
  function isVoiceInMix(voiceId: number): boolean {
    return !excludedFromMix.value.has(voiceId)
  }
  function setVoiceInMix(voiceId: number, inMix: boolean): void {
    const next = new Set(excludedFromMix.value)
    if (inMix) next.delete(voiceId)
    else next.add(voiceId)
    excludedFromMix.value = next
    persistMix()
  }
  // Voice ids feeding the overall wave/spectrum. Empty = full mix (no solo) when NOTHING is excluded;
  // otherwise the explicit included subset. `hasMixVoices` gates the graph when EVERYTHING is excluded
  // (an empty solo set would otherwise be interpreted as "full mix" by the views).
  const mixVoiceIds = computed<readonly number[]>(() => {
    const all = voices.value.map((v) => v.id)
    const included = all.filter((id) => !excludedFromMix.value.has(id))
    return included.length === all.length ? [] : included
  })
  const hasMixVoices = computed<boolean>(() => voices.value.some((v) => !excludedFromMix.value.has(v.id)))

  // GT-D13 (owner 2026-07-09): default = ONE VOICE -> ONE LANE (like the classic schedule editor's
  // per-voice tracks). A tonal voice starts on Base freq; noise/audiofile on Volume (no base
  // frequency, but a meaningful volume envelope). Users can then merge voices into one lane or
  // spread one voice across several lanes (different parameters) via the lane gear / + lane.
  function defaultLaneConfig(): { voiceIds: number[]; mode: GTrackMode } {
    const all = voices.value
    const tonalIds = all.filter(isTonal).map((v) => v.id)
    if (tonalIds.length > 0) return { voiceIds: tonalIds, mode: 'base' }
    return { voiceIds: all.map((v) => v.id), mode: 'volume' }
  }

  function laneForVoice(v: GTrackVoice): GTrackLane {
    return { id: nextLaneId++, voiceIds: [v.id], modes: [isTonal(v) ? 'base' : 'volume'], hidden: false }
  }

  // GT-D13 refined (2026-07-11): the DEFAULT layout gives each TONAL voice its own Base-freq lane.
  // Audiofile/noise voices are NOT auto-laned — their only curve is a volume envelope, and a real
  // preset (ForestMeditation: 30 nature clips + 1 binaural) would otherwise open as a 31-lane wall.
  // Those voices stay one toggle away in the voices panel, and Phase 4 gives them real audio
  // (wave/spectrum) lanes. A schedule with NO tonal voices (e.g. an all-noise file) falls back to a
  // single Volume lane with every voice so the stack isn't empty.
  function defaultLanes(): GTrackLane[] {
    const tonal = voices.value.filter(isTonal)
    if (tonal.length > 0) return tonal.map(laneForVoice)
    const cfg = defaultLaneConfig()
    return [{ id: nextLaneId++, voiceIds: cfg.voiceIds, modes: [cfg.mode], hidden: false }]
  }

  /** Sanitize a persisted lane list (project section or localStorage) into live lanes; null when
   *  the input holds nothing usable. Also advances nextLaneId past the restored ids. */
  function mapStoredLanes(stored: unknown): GTrackLane[] | null {
    if (!Array.isArray(stored) || stored.length === 0) return null
    const validIds = new Set(voices.value.map((v) => v.id))
    const restored = (stored as StoredLane[]).map((s) => ({
      id: s.id,
      voiceIds: (Array.isArray(s.voiceIds) ? s.voiceIds : []).filter((id) => validIds.has(id)),
      modes: toModes(s.modes, s.mode),
      modeHeights: sanitizeModeHeights(s.modeHeights),
      hidden: s.hidden === true,
      soloMode: (SOLO_MODES.includes(s.soloMode as GTrackSoloMode) ? s.soloMode : 'off') as GTrackSoloMode,
      soloInline: s.soloInline === true,
      soloWaveColor: typeof s.soloWaveColor === 'string' ? s.soloWaveColor : undefined,
      soloWaveOpacity: typeof s.soloWaveOpacity === 'number' ? s.soloWaveOpacity : undefined,
      soloWaveScale: (s.soloWaveScale === 'db' || s.soloWaveScale === 'linear' ? s.soloWaveScale : undefined) as 'linear' | 'db' | undefined,
      beatBand: s.beatBand === true,
      balanceBand: s.balanceBand === true,
      folded: s.folded === true,
      soloWaveHidden: s.soloWaveHidden === true,
      soloSpectrumHidden: s.soloSpectrumHidden === true,
      curveHeight: typeof s.curveHeight === 'number' ? s.curveHeight : undefined,
      soloWaveHeight: typeof s.soloWaveHeight === 'number' ? s.soloWaveHeight : undefined,
      soloSpectrumHeight: typeof s.soloSpectrumHeight === 'number' ? s.soloSpectrumHeight : undefined,
    }))
    nextLaneId = Math.max(nextLaneId, ...restored.map((l) => l.id + 1))
    return restored
  }

  function restoreOrDefault(): void {
    const key = filePath.value
    const restored = key === null ? null : mapStoredLanes(loadAllStored()[key])
    lanes.value = restored !== null ? restored : defaultLanes()
  }

  // PR2.1 (PR-D11): the project section wins over the synchronous localStorage restore; a file whose
  // project has no section yet gets a one-time migration seeded from localStorage. Guarded by a
  // request id so a fast file switch never applies a stale response.
  let projectRestoreReqId = 0
  async function restoreFromProject(reqId: number): Promise<void> {
    const key = filePath.value
    if (key === null) return
    const [storedLanes, storedSpectrum, storedMix, undoChain] = await Promise.all([
      readProjectSectionFor<unknown>(key, SECTION_LANES),
      readProjectSectionFor<Record<string, unknown>>(key, SECTION_LANE_SPECTRUM),
      readProjectSectionFor<unknown>(key, SECTION_MIX_EXCLUDED),
      // VL5.2 fix: adopt from MAIN, not head — main moves atomically with every append, while
      // head is a debounced ref that can lag (races its own append; a save snapshot is a CHILD
      // of the last delta, so a stale head's ancestor walk missed it → «журнал пуст»).
      readProjectUndoLogChainFor(key, { from: 'main', limit: 300 }),
    ])
    if (reqId !== projectRestoreReqId || key !== filePath.value) return

    // VL4.2 (VL-D5): adopt the history window from the commit log — the chain from head down to
    // the snapshot whose signature matches the freshly-loaded file; deltas above the anchor are
    // the previous session's unsaved tail and become REDO. A mismatch is no longer a loss: the
    // log stays intact on the server. An EMPTY log simply starts a fresh history — the v3
    // migration path is gone (undo-legacy-removal).
    const m = model.value
    if (m !== null && undoChain !== null) {
      undoLogMainTip = undoChain.refs.main
      undoLogLastSentHead = undoChain.refs.head
      undoTags.value = { ...undoChain.refs.tags } // VL-D9: the named refs feed the panel badges
      let synced: readonly GTrackUndoStep[] = []
      let ready = true
      if (undoJournalSettings.value.clearOnClose) {
        if (undoChain.commits.length > 0) void clearProjectUndoLogFor(key)
      } else if (undoChain.commits.length > 0) {
        let plan = planUndoLogAdoption(undoChain.commits, m.currentSignature)
        if (plan === null && undoChain.refs.head !== null && undoChain.refs.head !== undoChain.refs.main) {
          // VL5.2 round 2: the anchor may be a SIDE snapshot of a mid-history save — it lives
          // off the main line and is reachable only through the head ref.
          const headChain = await readProjectUndoLogChainFor(key, { from: 'head', limit: 50 })
          if (reqId !== projectRestoreReqId || key !== filePath.value || m !== model.value) return
          if (headChain !== null && headChain.commits.length > 0) {
            plan = planUndoLogAdoption(undoChain.commits, m.currentSignature, headChain.commits)
          }
        }
        if (plan !== null && m.adoptUndoJournal(plan.journal)) {
          undoLogPositions = plan.positionCids
          synced = plan.journal.steps
          console.info(
            `[undo-diag] undo-log adopted: ${plan.journal.steps.length} steps, cursor ${plan.journal.cursor} (anchor ${plan.anchorCid})`,
          )
          refreshEditState(false)
        } else if (plan === null) {
          console.warn('[undo-diag] undo-log adoption refused: no snapshot matches the loaded file (external edit?) — the log itself is intact')
        }
      }
      undoLogReady = ready
      // Edits made before this restore resolved (fast fingers) sync now via the normal diff.
      if (ready && m === model.value && m.historySteps.length > synced.length) syncUndoLog(m, synced)
    } else if (m !== null) {
      console.warn('[undo-diag] undo-log chain fetch failed; history sync stays off for this file until reopen')
    }

    if (storedLanes === null) {
      // No section yet -> one-time migration seeded from localStorage (already applied on screen).
      const local = loadAllStored()[key]
      if (Array.isArray(local) && local.length > 0) writeProjectSectionFor(key, SECTION_LANES, local)
    } else {
      const mappedLanes = mapStoredLanes(storedLanes)
      if (mappedLanes !== null) lanes.value = mappedLanes
      // An existing-but-empty section means "no lanes stored": keep the defaults, do NOT reseed.
    }

    if (storedSpectrum !== null && typeof storedSpectrum === 'object') {
      const out: Record<number, SpectrogramSettings> = {}
      for (const [idStr, raw] of Object.entries(storedSpectrum)) out[Number(idStr)] = mergeStoredSettings(raw)
      laneSpectrum.value = out
    } else {
      const local = loadAllSpectrum()[key]
      if (local !== undefined && local !== null && Object.keys(local).length > 0) {
        writeProjectSectionFor(key, SECTION_LANE_SPECTRUM, local)
      }
    }

    if (storedMix === null) {
      const local = loadAllMix()[key]
      if (Array.isArray(local) && local.length > 0) writeProjectSectionFor(key, SECTION_MIX_EXCLUDED, local)
    } else if (Array.isArray(storedMix)) {
      excludedFromMix.value = new Set(storedMix.filter((n): n is number => typeof n === 'number'))
    }
  }

  // Edit state (dirty / undo / redo). Declared BEFORE the immediate schedule watch so that watch can
  // refresh it when the model is rebuilt (on file switch AND after a Save reload) — otherwise the
  // flags would keep the previous file's/edit's values.
  const dirty = ref(false)
  const canUndo = ref(false)
  const canRedo = ref(false)
  // UG3.1 (req 3): a reactive mirror of the action log for the operations panel. The model mutates
  // its history container in place, so a fresh array copy per refresh is what makes Vue re-render.
  const undoSteps = shallowRef<readonly GTrackUndoStep[]>([])
  const undoCursor = ref(0)
  // PR2.2 (PR-D8): every user-edit path already funnels through refreshEditState(), so it doubles
  // as the undo-journal persist hook. The model rebuild (and journal adoption itself) pass false —
  // persisting there would overwrite the stored journal with an empty baseline before it is adopted.
  function refreshEditState(persistJournal = true): void {
    const m = model.value
    const prevSteps = undoSteps.value
    dirty.value = m?.isDirty ?? false
    canUndo.value = m?.canUndo ?? false
    canRedo.value = m?.canRedo ?? false
    undoSteps.value = m === null ? [] : [...m.historySteps] // UG3.1: new ref -> panel re-renders
    undoCursor.value = m?.historyCursor ?? 0
    refreshPersistedIds(computePersistedJournal()) // UG4.1b: keep the doomed marking fresh
    // VL4.2: the hook that used to write the whole v3 journal now diffs the history against the
    // synced position map and queues the increment. The persistJournal=false paths (rebuild,
    // adoption) set the map themselves — a diff there would mis-parent the chain.
    if (persistJournal && m !== null) syncUndoLog(m, prevSteps)
  }

  // UG4.1 (req 5) + VL-D6: the bounds come from the settings dialog; the default is «хранить
  // всегда». Since VL4.2 the same numbers are forwarded to the SERVER as the undo-log GC policy
  // (the log is unbounded otherwise), while
  // computePersistedJournal below keeps approximating what that GC would trim, so the panel's
  // doomed-row marking retains its meaning. «Очищать при закрытии проекта» = the log is wiped
  // on restore and never appended to: history lives only in memory for the session.
  const { settings: undoJournalSettings } = useUndoJournalSettings()
  const EMPTY_JOURNAL: GTrackUndoJournal = { version: 3, currentSig: '', cursor: 0, steps: [] }

  /** What the CURRENT settings would let survive on disk — the single source of truth shared by the
   *  actual write and the panel's doomed-row marking (UG4.1b, req 13). */
  function computePersistedJournal(): GTrackUndoJournal | null {
    const m = model.value
    if (m === null) return null
    const s = undoJournalSettings.value
    if (s.clearOnClose) return EMPTY_JOURNAL
    return trimUndoJournal(m.exportUndoJournal(s.maxSteps > 0 ? s.maxSteps : Number.MAX_SAFE_INTEGER), {
      maxAgeMs: s.maxAgeDays > 0 ? s.maxAgeDays * 24 * 60 * 60 * 1000 : undefined,
      maxBytes: s.maxSizeKb > 0 ? s.maxSizeKb * 1024 : undefined,
      nowMs: Date.now(),
    })
  }

  // UG4.1b (req 13): ids of the steps that WILL survive closing the file under the current
  // settings. The panel marks everything else as doomed (amber stripe + divider).
  const persistedUndoStepIds = shallowRef<ReadonlySet<string>>(new Set())
  function refreshPersistedIds(journal: GTrackUndoJournal | null): void {
    persistedUndoStepIds.value = new Set((journal?.steps ?? []).map((st) => st.id))
  }

  // --- undo-log sync (undo-versioned-log VL4.2) -----------------------------------------------
  // The append-only commit log replaces the whole-journal v3 write. undoLogPositions maps
  // history POSITIONS (0..steps.length) to the topmost server-chain cid of that state: a delta
  // advances a position, a snapshot/meta re-labels the current one. The map is what gives every
  // new delta its parent and every cursor its head ref.
  /** The reactive ref unwraps the class structurally (private members drop out of the proxy
   *  type) — the sync engine is typed against the public surface it actually touches. */
  type UndoLogModelView = Pick<
    GTrackModel,
    'historyCursor' | 'historySteps' | 'currentSignature' | 'savedSignature' | 'schedule' | 'adoptUndoJournal'
  >

  let undoLogPositions: (string | null)[] = [null]
  let undoLogMainTip: string | null = null // server refs.main as of the last sync point
  let undoLogLastSentHead: string | null = null
  let undoLogDeltasSinceSnapshot = 0
  let undoLogReady = false // adoption/migration finished for the current file
  let lastBuiltScheduleData: GnauralScheduleData | null = null
  const UNDO_LOG_SNAPSHOT_EVERY = 50 // VL-D5: an anchor snapshot every K deltas without a save

  function undoLogGcPolicy(): ProjectUndoLogGcPolicy | undefined {
    const s = undoJournalSettings.value
    const policy: { maxCommits?: number; maxAgeMs?: number; maxBytes?: number } = {}
    if (s.maxSteps > 0) policy.maxCommits = s.maxSteps
    if (s.maxAgeDays > 0) policy.maxAgeMs = s.maxAgeDays * 24 * 60 * 60 * 1000
    if (s.maxSizeKb > 0) policy.maxBytes = s.maxSizeKb * 1024
    return Object.keys(policy).length > 0 ? policy : undefined
  }

  function resetUndoLogSync(data: GnauralScheduleData | null): void {
    undoLogPositions = [null]
    undoLogMainTip = null
    undoLogLastSentHead = null
    undoLogDeltasSinceSnapshot = 0
    undoLogReady = false
    lastBuiltScheduleData = data
    deepUndoRows.value = []
    deepUndoHasMore.value = false
    deepUndoLoaded.value = false
    deepUndoNextFrom = null
    undoTags.value = {}
    undoBranches.value = []
    undoBranchesLoaded.value = false
    undoBranchRowsByTip.value = new Map()
  }

  /** Queue a snapshot commit of the given state at the model's CURRENT cursor position.
   *  flush: snapshots skip the debounce — they must not sit in a queue the keepalive unload
   *  flush would refuse to carry (VL4.1). */
  function queueUndoLogSnapshot(m: UndoLogModelView, sig: string, schedule: unknown): void {
    const key = filePath.value
    if (key === null || !undoLogReady || undoJournalSettings.value.clearOnClose) return
    const position = m.historyCursor
    const parent = undoLogPositions[position] ?? null
    if (parent === null && undoLogPositions.some((cid) => cid !== null && cid !== undefined)) {
      return // an unsynced hole below this position — cannot chain, skip the anchor
    }
    const cid = `s${Date.now().toString(36)}-${position}`
    const commit: ProjectUndoLogCommitInput = {
      cid,
      parent: parent ?? undoLogMainTip,
      type: 'snapshot',
      atMs: Date.now(),
      payload: { sig, schedule },
    }
    undoLogPositions[position] = cid
    undoLogDeltasSinceSnapshot = 0
    undoLogLastSentHead = cid

    if (position >= m.historySteps.length) {
      // Cursor at the line tip: the snapshot EXTENDS the line — main advances with it (queue).
      queueProjectUndoLogCommitsFor(key, [commit], { gc: undoLogGcPolicy(), flush: true })
      queueProjectUndoLogRefsFor(key, { head: cid })
      return
    }

    // VL5.2 round 2 (owner: «записи журнала должны жить, пока я не почищу их сам»): a save at a
    // MID-history position must NOT hijack main off the line tip — otherwise the redo tail above
    // the cursor becomes an unreachable orphan after a restart. The snapshot hangs off its
    // position as a SIDE commit (advanceMain: false), the head ref marks it, and adoption finds
    // it through the head chain. Pending deltas are drained first so the parent exists.
    void (async () => {
      await flushProjectUndoLogFor(key)
      const result = await appendProjectUndoLogNowFor(key, [commit], { advanceMain: false })
      if (result === null || result.rejectedFrom !== null) {
        console.warn('[undo-log] mid-history save snapshot append failed — adoption after restart may miss the redo tail')
        return
      }
      queueProjectUndoLogRefsFor(key, { head: cid })
    })()
  }

  /** The refreshEditState hook: diff the history against the synced position map, queue the new
   *  deltas (their cids ARE the step ids — server-side idempotency absorbs any re-send), keep
   *  the head ref on the cursor, and drop an anchor snapshot every K deltas (VL-D5). A truncated
   *  redo tail just shortens the map — its commits stay in the log as an orphan branch (VL-D2). */
  function syncUndoLog(m: UndoLogModelView, prevSteps: readonly GTrackUndoStep[]): void {
    const key = filePath.value
    if (key === null || !undoLogReady || undoJournalSettings.value.clearOnClose) return

    const steps = m.historySteps
    let prefix = 0
    while (prefix < prevSteps.length && prefix < steps.length && prevSteps[prefix]!.id === steps[prefix]!.id) prefix += 1
    undoLogPositions.length = Math.min(undoLogPositions.length, prefix + 1)

    const batch: ProjectUndoLogCommitInput[] = []
    if (steps.length > prefix) {
      if (undoLogPositions[prefix] === null || undoLogPositions[prefix] === undefined) {
        const allEmpty = undoLogPositions.every((cid) => cid === null || cid === undefined)
        if (!allEmpty || prefix !== 0) {
          console.warn('[undo-diag] undo-log sync skipped: unsynced position below the new step (graft boundary)')
          return
        }
        // Baseline (VL-D5): the first delta of an empty/foreign log chains onto a snapshot of
        // the LOADED file state, which itself chains onto the server main tip (or roots).
        const baseCid = `s${Date.now().toString(36)}-base`
        batch.push({
          cid: baseCid,
          parent: undoLogMainTip,
          type: 'snapshot',
          atMs: Date.now(),
          payload: { sig: m.savedSignature, schedule: lastBuiltScheduleData },
        })
        undoLogPositions[0] = baseCid
      }
      for (let i = prefix; i < steps.length; i += 1) {
        const step = steps[i]!
        batch.push(stepToCommitInput(step, undoLogPositions[i]!))
        undoLogPositions[i + 1] = step.id
      }
      undoLogDeltasSinceSnapshot += steps.length - prefix
    }
    if (batch.length > 0) queueProjectUndoLogCommitsFor(key, batch, { gc: undoLogGcPolicy() })

    if (undoLogDeltasSinceSnapshot >= UNDO_LOG_SNAPSHOT_EVERY) {
      queueUndoLogSnapshot(m, m.currentSignature, m.schedule)
    }

    const head = undoLogPositions[m.historyCursor] ?? null
    if (head !== null && head !== undoLogLastSentHead) {
      undoLogLastSentHead = head
      queueProjectUndoLogRefsFor(key, { head })
    }
  }

  // --- deep history + checkout + tags (VL5.1) -------------------------------------------------
  // The panel's in-memory window covers the adopted steps; everything OLDER lives only in the
  // log. Deep rows page down the parent chain from position 0; «Применить» on one reconstructs
  // that state (snapshot anchor + redo of the deltas above it) and applies it as ONE normal
  // 'checkout' edit — the rollback itself lands in the history and is undoable.
  const deepUndoRows = shallowRef<readonly GTrackDeepUndoRow[]>([])
  const deepUndoHasMore = ref(false)
  const deepUndoLoaded = ref(false)
  const deepUndoLoading = ref(false)
  let deepUndoNextFrom: string | null = null
  const undoTags = shallowRef<Readonly<Record<string, string>>>({})
  const DEEP_UNDO_PAGE = 50

  function deepRowOfCommit(commit: ProjectUndoLogCommit): GTrackDeepUndoRow {
    if (commit.type === 'delta') {
      const step = commitToStep(commit)
      if (step !== null) {
        return { cid: commit.cid, type: 'delta', kind: step.kind, label: step.label, atMs: commit.atMs, step }
      }
    }
    return {
      cid: commit.cid,
      type: commit.type === 'snapshot' ? 'snapshot' : 'meta',
      kind: commit.type,
      label: '',
      atMs: commit.atMs,
      step: null,
    }
  }

  // undo-orphan-branches (OB-D1/OB-D5): the abandoned branches — flat tip summaries plus lazily
  // fetched per-branch chains (the ordinary chain GET from=tip&limit=commits, OB-D5). Selection
  // and «Применить» reuse the deep-row checkout path unchanged (OB-D2).
  const undoBranches = shallowRef<readonly ProjectUndoLogBranch[]>([])
  const undoBranchesLoaded = ref(false)
  const undoBranchesLoading = ref(false)
  const undoBranchRowsByTip = shallowRef<ReadonlyMap<string, readonly GTrackDeepUndoRow[]>>(new Map())

  async function loadUndoBranches(): Promise<void> {
    const key = filePath.value
    if (key === null || !undoLogReady || undoBranchesLoading.value) return
    undoBranchesLoading.value = true
    try {
      const branches = await readProjectUndoLogBranchesFor(key)
      if (key !== filePath.value) return
      undoBranches.value = branches ?? []
      undoBranchesLoaded.value = true
      undoBranchRowsByTip.value = new Map()
    } finally {
      undoBranchesLoading.value = false
    }
  }

  async function loadUndoBranchSteps(tip: string): Promise<void> {
    const key = filePath.value
    const branch = undoBranches.value.find((aBranch) => aBranch.tip === tip)
    if (key === null || branch === undefined || undoBranchRowsByTip.value.has(tip)) return
    const chain = await readProjectUndoLogChainFor(key, { from: tip, limit: branch.commits })
    if (chain === null || key !== filePath.value) return
    const next = new Map(undoBranchRowsByTip.value)
    next.set(tip, chain.commits.map(deepRowOfCommit))
    undoBranchRowsByTip.value = next
  }

  /** OB-D3: delete the tip's exclusive suffix; 'tagged' surfaces the 409-protection distinctly. */
  async function deleteUndoBranch(tip: string): Promise<'ok' | 'tagged' | 'failed'> {
    const key = filePath.value
    if (key === null) return 'failed'
    const result = await deleteProjectUndoLogBranchFor(key, tip)
    if (result === null) return 'failed'
    if ('error' in result) return result.error.includes('tagged') ? 'tagged' : 'failed'
    undoBranchesLoaded.value = false
    await loadUndoBranches()
    return 'ok'
  }

  /** Fetch the next page of pre-window history (newest-first pages appended at the end). */
  async function loadDeepUndoHistory(): Promise<void> {
    const key = filePath.value
    if (key === null || !undoLogReady || deepUndoLoading.value) return
    const firstLoad = !deepUndoLoaded.value
    const from = firstLoad ? undoLogPositions[0] : deepUndoNextFrom
    if (from === null || from === undefined) {
      deepUndoLoaded.value = true
      deepUndoHasMore.value = false
      return
    }
    deepUndoLoading.value = true
    try {
      const chain = await readProjectUndoLogChainFor(key, { from, limit: DEEP_UNDO_PAGE + 1 })
      if (chain === null || key !== filePath.value) return
      // The first page starts AT position 0's own commit — drop it, the «initial» row covers it.
      const commits = firstLoad ? chain.commits.slice(1) : chain.commits
      const last = commits[commits.length - 1] ?? (firstLoad ? chain.commits[0] : undefined)
      deepUndoNextFrom = last === undefined ? null : last.parent
      deepUndoRows.value = [...deepUndoRows.value, ...commits.map(deepRowOfCommit)]
      deepUndoHasMore.value = deepUndoNextFrom !== null
      deepUndoLoaded.value = true
    } finally {
      deepUndoLoading.value = false
    }
  }

  /** Reconstruct the state of `cid` (snapshot anchor + redo) and apply it as a checkout edit. */
  async function checkoutUndoCommit(cid: string): Promise<'ok' | 'no-snapshot' | 'mismatch' | 'failed'> {
    const key = filePath.value
    const live = model.value
    if (key === null || live === null || !undoLogReady || live.inTransaction) return 'failed'

    const chain = await readProjectUndoLogChainFor(key, { from: cid, untilType: 'snapshot', limit: 300 })
    if (chain === null || key !== filePath.value || live !== model.value) return 'failed'
    const anchor = chain.commits[chain.commits.length - 1]
    const anchorSig = anchor === undefined ? null : snapshotSig(anchor)
    if (anchor === undefined || anchorSig === null) return 'no-snapshot'

    let temp: GTrackModel
    try {
      const payload = anchor.payload as { schedule?: unknown }
      temp = new GTrackModel(payload.schedule as GnauralScheduleData, [], createGTrackHistory())
    } catch {
      return 'failed'
    }
    if (temp.currentSignature !== anchorSig) return 'failed' // foreign snapshot payload

    const deltas = [...chain.commits].reverse().filter((c) => c.type === 'delta')
    const steps: GTrackUndoStep[] = []
    for (const c of deltas) {
      const step = commitToStep(c)
      if (step === null) return 'failed'
      steps.push(step)
    }
    if (steps.length > 0) {
      if (!temp.adoptUndoJournal({ version: 3, currentSig: temp.currentSignature, cursor: 0, steps })) return 'failed'
      while (temp.canRedo) {
        if (!temp.redo()) return 'failed'
      }
    }

    // Voice-composition gate (UC-D6: voices are never added/removed by edits) + preparse locks.
    const targetVoices = new Map(temp.schedule.voices.map((v) => [v.id, v]))
    if (live.schedule.voices.length !== targetVoices.size) return 'mismatch'
    const changed: Array<{ id: number; points: GTrackPoint[] }> = []
    for (const liveVoice of live.schedule.voices) {
      const targetVoice = targetVoices.get(liveVoice.id)
      if (targetVoice === undefined) return 'mismatch'
      if (JSON.stringify(liveVoice.points) !== JSON.stringify(targetVoice.points)) {
        if (!live.isVoiceEditable(liveVoice.id)) return 'mismatch'
        changed.push({ id: liveVoice.id, points: [...targetVoice.points] })
      }
    }
    if (changed.length === 0) return 'ok'

    live.edit(() => {
      for (const c of changed) live.replaceVoicePoints(c.id, c.points)
    }, 'checkout')
    syncSchedule()
    refreshEditState() // the normal diff queues the checkout delta into the log
    return 'ok'
  }

  /** VL-D9: tags are named refs; a tagged commit (and its chain) survives GC. */
  function setUndoTag(name: string, cid: string): void {
    const key = filePath.value
    const trimmed = name.trim()
    if (key === null || trimmed === '' || trimmed.length > 64) return
    undoTags.value = { ...undoTags.value, [trimmed]: cid }
    queueProjectUndoLogRefsFor(key, { tags: { [trimmed]: cid } })
  }

  function deleteUndoTag(name: string): void {
    const key = filePath.value
    if (key === null) return
    const next: Record<string, string> = { ...undoTags.value }
    delete next[name]
    undoTags.value = next
    queueProjectUndoLogRefsFor(key, { tags: { [name]: null } })
  }

  /** The server-chain cid of a history position (0 = initial); null while unsynced. */
  function undoLogCidAt(position: number): string | null {
    return undoLogPositions[position] ?? null
  }

  // A cut batch (409) means the chain diverged under us (another tab): drop the queue and
  // re-anchor on the server main tip — the next baseline/save snapshot re-roots cleanly.
  setUndoLogAppendResultHandler((_projectId, result) => {
    if (result.rejectedFrom === null) return
    console.warn(`[undo-log] append rejected at ${result.rejectedFrom} (chain diverged?) — pending discarded, main tip re-synced`)
    const key = filePath.value
    if (key !== null) discardPendingUndoLogFor(key)
    undoLogMainTip = result.refs.main
  })

  // UG4.1b + VL-D6: a settings change refreshes the doomed marking immediately and hands the
  // new GC policy to the server (an empty append runs GC only when the policy is violated);
  // clearOnClose ON wipes the server log, OFF re-roots on the next edit.
  watch(undoJournalSettings, (next, prev) => {
    refreshPersistedIds(computePersistedJournal())
    const key = filePath.value
    if (key === null) return
    if (next.clearOnClose && prev !== undefined && !prev.clearOnClose) {
      discardPendingUndoLogFor(key)
      void clearProjectUndoLogFor(key)
      undoLogPositions = [null]
      undoLogMainTip = null
      undoLogLastSentHead = null
    } else if (!next.clearOnClose && undoLogReady) {
      queueProjectUndoLogCommitsFor(key, [], { gc: undoLogGcPolicy(), flush: true })
    }
  })

  // GT3.7 (GT-D9): ids of generator ("preparse") voices, recovered from the SOURCE XML (the dump
  // does not flag provenance). Fed into the model so those voices are edit-locked and rendered
  // distinctly, until the user explicitly fixes them.
  const preparseVoiceIds = ref<number[]>([])

  // UG2.1 (undo-global-journal, UG-D1): the undo history container SURVIVES model rebuilds — one
  // container per file, passed into every model built for it; a genuine content change resets it.
  // postSaveReloadPath marks the reload that follows OUR OWN save: the dump differs from the edited
  // state only by float formatting, so the history is carried over and the dump becomes the base.
  let history = createGTrackHistory()
  let modelPath: string | null = null
  let postSaveReloadPath: string | null = null

  function buildModel(data: GnauralScheduleData | null): void {
    const path = filePath.value
    const prev = model.value
    const samePath = prev !== null && path !== null && path === modelPath
    modelPath = path
    const postSave = samePath && postSaveReloadPath !== null && postSaveReloadPath === path
    postSaveReloadPath = null

    if (data !== null && prev !== null && samePath) {
      const newSig = scheduleContentSignature(data, preparseVoiceIds.value)
      // UG2.1 content guard: the store re-emits the schedule with UNCHANGED file content on every
      // load/play (ws schedule-changed -> forced reload) — the owner-confirmed history killer
      // (UG1.1). Content equal to the model's saved base means there is nothing to rebuild: keep
      // the model, its unsaved edits and its history.
      if (newSig === prev.savedSignature) {
        console.info('[undo-diag] buildModel: skip — content equals the model base (edits+history kept)')
        return
      }
      // The file caught up with the edited state byte-exactly (save round-trip without float
      // drift): just move the saved baseline.
      if (newSig === prev.currentSignature) {
        prev.markSaved()
        refreshEditState()
        // VL4.2 (VL-D5): a save is the natural anchor — snapshot the saved state (eagerly).
        lastBuiltScheduleData = data
        queueUndoLogSnapshot(prev, prev.savedSignature, data)
        console.info('[undo-diag] buildModel: skip — content equals the edited state; markSaved')
        return
      }
      // Our own save round-trip WITH float drift (the dump reformats numbers): rebuild on the dump
      // but KEEP the history (UG-D4: the in-memory carry-over needs no signature gate — same file,
      // same session; steps swap whole voices, so they stay applicable). refreshEditState() then
      // re-persists the journal signed against the dump, so it survives a session restart too.
      if (postSave) {
        model.value = new GTrackModel(data, preparseVoiceIds.value, history)
        selection.value = null
        syncSchedule()
        refreshEditState()
        // VL4.2 (VL-D5): the dump IS the saved state — snapshot it as the new anchor (eagerly).
        lastBuiltScheduleData = data
        queueUndoLogSnapshot(model.value, model.value.savedSignature, data)
        console.info('[undo-diag] buildModel: post-save rebase — history carried over, dump is the new base')
        return
      }
    }

    // Genuine content change (file switch / external edit / preparse or voiceState overlay):
    // full rebuild. UG1.1: log what is lost; the disk journal may still be re-adopted below.
    if (prev !== null) {
      console.info(
        `[undo-diag] buildModel: model rebuilt (prev: canUndo=${prev.canUndo} canRedo=${prev.canRedo} dirty=${prev.isDirty})`
        + ' — in-memory undo history dropped, journal re-adoption pending',
      )
    }
    history = createGTrackHistory()
    resetUndoLogSync(data) // VL4.2: a fresh file = a fresh position map; restoreFromProject re-arms it
    model.value = data === null ? null : new GTrackModel(data, preparseVoiceIds.value, history)
    selection.value = null
    syncSchedule()
    refreshEditState(false) // reset dirty/undo/redo to the freshly-loaded (saved) baseline
    restoreSpectrum() // GT8.1: per-lane spectrum overrides are per file
    restoreMix() // owner 2026-07-13: per-voice overall-mix exclusions are per file
    const reqId = ++projectRestoreReqId
    if (model.value === null) {
      lanes.value = []
      return
    }
    restoreOrDefault()
    // PR2.1: localStorage above gives the instant first paint; the project section then wins.
    void restoreFromProject(reqId)
  }

  // Rebuild the model + lane config whenever the schedule (file) changes.
  watch(schedule, (data) => buildModel(data), { immediate: true })

  // GT3.7: fetch the raw .gnaural when the file changes, mark its generator voices, and rebuild the
  // model so they lock. Guarded by a request id (fast file switches) and skipped for non-gnaural
  // paths (the editor endpoint only serves .gnaural).
  let preparseReqId = 0
  watch(
    filePath,
    (path) => {
      preparseVoiceIds.value = []
      if (path === null || !path.toLowerCase().endsWith('.gnaural')) return
      const reqId = ++preparseReqId
      void audioApi
        .fetchEditorDocument(path)
        .then((doc) => {
          if (reqId !== preparseReqId) return // superseded by a newer file selection
          preparseVoiceIds.value = [...findPreparseVoiceIds(doc.content)]
          // Rebuild only when the ids arrived AFTER the schedule and no edit is in progress.
          if (schedule.value !== null && !dirty.value) buildModel(schedule.value)
        })
        .catch(() => {
          /* fetch failed (e.g. non-gnaural) -> treat as no generator voices */
        })
    },
    { immediate: true },
  )

  // --- operations ---
  function addLane(): number {
    // GT10.14 (owner req. 63): "+ lane" adds an EMPTY lane; voices are added via its gear.
    // GT10.28 (owner req. 77): return the new id so the caller can scroll to + highlight it.
    const id = nextLaneId++
    lanes.value = [
      ...lanes.value,
      { id, voiceIds: [], modes: [defaultLaneConfig().mode], hidden: false },
    ]
    persist()
    return id
  }
  // GT10.44 (owner 2026-07-13): fully REMOVE the lane (not hide it) and return a snapshot so the
  // caller can offer an Undo that restores it at the same position.
  function removeLane(id: number): { lane: GTrackLane; index: number } | null {
    const index = lanes.value.findIndex((l) => l.id === id)
    if (index < 0) return null
    const lane = lanes.value[index]!
    lanes.value = lanes.value.filter((l) => l.id !== id)
    persist()
    return { lane, index }
  }
  /** GT10.44: restore a removed lane at its previous index (Undo of removeLane). */
  function restoreLane(lane: GTrackLane, index: number): void {
    if (lanes.value.some((l) => l.id === lane.id)) return // already back
    const next = lanes.value.slice()
    next.splice(Math.min(Math.max(index, 0), next.length), 0, lane)
    lanes.value = next
    nextLaneId = Math.max(nextLaneId, lane.id + 1)
    persist()
  }
  function setLaneMode(id: number, mode: GTrackMode): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, modes: [mode] } : l))
    persist()
  }
  // VS4.1 (owner phase 4): check/uncheck one display mode. Unchecking the LAST mode is allowed —
  // such a lane leaves the visible stack (VS-D5; setLaneHidden(false) re-seeds a default mode).
  function toggleLaneMode(id: number, mode: GTrackMode, on: boolean): void {
    lanes.value = lanes.value.map((l) => {
      if (l.id !== id) return l
      const set = new Set(l.modes)
      if (on) set.add(mode)
      else set.delete(mode)
      return { ...l, modes: GTRACK_MODES.filter((m) => set.has(m)) }
    })
    persist()
  }
  // GT4.3 (GT-D17): the lane's solo audio (off / wave / spectrum / both of its voice set).
  function setLaneSolo(id: number, soloMode: GTrackSoloMode): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloMode } : l))
    persist()
  }
  // GT4.2 (GT-D17): where the solo audio shows — inline under the curves vs a sub-lane below.
  function setLaneSoloInline(id: number, soloInline: boolean): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloInline } : l))
    persist()
  }
  // owner 2026-07-14: toggle the beat-band shading on a Base-freq lane (per-lane, persisted).
  function setLaneBeatBand(id: number, beatBand: boolean): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, beatBand } : l))
    persist()
  }
  // VB-D1 (owner 2026-07-17): toggle the balance-corridor shading on a Volume lane (per-lane, persisted).
  function setLaneBalanceBand(id: number, balanceBand: boolean): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, balanceBand } : l))
    persist()
  }
  // GT11.5 (owner 2026-07-14): fold/unfold a track (its curve + solo sub-lanes) from the header bar.
  function toggleLaneFolded(id: number): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, folded: !(l.folded ?? false) } : l))
    persist()
  }
  // GT11.8 (owner 2026-07-14): hide/show a lane's solo wave/spectrum SUB-graph (persisted per file).
  function setLaneSoloGraphHidden(id: number, which: 'wave' | 'spectrum', hidden: boolean): void {
    const key = which === 'wave' ? 'soloWaveHidden' : 'soloSpectrumHidden'
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, [key]: hidden } : l))
    persist()
  }
  // GT11.7 (owner 2026-07-14): resize a single gtrack graph (curve / solo wave / solo spectrum),
  // clamped, persisted per file.
  function setLaneGraphHeight(id: number, which: 'curve' | 'wave' | 'spectrum', h: number, mode?: GTrackMode): void {
    // VS4.1: a curve resize targets ONE mode graph of the stack when `mode` is given.
    if (which === 'curve' && mode !== undefined) {
      lanes.value = lanes.value.map((l) =>
        l.id === id ? { ...l, modeHeights: { ...(l.modeHeights ?? {}), [mode]: clampHeight(h) } } : l,
      )
      persist()
      return
    }
    const key = which === 'curve' ? 'curveHeight' : which === 'wave' ? 'soloWaveHeight' : 'soloSpectrumHeight'
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, [key]: clampHeight(h) } : l))
    persist()
  }
  // GT11.7 refinement (owner 2026-07-14): Ctrl-resize — set the SAME height on EVERY graph (curve +
  // solo wave/spectrum) of every lane that shares a voice with `id`, so a voice's graphs resize as one.
  function setVoiceGraphsHeight(id: number, h: number): void {
    const src = lanes.value.find((l) => l.id === id)
    if (src === undefined) return
    const voiceSet = new Set(src.voiceIds)
    const clamped = clampHeight(h)
    lanes.value = lanes.value.map((l) =>
      l.voiceIds.some((v) => voiceSet.has(v))
        // VS4.1: clearing modeHeights makes every mode graph follow the uniform curveHeight.
        ? { ...l, curveHeight: clamped, soloWaveHeight: clamped, soloSpectrumHeight: clamped, modeHeights: undefined }
        : l,
    )
    persist()
  }
  // GT11.7 (owner 2026-07-14): Shift-resize — set EVERY gtrack graph (all lanes' curve + solo
  // wave/spectrum) to one height. The overall wave/spectrum are handled by the panel.
  function setAllLanesGraphsHeight(h: number): void {
    const clamped = clampHeight(h)
    lanes.value = lanes.value.map((l) => ({ ...l, curveHeight: clamped, soloWaveHeight: clamped, soloSpectrumHeight: clamped, modeHeights: undefined }))
    persist()
  }
  // GT10.4 (owner req. 48): solo-wave colour + opacity.
  function setLaneSoloWaveStyle(id: number, color: string, opacity: number): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloWaveColor: color, soloWaveOpacity: opacity } : l))
    persist()
  }
  // VS2.5 (VS-D4 rev 2): lin/dB for the lane's solo wave (edited from the shared waveform dialog).
  function setLaneSoloWaveScale(id: number, scale: 'linear' | 'db'): void {
    lanes.value = lanes.value.map((l) => (l.id === id ? { ...l, soloWaveScale: scale } : l))
    persist()
  }
  function toggleLaneVoice(id: number, voiceId: number): void {
    lanes.value = lanes.value.map((l) => {
      if (l.id !== id) return l
      const has = l.voiceIds.includes(voiceId)
      return { ...l, voiceIds: has ? l.voiceIds.filter((v) => v !== voiceId) : [...l.voiceIds, voiceId] }
    })
    persist()
  }
  function setLaneHidden(id: number, hidden: boolean): void {
    lanes.value = lanes.value.map((l) => {
      if (l.id !== id) return l
      // VS4.1 (VS-D5): un-hiding a lane whose modes were all unchecked re-seeds its default mode —
      // otherwise "show" would produce a lane that still renders nothing.
      const modes = !hidden && l.modes.length === 0
        ? [l.voiceIds.length > 0 ? defaultModeForVoice(l.voiceIds[0]!) : defaultLaneConfig().mode]
        : l.modes
      return { ...l, hidden, modes }
    })
    persist()
  }
  /** Reorder: move lane `dragId` to the position of `targetId` (swap-through as the pointer moves). */
  function swapLanes(dragId: number, targetId: number): void {
    const arr = lanes.value.slice()
    const i = arr.findIndex((l) => l.id === dragId)
    const j = arr.findIndex((l) => l.id === targetId)
    if (i < 0 || j < 0 || i === j) return
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
    lanes.value = arr
    persist()
  }

  // --- GT3.1: point-edit mode + vertex selection (ephemeral; not persisted) ---
  // GT10.5 (owner req. 49): point mode is GLOBAL — the toggle enables it on EVERY lane at once
  // (pointModeLanes now holds a single sentinel; the per-lane API shape is kept for the callers).
  function isLanePointMode(id: number): boolean {
    void id
    return pointModeLanes.value.size > 0
  }
  function toggleLanePointMode(id: number): void {
    void id
    if (pointModeLanes.value.size > 0) {
      pointModeLanes.value = new Set()
      selection.value = null // drop the selection when leaving point mode
    } else {
      pointModeLanes.value = new Set([-1])
    }
  }
  /** The selected vertex within a given lane, or null (for passing to that lane's GTrackView). */
  function selectionForLane(id: number): GTrackPointRef | null {
    const sel = selection.value
    return sel !== null && sel.laneId === id ? { voiceId: sel.voiceId, pointIndex: sel.pointIndex } : null
  }
  function selectPoint(laneId: number, point: GTrackPointRef | null): void {
    selection.value = point === null ? null : { laneId, voiceId: point.voiceId, pointIndex: point.pointIndex }
  }
  function clearSelection(): void {
    selection.value = null
  }

  // --- GT3.15 (owner req. 30): Ctrl/Shift-accumulated multi-selection (ephemeral, not persisted).
  // Keyed "voiceId:pointIndex" so it can span multiple voices/lanes. Scope decision: multi-select
  // drives the inspector's TABLE mode (view/edit VALUE fields + bulk delete); it does not support
  // group-dragging (each drag still moves exactly the one vertex under the pointer) and the table
  // does not edit time (time edits use crossover reindexing, which would desync these keys — the
  // single-point inspector still edits time for one point at a time).
  const multiSelection = ref<Set<string>>(new Set())
  function multiSelectionKey(voiceId: number, pointIndex: number): string {
    return `${voiceId}:${pointIndex}`
  }
  function isMultiSelected(voiceId: number, pointIndex: number): boolean {
    return multiSelection.value.has(multiSelectionKey(voiceId, pointIndex))
  }
  function toggleMultiSelect(voiceId: number, pointIndex: number): void {
    const key = multiSelectionKey(voiceId, pointIndex)
    const next = new Set(multiSelection.value)
    // GT10.42 (owner 2026-07-12): seed the current single selection so the FIRST Ctrl/Shift-click
    // already makes two selected points (opening the table), instead of needing a third click.
    const sel = selection.value
    if (next.size === 0 && sel !== null) {
      const selKey = multiSelectionKey(sel.voiceId, sel.pointIndex)
      if (selKey !== key) next.add(selKey)
    }
    if (next.has(key)) next.delete(key)
    else next.add(key)
    multiSelection.value = next
  }
  function clearMultiSelection(): void {
    multiSelection.value = new Set()
  }
  /** The multi-selection resolved to live point data (drops entries whose point no longer exists). */
  const multiSelectionPoints = computed(() => {
    const out: Array<{ voiceId: number; pointIndex: number; point: GTrackPoint }> = []
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const voiceId = Number(voiceIdStr)
      const pointIndex = Number(pointIndexStr)
      const p = voiceById(voiceId)?.points[pointIndex]
      if (p !== undefined) out.push({ voiceId, pointIndex, point: p })
    }
    return out
  })
  /**
   * GT3.15: set only the VALUE fields of a point (base/beat/volL/volR) — never time — so a table
   * row edit can never trigger crossover reindexing (which would desync the multi-selection's
   * "voiceId:pointIndex" keys against the other selected rows).
   */
  function setPointValues(
    ref_: GTrackPointRef,
    patch: { baseFreq: number; beatFreqHalf: number; volL: number; volR: number },
  ): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => m.setPointFields(ref_.voiceId, ref_.pointIndex, patch), 'point-edit')
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /**
   * GT3.16: apply value-field edits to SEVERAL points as ONE undo unit (table "Apply all").
   * Value-only (never time), so — like setPointValues — indices stay stable and the
   * multi-selection keys don't desync. Non-editable voices are skipped silently.
   */
  function setMultiplePointValues(
    edits: ReadonlyArray<{ ref: GTrackPointRef; patch: { baseFreq: number; beatFreqHalf: number; volL: number; volR: number } }>,
  ): boolean {
    const m = model.value
    if (m === null || edits.length === 0) return false
    try {
      m.edit(() => {
        for (const { ref: ref_, patch } of edits) {
          if (!m.isVoiceEditable(ref_.voiceId)) continue
          m.setPointFields(ref_.voiceId, ref_.pointIndex, patch)
        }
      }, 'point-edit')
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT10.9 (owner req. 54): bulk-delete the GIVEN refs as ONE undo unit (table checkboxes). */
  function removePointsBulk(refs: readonly GTrackPointRef[]): void {
    const m = model.value
    if (m === null || refs.length === 0) return
    const byVoice = new Map<number, number[]>()
    for (const r of refs) {
      const arr = byVoice.get(r.voiceId) ?? []
      arr.push(r.pointIndex)
      byVoice.set(r.voiceId, arr)
    }
    m.edit(() => {
      for (const [voiceId, indices] of byVoice) {
        if (!m.isVoiceEditable(voiceId)) continue
        for (const idx of [...indices].sort((a, b) => b - a)) {
          const voice = m.schedule.voices.find((v) => v.id === voiceId)
          if (voice === undefined || voice.points.length <= 2) break
          try { m.removePoint(voiceId, idx) } catch { /* gone - skip */ }
        }
      }
    }, 'point-remove')
    clearMultiSelection()
    syncSchedule()
    refreshEditState()
  }

  /** GT3.15: bulk-delete every point in the multi-selection as ONE undo unit. */
  function removeMultiSelection(): void {
    const m = model.value
    if (m === null || multiSelection.value.size === 0) return
    const byVoice = new Map<number, number[]>()
    for (const { voiceId, pointIndex } of multiSelectionPoints.value) {
      const arr = byVoice.get(voiceId) ?? []
      arr.push(pointIndex)
      byVoice.set(voiceId, arr)
    }
    m.edit(() => {
      for (const [voiceId, indices] of byVoice) {
        if (!m.isVoiceEditable(voiceId)) continue
        for (const idx of [...indices].sort((a, b) => b - a)) { // highest index first (no reshift)
          const voice = m.schedule.voices.find((v) => v.id === voiceId)
          if (voice === undefined || voice.points.length <= 2) break // model's min-2-points floor
          try { m.removePoint(voiceId, idx) } catch { /* already gone / race — skip */ }
        }
      }
    }, 'point-remove')
    clearMultiSelection()
    syncSchedule()
    refreshEditState()
  }
  /**
   * GT3.15: keep the multi-selection's "voiceId:pointIndex" keys valid across array-shifting edits
   * elsewhere in the SAME voice — a single-point remove/insert shifts every later index by one.
   * (removeMultiSelection's own bulk removals don't need this: they clear the whole set after.)
   */
  function reindexMultiSelectionAfterRemoval(voiceId: number, removedIndex: number): void {
    if (multiSelection.value.size === 0) return
    const next = new Set<string>()
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const vId = Number(voiceIdStr)
      const pIdx = Number(pointIndexStr)
      if (vId !== voiceId || pIdx < removedIndex) { next.add(key); continue }
      if (pIdx === removedIndex) continue // that vertex is gone — drop it
      next.add(multiSelectionKey(vId, pIdx - 1))
    }
    multiSelection.value = next
  }
  function reindexMultiSelectionAfterInsert(voiceId: number, insertedIndex: number): void {
    if (multiSelection.value.size === 0) return
    const next = new Set<string>()
    for (const key of multiSelection.value) {
      const [voiceIdStr, pointIndexStr] = key.split(':')
      const vId = Number(voiceIdStr)
      const pIdx = Number(pointIndexStr)
      next.add(vId === voiceId && pIdx >= insertedIndex ? multiSelectionKey(vId, pIdx + 1) : key)
    }
    multiSelection.value = next
  }
  /**
   * GT3.15: a crossover re-sort (drag or the single-point dialog's time field) can move an
   * ARBITRARY range of points in the same voice — the model only reports the one explicitly-moved
   * point's new index, not how everything else shifted. Rather than risk a table row silently
   * pointing at the wrong vertex, drop that voice's multi-selection entries defensively.
   */
  function dropMultiSelectionForVoice(voiceId: number): void {
    if (multiSelection.value.size === 0) return
    const prefix = `${voiceId}:`
    if (![...multiSelection.value].some((k) => k.startsWith(prefix))) return
    const next = new Set([...multiSelection.value].filter((k) => !k.startsWith(prefix)))
    multiSelection.value = next
  }

  // --- GT3.9 (GT-D15): voice-panel operations. The slide-over panel drives voices; these map its
  // per-voice controls onto the lane model (visibility = hidden of all lanes containing the voice;
  // graph type = mode of all lanes containing the voice; no lane -> one is created).
  function lanesForVoice(voiceId: number): GTrackLane[] {
    return lanes.value.filter((l) => l.voiceIds.includes(voiceId))
  }
  function isVoiceVisible(voiceId: number): boolean {
    return lanesForVoice(voiceId).some((l) => !l.hidden)
  }
  /** The graph type shown for a voice (its first lane's mode), or null when it has no lane. */
  function voiceMode(voiceId: number): GTrackMode | null {
    // VS4.1: a multi-mode lane has no single representative mode -> null (the list shows "mixed").
    const l = lanesForVoice(voiceId)[0]
    if (l === undefined) return null
    return l.modes.length === 1 ? l.modes[0]! : null
  }
  function defaultModeForVoice(voiceId: number): GTrackMode {
    const v = voiceById(voiceId)
    return v !== undefined && isTonal(v) ? 'base' : 'volume'
  }
  function setVoiceVisible(voiceId: number, visible: boolean): void {
    const owned = lanesForVoice(voiceId)
    if (owned.length === 0) {
      if (visible) {
        lanes.value = [...lanes.value, { id: nextLaneId++, voiceIds: [voiceId], modes: [defaultModeForVoice(voiceId)], hidden: false }]
      }
    } else {
      lanes.value = lanes.value.map((l) => (l.voiceIds.includes(voiceId) ? { ...l, hidden: !visible } : l))
    }
    persist()
  }
  function setVoiceMode(voiceId: number, mode: GTrackMode): void {
    const owned = lanesForVoice(voiceId)
    if (owned.length === 0) {
      lanes.value = [...lanes.value, { id: nextLaneId++, voiceIds: [voiceId], modes: [mode], hidden: false }]
    } else {
      lanes.value = lanes.value.map((l) => (l.voiceIds.includes(voiceId) ? { ...l, modes: [mode] } : l))
    }
    persist()
  }
  // Bulk actions (owner req. 20).
  /** All voices merged into ONE lane (mode = the first visible lane's, else the default). */
  function mergeAllIntoOneLane(): void {
    const modes = lanes.value.find((l) => !l.hidden && l.modes.length > 0)?.modes ?? [defaultLaneConfig().mode]
    lanes.value = [{ id: nextLaneId++, voiceIds: voices.value.map((v) => v.id), modes: modes.slice(), hidden: false }]
    persist()
  }
  /** One lane per voice — EVERY voice (the explicit "spread everything", incl. audiofile/noise). */
  function spreadPerVoiceLanes(): void {
    lanes.value = voices.value.map(laneForVoice)
    persist()
  }
  /**
   * GT3.18 (owner req. 38): show EVERY graph type for EVERY voice — one lane per (voice × mode).
   * Lanes are grouped by voice (all of a voice's modes are contiguous) so the per-voice accent
   * stripe/title (GT-D20) reads as a block.
   */
  function showAllModesPerVoice(): void {
    const next: GTrackLane[] = []
    for (const v of voices.value) {
      for (const mode of GTRACK_MODES) {
        next.push({ id: nextLaneId++, voiceIds: [v.id], modes: [mode], hidden: false })
      }
    }
    lanes.value = next
    persist()
  }
  /**
   * VS4.1 (owner, VS-D5г): the NEW track-list layout — ONE lane per voice with EVERY display mode
   * checked (a per-mode graph stack inside the lane), unlike showAllModesPerVoice's lane-per-mode.
   */
  function allModesOneLanePerVoice(): void {
    lanes.value = voices.value.map((v) => ({ id: nextLaneId++, voiceIds: [v.id], modes: [...GTRACK_MODES], hidden: false }))
    persist()
  }
  /** Show every voice in the given graph type (applies to all lanes). */
  function setAllLanesMode(mode: GTrackMode): void {
    lanes.value = lanes.value.map((l) => ({ ...l, modes: [mode] }))
    persist()
  }
  function setAllLanesHidden(hidden: boolean): void {
    lanes.value = lanes.value.map((l) => ({ ...l, hidden }))
    persist()
  }
  const allLanesHidden = computed(() => lanes.value.length > 0 && lanes.value.every((l) => l.hidden))

  // --- GT3.2: vertex drag (one undo unit per drag) + undo/redo ---
  // (dirty / canUndo / canRedo / refreshEditState are declared above the schedule watch.)

  /** Begin a drag transaction for a vertex (no-op if the voice is not editable, e.g. preparse). */
  function beginPointDrag(ref_: GTrackPointRef): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    m.beginEdit('point-move')
    return true
  }
  // GT3.10 (GT-D16): point-drag mode is a persisted EDITOR SETTING (owner req. 18): 'clamp' keeps
  // the point between its neighbours; 'crossover' lets it pass them (stable re-sort, drag follows
  // the point under its new index). Default = crossover (the owner's requested behaviour).
  const STORAGE_DRAG_MODE_KEY = 'mindwave-gtrack-point-drag-mode'
  function loadDragMode(): GTrackPointDragMode {
    try {
      return localStorage.getItem(STORAGE_DRAG_MODE_KEY) === 'clamp' ? 'clamp' : 'crossover'
    } catch {
      return 'crossover'
    }
  }
  const pointDragMode = ref<GTrackPointDragMode>(loadDragMode())
  function setPointDragMode(mode: GTrackPointDragMode): void {
    pointDragMode.value = mode
    try { localStorage.setItem(STORAGE_DRAG_MODE_KEY, mode) } catch { /* ignore */ }
  }

  // TS-D2 (owner 2026-07-18): the base-frequency display scale is a persisted GLOBAL editor setting,
  // exactly like pointDragMode above (not per-lane, not in the schedule model). 'log' by default =
  // the classic auto axis (gtrack-render.gtrackAxis); 'linear' forces a linear base axis. Only
  // mode='base' lanes honour it.
  const STORAGE_BASE_SCALE_KEY = 'mindwave-gtrack-base-scale'
  function loadBaseScale(): GTrackBaseScale {
    try {
      return localStorage.getItem(STORAGE_BASE_SCALE_KEY) === 'linear' ? 'linear' : 'log'
    } catch {
      return 'log'
    }
  }
  const baseScaleMode = ref<GTrackBaseScale>(loadBaseScale())
  function setBaseScaleMode(mode: GTrackBaseScale): void {
    baseScaleMode.value = mode
    try { localStorage.setItem(STORAGE_BASE_SCALE_KEY, mode) } catch { /* ignore */ }
  }

  // GT3.12 (GT-D18, owner req. 28): "Autosave" — when on, the point inspector applies every field
  // edit immediately instead of waiting for an explicit Apply. Persisted editor property.
  const STORAGE_POINT_AUTOSAVE_KEY = 'mindwave-gtrack-point-autosave'
  function loadPointAutosave(): boolean {
    // GT10.7 (owner req. 51): autosave is ON by default; only an explicit '0' turns it off.
    try { return localStorage.getItem(STORAGE_POINT_AUTOSAVE_KEY) !== '0' } catch { return true }
  }
  const pointAutosave = ref<boolean>(loadPointAutosave())
  function setPointAutosave(v: boolean): void {
    pointAutosave.value = v
    try { localStorage.setItem(STORAGE_POINT_AUTOSAVE_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }

  // GT11.14 (owner 2026-07-15): the point-tool state (Select/Add/Delete + its persisted
  // 'mindwave-gtrack-point-tool' key) was REMOVED — the tools duplicated existing gestures, and a
  // tool persisted as 'add' silently disabled vertex dragging across restarts (GT11.12).
  /**
   * GT3.14: delete a point by direct reference. Does NOT touch the
   * global selection unless it already pointed at this exact vertex — so using the Delete tool
   * doesn't hijack an unrelated point that's currently selected/inspected elsewhere.
   */
  function deletePointAt(laneId: number, ref_: GTrackPointRef): boolean {
    void laneId // kept for API symmetry with GTrackSelection; not needed to locate the point
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => m.removePoint(ref_.voiceId, ref_.pointIndex), 'point-remove')
    } catch {
      return false
    }
    const sel = selection.value
    if (sel !== null && sel.voiceId === ref_.voiceId && sel.pointIndex === ref_.pointIndex) {
      selection.value = null
    }
    reindexMultiSelectionAfterRemoval(ref_.voiceId, ref_.pointIndex)
    syncSchedule()
    refreshEditState()
    return true
  }

  /** Live-move the dragged vertex: time per the drag mode (clamp/crossover), value per the lane mode. */
  function dragPoint(ref_: GTrackPointRef, timeSec: number, modeValue: number, mode: GTrackMode): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    const voice = m.schedule.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (voice === undefined || p === undefined) return
    const patch = valuePatchForMode(p, mode, modeValue, voice.mono)
    if (pointDragMode.value === 'crossover') {
      // Cross neighbours: the model re-sorts and hands back the point's new index; keep the
      // selection on the same (moved) point so the lane's drag follows it.
      const newIndex = m.movePointCrossing(ref_.voiceId, ref_.pointIndex, timeSec)
      if (Object.keys(patch).length > 0) m.setPointFields(ref_.voiceId, newIndex, patch)
      const sel = selection.value
      if (sel !== null && sel.voiceId === ref_.voiceId) {
        selection.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: newIndex }
      }
      dropMultiSelectionForVoice(ref_.voiceId) // GT3.15: an arbitrary re-sort can't be reindexed
    } else {
      const clampedTime = clampPointTime(voice.points, ref_.pointIndex, timeSec)
      m.setPointFields(ref_.voiceId, ref_.pointIndex, { timeSec: clampedTime, ...patch })
    }
    syncSchedule()
  }
  /**
   * GT11.4: live-set the dragged beat-band edge's beatFreqHalf (half the binaural beat, i.e. the
   * band's half-width on the Base graph). Runs inside the SAME transaction opened by beginPointDrag
   * (one undo unit) and, because GTrackModel is the single source (GT-D16), the change syncs to the
   * voice's other lanes (a Beat lane shows 2·beatFreqHalf) automatically. Time/index are untouched.
   */
  function dragPointBeat(ref_: GTrackPointRef, beatFreqHalf: number): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    const voice = m.schedule.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (voice === undefined || p === undefined) return
    m.setPointFields(ref_.voiceId, ref_.pointIndex, { beatFreqHalf: Math.max(0, beatFreqHalf) })
    syncSchedule()
  }
  /**
   * VB2.1 (VB-D3 variant A): live-set the dragged balance-corridor edge — re-splits volL/volR to the
   * new stereo `balance` at FIXED total (volume unchanged), so the corridor stays centred on the
   * volume line and only its width changes. Runs inside the SAME transaction opened by beginPointDrag
   * (one undo unit); GTrackModel is the single source (GT-D16), so a Balance lane of the same voice
   * updates automatically. Time/index untouched. A mono voice or silence yields an empty patch.
   */
  function dragPointBalance(ref_: GTrackPointRef, balance: number): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    const voice = m.schedule.voices.find((v) => v.id === ref_.voiceId)
    const p = voice?.points[ref_.pointIndex]
    if (voice === undefined || p === undefined) return
    m.setPointFields(ref_.voiceId, ref_.pointIndex, valuePatchForMode(p, 'balance', balance, voice.mono))
    syncSchedule()
  }
  function endPointDrag(): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    m.commitEdit()
    syncSchedule()
    refreshEditState()
  }
  function cancelPointDrag(): void {
    const m = model.value
    if (m === null || !m.inTransaction) return
    m.cancelEdit()
    syncSchedule()
  }
  // --- GT3.3/GT3.6: point dialog + add/remove operations ---
  function getVoice(voiceId: number): GTrackVoice | undefined {
    return voiceById(voiceId)
  }
  function getPoint(ref_: GTrackPointRef): GTrackPoint | null {
    return voiceById(ref_.voiceId)?.points[ref_.pointIndex] ?? null
  }
  // --- GT3.7 (GT-D9, owner req. 10-11): preparse (generator) voices ---
  function isVoicePreparse(voiceId: number): boolean {
    return voiceById(voiceId)?.preparse ?? false
  }
  /**
   * Owner req. 11: "fix / make editable" — bake the generator's expanded points into concrete,
   * editable points (clears the preparse flag) as one undo unit. Irreversible in the file (the
   * generator node is lost on Save), so the caller must warn the user first (GT-D9 / R6).
   */
  function fixPreparseVoice(voiceId: number): boolean {
    const m = model.value
    if (m === null) return false
    try {
      m.fixPreparseVoice(voiceId)
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /**
   * Apply the point dialog: set every field in ONE undo unit. Time uses crossover semantics
   * (an exact time may legitimately pass neighbours); the selection follows the new index.
   */
  function applyPointEdit(
    ref_: GTrackPointRef,
    patch: { timeSec: number; baseFreq: number; beatFreqHalf: number; volL: number; volR: number },
  ): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(ref_.voiceId)) return false
    try {
      m.edit(() => {
        const ni = m.movePointCrossing(ref_.voiceId, ref_.pointIndex, patch.timeSec)
        m.setPointFields(ref_.voiceId, ni, {
          baseFreq: patch.baseFreq,
          beatFreqHalf: patch.beatFreqHalf,
          volL: patch.volL,
          volR: patch.volR,
        })
        const sel = selection.value
        if (sel !== null && sel.voiceId === ref_.voiceId) {
          selection.value = { laneId: sel.laneId, voiceId: sel.voiceId, pointIndex: ni }
        }
        dropMultiSelectionForVoice(ref_.voiceId) // GT3.15: crossover re-sort — can't be reindexed
      }, 'point-edit')
    } catch {
      return false
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT3.6: insert an interpolated point at timeSec and select it. False when not possible. */
  function insertPointAt(laneId: number, voiceId: number, timeSec: number): boolean {
    const m = model.value
    if (m === null || !m.isVoiceEditable(voiceId)) return false
    try {
      let idx = -1
      m.edit(() => { idx = m.insertPoint(voiceId, timeSec) }, 'point-insert')
      selection.value = { laneId, voiceId, pointIndex: idx }
      reindexMultiSelectionAfterInsert(voiceId, idx)
    } catch {
      return false // outside segments / preparse-locked / degenerate voice
    }
    syncSchedule()
    refreshEditState()
    return true
  }
  /** GT3.6: remove the currently selected point (Delete key). False when blocked (min 2 points). */
  function removeSelectedPoint(): boolean {
    const sel = selection.value
    const m = model.value
    if (sel === null || m === null || !m.isVoiceEditable(sel.voiceId)) return false
    try {
      m.edit(() => m.removePoint(sel.voiceId, sel.pointIndex), 'point-remove')
    } catch {
      return false
    }
    reindexMultiSelectionAfterRemoval(sel.voiceId, sel.pointIndex)
    selection.value = null
    syncSchedule()
    refreshEditState()
    return true
  }

  // --- GT9.3 (owner req. 42, GT-D21): confirmed auto-fixes for lint diagnostics (undoable) ---
  // GT10.26: the algorithms live in gtrack-lint.ts as PURE functions (bun-tested on real presets);
  // this layer only syncs the Vue mirror + edit state after a successful apply.
  function fixEndClick(voiceId: number): boolean {
    const m = model.value
    if (m === null) return false
    if (!applyEndClickFix(m, voiceId)) return false
    syncSchedule()
    refreshEditState()
    return true
  }
  function fixLoopClick(voiceId: number): boolean {
    const m = model.value
    if (m === null) return false
    if (!applyLoopClickFix(m, voiceId)) return false
    syncSchedule()
    refreshEditState()
    return true
  }

  function undoEdit(): void {
    const m = model.value
    if (m === null || m.inTransaction) return // never undo mid-drag (the model would throw)
    if (m.undo()) {
      syncSchedule()
      refreshEditState()
    }
  }
  function redoEdit(): void {
    const m = model.value
    if (m === null || m.inTransaction) return
    if (m.redo()) {
      syncSchedule()
      refreshEditState()
    }
  }

  /** UG3.2 (req 7/8): clear the history (whole / older-than / undone tail). State is untouched;
   *  the journal re-persists so the disk copy shrinks too. */
  function clearUndoHistory(mode: 'all' | 'before' | 'redo-tail', cursorPos = 0): void {
    const m = model.value
    if (m === null || m.inTransaction) return
    m.clearHistory(mode, cursorPos)
    // VL4.2: keep the position map aligned with the trimmed window. 'all' also clears the
    // SERVER log (req 7 «целиком») — the next edit re-roots it with a baseline snapshot;
    // 'before' re-bases position 0, 'redo-tail' shrinks inside the sync prefix-truncation.
    if (mode === 'all') {
      const key = filePath.value
      undoLogPositions = [null]
      undoLogMainTip = null
      undoLogLastSentHead = null
      undoLogDeltasSinceSnapshot = 0
      deepUndoRows.value = []
      deepUndoHasMore.value = false
      deepUndoLoaded.value = false
      deepUndoNextFrom = null
      undoTags.value = {}
      undoBranches.value = []
      undoBranchesLoaded.value = false
      undoBranchRowsByTip.value = new Map()
      if (key !== null) {
        discardPendingUndoLogFor(key)
        void clearProjectUndoLogFor(key)
      }
    } else if (mode === 'before') {
      undoLogPositions = [undoLogPositions[Math.min(cursorPos, undoLogPositions.length - 1)] ?? null]
    }
    refreshEditState()
  }

  /** UG3.1 (req 3/8): jump the history to cursor position `target` (0 = the initial state,
   *  steps.length = everything applied) — a run of undo()/redo() applied as ONE visual update.
   *  The two-step confirmation (select, then «Применить») lives in the panel; this is the apply. */
  function rollbackToCursor(target: number): boolean {
    const m = model.value
    if (m === null || m.inTransaction) return false
    const clamped = Math.max(0, Math.min(Math.floor(target), m.historySteps.length))
    let moved = false
    while (m.historyCursor > clamped && m.undo()) moved = true
    while (m.historyCursor < clamped && m.redo()) moved = true
    if (moved) {
      syncSchedule()
      refreshEditState()
    }
    return moved
  }

  // PW5.6: persist unsaved gtrack curve edits back to the .gnaural (extracted from TracksPanel so the
  // AudioPage voice-patch guard can reuse it). Throws on a server error; on success reloads the
  // schedule (rebuilds the model at the saved baseline). useAudioStore is read at CALL time so the
  // pure composable stays creatable without an active Pinia (the unit tests do exactly that).
  const saving = ref(false)
  async function saveEdits(): Promise<'saved' | 'unchanged' | 'nochange' | 'skip'> {
    const m = model.value
    const fp = filePath.value
    if (m === null || fp === null || saving.value) return 'skip'
    if (!dirty.value) return 'nochange'
    saving.value = true
    try {
      const doc = await audioApi.fetchEditorDocument(fp)
      const patched = patchGnauralXml(doc.content, m.schedule, { preserveVoiceIds: findPreparseVoiceIds(doc.content) })
      const res = await audioApi.saveEditorDocument({ path: fp, content: patched, expectedModifiedAtMs: doc.modifiedAtMs })
      const audio = useAudioStore()
      // UG2.1: the reload below is our own save round-trip — arm buildModel to carry the undo
      // history over (post-save rebase) instead of dropping it.
      postSaveReloadPath = fp
      await audio.loadGnauralSchedule(fp, true)
      return res.changed ? 'saved' : 'unchanged'
    } finally {
      saving.value = false
    }
  }

  return {
    saving,
    saveEdits,
    isLanePointMode,
    toggleLanePointMode,
    selection,
    selectionForLane,
    selectPoint,
    clearSelection,
    beginPointDrag,
    dragPoint,
    dragPointBeat,
    dragPointBalance,
    endPointDrag,
    cancelPointDrag,
    undoEdit,
    redoEdit,
    dirty,
    canUndo,
    canRedo,
    undoSteps,
    undoCursor,
    rollbackToCursor,
    clearUndoHistory,
    persistedUndoStepIds,
    deepUndoRows,
    deepUndoHasMore,
    deepUndoLoaded,
    deepUndoLoading,
    loadDeepUndoHistory,
    checkoutUndoCommit,
    undoTags,
    setUndoTag,
    deleteUndoTag,
    undoLogCidAt,
    undoBranches,
    undoBranchesLoaded,
    undoBranchesLoading,
    undoBranchRowsByTip,
    loadUndoBranches,
    loadUndoBranchSteps,
    deleteUndoBranch,
    pointDragMode,
    setPointDragMode,
    baseScaleMode,
    setBaseScaleMode,
    pointAutosave,
    setPointAutosave,
    deletePointAt,
    multiSelection,
    isMultiSelected,
    toggleMultiSelect,
    clearMultiSelection,
    multiSelectionPoints,
    setPointValues,
    setMultiplePointValues,
    removeMultiSelection,
    removePointsBulk,
    getVoice,
    getPoint,
    preparseVoiceIds,
    isVoicePreparse,
    fixPreparseVoice,
    fixEndClick,
    fixLoopClick,
    applyPointEdit,
    insertPointAt,
    removeSelectedPoint,
    isVoiceVisible,
    voiceMode,
    setVoiceVisible,
    setVoiceMode,
    isVoiceInMix,
    setVoiceInMix,
    mixVoiceIds,
    hasMixVoices,
    mergeAllIntoOneLane,
    spreadPerVoiceLanes,
    showAllModesPerVoice,
    allModesOneLanePerVoice,
    setAllLanesMode,
    setAllLanesHidden,
    allLanesHidden,
    model,
    lanes,
    voices,
    durationSec,
    loopCount,
    fullDurationSec,
    diagnostics,
    laneHeight,
    setLaneHeight,
    visibleLanes,
    hiddenLanes,
    addLane,
    removeLane,
    restoreLane,
    setLaneMode,
    toggleLaneMode,
    setLaneSolo,
    setLaneSoloInline,
    setLaneBeatBand,
    setLaneBalanceBand,
    toggleLaneFolded,
    setLaneSoloGraphHidden,
    setLaneGraphHeight,
    setVoiceGraphsHeight,
    setAllLanesGraphsHeight,
    setLaneSoloWaveStyle,
    setLaneSoloWaveScale,
    laneSpectrum,
    getLaneSpectrum,
    ensureLaneSpectrum,
    setLaneSpectrum,
    clearLaneSpectrum,
    toggleLaneVoice,
    setLaneHidden,
    swapLanes,
    isTonal,
  }
}

// PW5.6 (PW-D10): a process-wide SINGLETON of the gtrack lane model, so the Треки tab (TracksPanel)
// and the AudioPage-hosted «Список треков» panel share ONE reactive instance instead of each
// building its own, divergent one. useGtrackLanes uses no lifecycle hooks (only ref/computed/watch),
// so it runs safely inside a DETACHED effect scope — its per-file persistence watchers then live for
// the app's lifetime, which is exactly what a singleton wants. The audio store (itself a singleton)
// supplies the reactive schedule + file path.
let sharedGtrackLanes: ReturnType<typeof useGtrackLanes> | null = null

export function useSharedGtrackLanes(): ReturnType<typeof useGtrackLanes> {
  if (sharedGtrackLanes === null) {
    const scope = effectScope(true)
    sharedGtrackLanes = scope.run(() => {
      const audio = useAudioStore()
      return useGtrackLanes(
        computed(() => audio.gnauralSchedule),
        computed(() => audio.displayFilePath),
      )
    }) ?? null
    if (sharedGtrackLanes === null) throw new Error('useSharedGtrackLanes: initialisation failed')
  }
  return sharedGtrackLanes
}
