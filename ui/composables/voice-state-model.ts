// project-store PR2.4 (PR-D11, owner req 9): the PURE half of the voiceState section — merge/seed/
// patch logic with no Vue or transport imports, so it unit-tests under `bun test` from the repo
// root (use-project pulls in vue, which the GnauralCore runner cannot resolve). The IO wrappers
// live in use-voice-state.ts.
import type { GnauralScheduleData } from '@protocol'

export const VOICE_STATE_SECTION = 'voiceState'

export interface VoiceStateEntry {
  readonly color?: string | null
  readonly hidden?: boolean
  readonly muted?: boolean
}

export type VoiceStateSection = Record<string, VoiceStateEntry>

export interface VoiceStatePatch {
  readonly voiceId: number
  readonly color?: string
  readonly hidden?: boolean
  readonly muted?: boolean
}

const isEntry = (value: unknown): value is VoiceStateEntry => value !== null && typeof value === 'object'

/** Overlay the section onto a freshly-dumped schedule (fields absent from an entry fall back to
 *  the file's value, so voices added to the file later still show up sanely). */
export function mergeVoiceStateIntoSchedule(data: GnauralScheduleData, section: VoiceStateSection): GnauralScheduleData {
  const voices = data.voices.map((voice) => {
    const entry = section[String(voice.id)]
    if (entry === undefined || !isEntry(entry)) return voice
    return {
      ...voice,
      color: entry.color !== undefined ? entry.color : voice.color,
      hidden: typeof entry.hidden === 'boolean' ? entry.hidden : voice.hidden,
      muted: typeof entry.muted === 'boolean' ? entry.muted : voice.muted,
    }
  })
  return { ...data, voices }
}

/** First-open migration seed: capture the file's current values as the project's own. */
export function seedVoiceStateFromSchedule(data: GnauralScheduleData): VoiceStateSection {
  const section: VoiceStateSection = {}
  for (const voice of data.voices) {
    section[String(voice.id)] = { color: voice.color, hidden: voice.hidden, muted: voice.muted }
  }
  return section
}

/** Merge UI patches into a section value (immutably). */
export function mergeVoiceStatePatchesInto(base: VoiceStateSection, patches: readonly VoiceStatePatch[]): VoiceStateSection {
  const next: VoiceStateSection = { ...base }
  for (const patch of patches) {
    const key = String(patch.voiceId)
    const previous = isEntry(next[key]) ? next[key] : {}
    next[key] = {
      ...previous,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
      ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
    }
  }
  return next
}
