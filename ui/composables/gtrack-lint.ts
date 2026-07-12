// GT9.1 (owner req. 42, GT-D21) — schedule "lint": detect potential problems in an open gnaural
// schedule so the editor can surface them (GT9.2 UI) and offer fixes (GT9.3). Pure TypeScript over
// the editable GTrackSchedule model (no Vue, no filesystem), so it is unit-testable and runs live.
//
// Rule set seeded by the d:/bin/Presets mass audit (58 of 63 presets defective):
//   end-click        a voice ends at non-zero volume with no fade -> truncation click at the end.
//   loop-click       loopCount > 1 and a voice's end volume != its start volume -> click each seam.
//   degenerate-tail  the last segment has ~zero duration (a flat tail that never plays).
//   zero-run         a run of >=2 consecutive zero-duration segments (machine-generated artifact).
//   extreme-value    non-finite / out-of-range (<0 or >1 vol, negative freq) / denormal values.
//   missing-audiofile  a pcm (audiofile) voice with an empty audioFilePath.
// (XML-level checks — entrycount vs actual, on-disk file existence — need the raw XML / filesystem
//  and are handled outside this pure module.)

import type { GTrackPoint, GTrackSchedule, GTrackVoice } from './gtrack-model'

export type GTrackLintRule =
  | 'end-click'
  | 'loop-click'
  | 'degenerate-tail'
  | 'zero-run'
  | 'extreme-value'
  | 'missing-audiofile'

export type GTrackLintSeverity = 'error' | 'warning'

export interface GTrackDiagnostic {
  readonly rule: GTrackLintRule
  readonly severity: GTrackLintSeverity
  readonly voiceId: number
  /** The point this diagnostic points at (for navigation), or null for a voice-level issue. */
  readonly pointIndex: number | null
  /** The time of that point (seconds), or null. */
  readonly timeSec: number | null
  /** English fallback/debug text (tests, logs). The UI renders messageKey via i18n instead. */
  readonly message: string
  /** GT10.1 (owner req. 43): i18n key (audio.lint_<rule>) + params for a localized message. */
  readonly messageKey: string
  readonly messageParams: Record<string, string | number>
}

export interface GTrackLintOptions {
  /** Max end volume treated as "silent enough" to not click. Default 0.01. */
  readonly endVolumeThreshold?: number
  /** Min volume delta across a loop seam that is treated as a click. Default 0.01. */
  readonly loopVolumeEpsilon?: number
  /** A segment shorter than this (seconds) counts as zero-duration. Default 0.005. */
  readonly zeroDurationEpsilon?: number
}

const DEFAULTS: Required<GTrackLintOptions> = {
  endVolumeThreshold: 0.01,
  loopVolumeEpsilon: 0.01,
  zeroDurationEpsilon: 0.005,
}

const PCM_TYPE_INDEX = 2 // GnauralSchedule TVoiceType: 2 = vtPCM (audiofile)
const DENORMAL_EPSILON = 1e-20 // 0 < |v| < this = an effectively-zero denormal (e.g. Penfold 4e-70)

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function isDenormal(v: number): boolean {
  return v !== 0 && Math.abs(v) < DENORMAL_EPSILON
}

/** Lint one voice, pushing any diagnostics into `out`. */
function lintVoice(voice: GTrackVoice, schedule: GTrackSchedule, opts: Required<GTrackLintOptions>, out: GTrackDiagnostic[]): void {
  const pts = voice.points
  const last = pts.length - 1
  const name = voice.description.trim() !== '' ? voice.description : `#${voice.id}`

  // missing-audiofile: a pcm voice with no source path.
  if (voice.typeIndex === PCM_TYPE_INDEX && voice.audioFilePath.trim() === '') {
    out.push({ rule: 'missing-audiofile', severity: 'warning', voiceId: voice.id, pointIndex: null, timeSec: null,
      message: `Voice "${name}" is an audiofile but has no source file.`,
      messageKey: 'audio.lint_missing_audiofile', messageParams: { name } })
  }

  if (pts.length === 0) return

  // extreme-value: scan every point for non-finite / out-of-range / denormal values.
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!
    const bad: string[] = []
    for (const [field, val] of [['baseFreq', p.baseFreq], ['beatFreqHalf', p.beatFreqHalf], ['volL', p.volL], ['volR', p.volR], ['timeSec', p.timeSec]] as const) {
      if (!Number.isFinite(val)) { bad.push(`${field}=${val}`); continue }
      if (isDenormal(val)) bad.push(`${field}=${val} (denormal)`)
    }
    if (p.volL < -1e-6 || p.volL > 1.0001) bad.push(`volL=${fmt(p.volL)} out of [0,1]`)
    if (p.volR < -1e-6 || p.volR > 1.0001) bad.push(`volR=${fmt(p.volR)} out of [0,1]`)
    if (p.baseFreq < 0) bad.push(`baseFreq=${fmt(p.baseFreq)} < 0`)
    if (p.beatFreqHalf < 0) bad.push(`beatFreqHalf=${fmt(p.beatFreqHalf)} < 0`)
    if (bad.length > 0) {
      const hasNonFinite = bad.some((b) => b.includes('Infinity') || b.includes('NaN'))
      out.push({ rule: 'extreme-value', severity: hasNonFinite ? 'error' : 'warning', voiceId: voice.id,
        pointIndex: i, timeSec: Number.isFinite(p.timeSec) ? p.timeSec : null,
        message: `Voice "${name}" point ${i}: ${bad.join(', ')}.`,
        messageKey: 'audio.lint_extreme_value', messageParams: { name, index: i, details: bad.join(', ') } })
    }
  }

  // GT10.26 fix: looped schedules (loopCount != 1; 0 = upstream-infinite) are governed by the
  // SEAM rule only — the 'end' repeats at every seam, where the correct de-click is end == start,
  // not a fade to zero. Emitting end-click there created a trap: fixing it made the seam mismatch
  // (loop-click appeared for the same voice), and fixing THAT restored the original state.
  const looped = schedule.loopCount !== 1

  // end-click (single-pass schedules only): the last point's volume is the final playing level.
  const endP = pts[last]!
  const endVol = Math.max(endP.volL, endP.volR)
  if (!looped && endVol > opts.endVolumeThreshold) {
    out.push({ rule: 'end-click', severity: 'warning', voiceId: voice.id, pointIndex: last, timeSec: endP.timeSec,
      message: `Voice "${name}" ends at volume ${fmt(endVol)} (no fade to zero) — likely a click at the end.`,
      messageKey: 'audio.lint_end_click', messageParams: { name, vol: fmt(endVol) } })
  }

  // loop-click: on a loop seam the playback jumps end -> start; a volume mismatch clicks each seam.
  if (looped && pts.length >= 2) {
    const startP = pts[0]!
    const dl = Math.abs(startP.volL - endP.volL)
    const dr = Math.abs(startP.volR - endP.volR)
    if (Math.max(dl, dr) > opts.loopVolumeEpsilon) {
      out.push({ rule: 'loop-click', severity: 'warning', voiceId: voice.id, pointIndex: last, timeSec: endP.timeSec,
        message: `Voice "${name}" loops ${schedule.loopCount}x but end volume (${fmt(endP.volL)}/${fmt(endP.volR)}) != start (${fmt(startP.volL)}/${fmt(startP.volR)}) — click at each loop seam.`,
        messageKey: 'audio.lint_loop_click', messageParams: { name, loops: schedule.loopCount, endVol: `${fmt(endP.volL)}/${fmt(endP.volR)}`, startVol: `${fmt(startP.volL)}/${fmt(startP.volR)}` } })
    }
  }

  // degenerate-tail: the last segment (points[last-1] -> points[last]) has ~zero duration.
  if (pts.length >= 2) {
    const tailDur = endP.timeSec - pts[last - 1]!.timeSec
    if (tailDur < opts.zeroDurationEpsilon) {
      out.push({ rule: 'degenerate-tail', severity: 'warning', voiceId: voice.id, pointIndex: last, timeSec: endP.timeSec,
        message: `Voice "${name}" ends with a ~zero-duration segment (${fmt(tailDur)}s) — the flat tail never plays.`,
        messageKey: 'audio.lint_degenerate_tail', messageParams: { name, dur: fmt(tailDur) } })
    }
  }

  // zero-run: a run of >=2 consecutive zero-duration segments anywhere.
  let runStart = -1
  for (let i = 1; i < pts.length; i += 1) {
    const zero = pts[i]!.timeSec - pts[i - 1]!.timeSec < opts.zeroDurationEpsilon
    if (zero && runStart < 0) runStart = i - 1
    if ((!zero || i === pts.length - 1) && runStart >= 0) {
      const runEnd = zero ? i : i - 1
      if (runEnd - runStart >= 2) {
        out.push({ rule: 'zero-run', severity: 'warning', voiceId: voice.id, pointIndex: runStart,
          timeSec: pts[runStart]!.timeSec,
          message: `Voice "${name}" has ${runEnd - runStart} consecutive zero-duration segments near point ${runStart}.`,
          messageKey: 'audio.lint_zero_run', messageParams: { name, count: runEnd - runStart, index: runStart } })
      }
      runStart = -1
    }
  }
}

// ---------------------------------------------------------------------------
// GT9.3/GT10.26 auto-fixes — PURE functions over the model (bun-testable; the Vue composable
// delegates here). Each is one undo unit and returns false only when genuinely impossible.
// ---------------------------------------------------------------------------

export const END_FADE_SEC = 0.1
const MIN_TAIL_SEC = 0.02

/**
 * The minimal model surface the fixes need. Structural (not the GTrackModel class) because a Vue
 * ref unwraps class instances to a structural type that drops private members — a nominal
 * GTrackModel parameter would reject `model.value` at the call site.
 */
export interface GTrackFixTarget {
  isVoiceEditable(voiceId: number): boolean
  readonly schedule: GTrackSchedule
  edit(mutator: () => void): void
  insertPoint(voiceId: number, timeSec: number): number
  setPointFields(voiceId: number, index: number, patch: Partial<Record<'timeSec' | 'baseFreq' | 'beatFreqHalf' | 'volL' | 'volR', number>>): void
}

/**
 * Fade a voice to silence at its very end (fixes 'end-click'), duration preserved.
 *  - long tail (> fade+0.01): insert a fade-start point 0.1s before the end, zero the last point;
 *  - short tail (>= 0.02): zero the last point — the fade IS the tail;
 *  - degenerate tail/cluster (< 0.02): walk back to the last REAL segment, borrow the fade from it
 *    and zero every point after (the bulk click-fix script's proven borrow).
 */
export function applyEndClickFix(m: GTrackFixTarget, voiceId: number): boolean {
  if (!m.isVoiceEditable(voiceId)) return false
  const voice = m.schedule.voices.find((v) => v.id === voiceId)
  if (voice === undefined || voice.points.length < 2) return false
  const pts = voice.points
  let r = pts.length - 1
  while (r >= 1 && pts[r]!.timeSec - pts[r - 1]!.timeSec < MIN_TAIL_SEC) r -= 1
  if (r === 0) return false // the whole voice is degenerate — nothing to fade over
  const segEnd = pts[r]!.timeSec
  const segDur = segEnd - pts[r - 1]!.timeSec
  try {
    m.edit(() => {
      let zeroFrom = r
      if (segDur > END_FADE_SEC + 0.01) {
        zeroFrom = m.insertPoint(voiceId, segEnd - END_FADE_SEC) + 1
      }
      const v = m.schedule.voices.find((x) => x.id === voiceId)
      if (v === undefined) throw new Error('gtrack: voice vanished during fix')
      for (let i = zeroFrom; i < v.points.length; i += 1) {
        m.setPointFields(voiceId, i, { volL: 0, volR: 0 })
      }
    })
  } catch {
    return false
  }
  return true
}

/** Align the loop seam (fixes 'loop-click'): last point volume := first point volume. */
export function applyLoopClickFix(m: GTrackFixTarget, voiceId: number): boolean {
  if (!m.isVoiceEditable(voiceId)) return false
  const voice = m.schedule.voices.find((v) => v.id === voiceId)
  if (voice === undefined || voice.points.length < 2) return false
  const first = voice.points[0]!
  try {
    m.edit(() => m.setPointFields(voiceId, voice.points.length - 1, { volL: first.volL, volR: first.volR }))
  } catch {
    return false
  }
  return true
}

/** Run all lint rules over a schedule, returning diagnostics (errors first, then by voice). */
export function lintSchedule(schedule: GTrackSchedule, options: GTrackLintOptions = {}): GTrackDiagnostic[] {
  const opts = { ...DEFAULTS, ...options }
  const out: GTrackDiagnostic[] = []
  for (const voice of schedule.voices) lintVoice(voice, schedule, opts, out)
  // errors before warnings; stable otherwise (voice order preserved).
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
}
