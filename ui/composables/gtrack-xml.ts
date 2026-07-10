// GT1.2 — serialize edited gtrack points back into a `.gnaural` XML file (GT-D5).
//
// The editor never regenerates the whole file. It PATCHES the source XML surgically: for each voice
// (matched by <id>) it replaces the inner content of that voice's <entries> block with freshly
// generated <entry .../> nodes derived from the point model, and leaves every other byte of the
// file untouched (title, loops, per-voice metadata, comments, unknown fields, other voices). This
// preserves anything the dump does not round-trip and, for generator-based ("preparse") voices,
// "bakes" the edited points into concrete entries (the only way to persist hand edits).
//
// Mapping (verified against Gnaural.exe --dump-schedule): a voice with M XML <entry> nodes dumps as
// M segments and becomes M+1 model points (segment boundaries). Writing back, entry k (0..M-1)
// takes its VALUES from point P_k and its DURATION from P_{k+1}.time - P_k.time; the final point
// P_M only supplies the last entry's duration (its values mirror P_{M-1} in a well-formed schedule).
// XML `beatfreq` is the full beat = 2 * beatFreqHalf; `basefreq`, `volume_left/right` map directly.
//
// Pure string transformation (no DOM), so it runs in the browser (Save) and under bun (tests).

import type { GTrackSchedule, GTrackVoice } from './gtrack-model'
import { pointBeatFreq } from './gtrack-model'

export class GTrackXmlError extends Error {}

/** Format a number for the .gnaural XML: plain decimal, no exponent, trailing zeros trimmed. */
export function formatXmlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new GTrackXmlError(`non-finite number in schedule: ${value}`)
  if (Number.isInteger(value)) return String(value)
  // Up to 6 decimals is well within Gnaural's precision; trim trailing zeros.
  let s = value.toFixed(6)
  s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Generate the `<entry .../>` nodes for one voice from its points (M+1 points -> M entries).
 * Each entry line is prefixed with `indent`. Returns an empty string when the voice has < 2 points.
 */
export function serializeVoiceEntries(voice: GTrackVoice, indent: string): string {
  const pts = voice.points
  const lines: string[] = []
  for (let k = 0; k < pts.length - 1; k += 1) {
    const p = pts[k]!
    const duration = pts[k + 1]!.timeSec - p.timeSec
    const attrs =
      `duration="${formatXmlNumber(duration)}"` +
      ` basefreq="${formatXmlNumber(p.baseFreq)}"` +
      ` beatfreq="${formatXmlNumber(pointBeatFreq(p))}"` +
      ` volume_left="${formatXmlNumber(p.volL)}"` +
      ` volume_right="${formatXmlNumber(p.volR)}"`
    lines.push(`${indent}<entry ${attrs}/>`)
  }
  return lines.join('\n')
}

// Match one voice block (voices do not nest in the .gnaural format, so a lazy body is safe).
const VOICE_BLOCK = /<voice\b[^>]*>([\s\S]*?)<\/voice>/g
const VOICE_ID = /<id>\s*(-?\d+)\s*<\/id>/
// Match the <entries> block (open+close) or a self-closing empty <entries/>.
const ENTRIES_BLOCK = /<entries\b[^>]*>([\s\S]*?)<\/entries>|<entries\b[^>]*\/>/
// A generator entry: <entry ... type="preparse" .../>.
const PREPARSE_ENTRY = /<entry\b[^>]*\btype\s*=\s*["']preparse["']/

/**
 * Ids of voices whose source XML uses a generator entry (<entry type="preparse">). The dump expands
 * these into concrete points, but the file keeps the single generator node — so provenance can only
 * be recovered from the raw XML. Used to mark voices preparse (GT-D9).
 */
export function findPreparseVoiceIds(sourceXml: string): Set<number> {
  const ids = new Set<number>()
  for (const m of sourceXml.matchAll(VOICE_BLOCK)) {
    const body = m[1]!
    const idMatch = VOICE_ID.exec(body)
    if (idMatch !== null && PREPARSE_ENTRY.test(body)) ids.add(Number(idMatch[1]))
  }
  return ids
}

/** The whitespace indent used for entries inside a voice body (reuse the existing style). */
function detectEntryIndent(voiceBody: string): string {
  const firstChildIndent = /\n([ \t]*)<entry\b/.exec(voiceBody)
  if (firstChildIndent !== null) return firstChildIndent[1]!
  // No existing <entry> (e.g. empty <entries/>): indent one step past the <entries> tag.
  const entriesIndent = /\n([ \t]*)<entries\b/.exec(voiceBody)
  const base = entriesIndent !== null ? entriesIndent[1]! : '    '
  return `${base}    `
}

/** The whitespace indent of the `<entries>` opening tag itself (for the closing tag alignment). */
function detectEntriesTagIndent(voiceBody: string): string {
  const m = /\n([ \t]*)<entries\b/.exec(voiceBody)
  return m !== null ? m[1]! : '    '
}

export interface PatchGnauralXmlOptions {
  /**
   * Extra voice ids to leave untouched even if present (and not flagged preparse) in the schedule.
   * GT3.4: the client model does not yet carry preparse flags (that wiring is GT3.7), so Save passes
   * `findPreparseVoiceIds(sourceXml)` here — generator voices then keep their source <entries> bytes
   * instead of being irreversibly baked into concrete points.
   */
  readonly preserveVoiceIds?: ReadonlySet<number>
}

/**
 * Patch `sourceXml` so each voice present in `schedule` has its <entries> block regenerated from
 * the point model. Voices in the XML but not in the schedule are left untouched. Throws if a
 * scheduled voice or its <entries> block cannot be located in the XML.
 */
export function patchGnauralXml(
  sourceXml: string,
  schedule: GTrackSchedule,
  options: PatchGnauralXmlOptions = {},
): string {
  // Only non-preparse voices are written back; a still-preparse voice keeps its generator node in
  // the file untouched (GT-D9). Fixing a voice (fixPreparseVoice) clears the flag so it patches.
  // `preserveVoiceIds` skips additional voices the same way (GT3.4 generator safety).
  const preserve = options.preserveVoiceIds ?? new Set<number>()
  const voicesById = new Map<number, GTrackVoice>()
  for (const v of schedule.voices) if (!v.preparse && !preserve.has(v.id)) voicesById.set(v.id, v)
  const patchedIds = new Set<number>()

  const result = sourceXml.replace(VOICE_BLOCK, (block, body: string) => {
    const idMatch = VOICE_ID.exec(body)
    if (idMatch === null) return block // no id -> leave untouched
    const id = Number(idMatch[1])
    const voice = voicesById.get(id)
    if (voice === undefined) return block // not edited -> leave untouched

    const entryIndent = detectEntryIndent(body)
    const tagIndent = detectEntriesTagIndent(body)
    const generated = serializeVoiceEntries(voice, entryIndent)
    const replacement =
      generated === ''
        ? `<entries></entries>`
        : `<entries>\n${generated}\n${tagIndent}</entries>`

    let replaced = false
    const newBody = body.replace(ENTRIES_BLOCK, () => {
      replaced = true
      return replacement
    })
    if (!replaced) {
      throw new GTrackXmlError(`voice ${id}: no <entries> block found to patch`)
    }
    patchedIds.add(id)
    return block.replace(body, newBody)
  })

  for (const v of schedule.voices) {
    if (!v.preparse && !preserve.has(v.id) && !patchedIds.has(v.id)) {
      throw new GTrackXmlError(`voice ${v.id} from the schedule was not found in the source XML`)
    }
  }
  return result
}
