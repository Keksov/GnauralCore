// project-store PR2.4 (PR-D11, owner req 9): voice colour/hidden/muted are PROJECT data — they
// live in the project's 'voiceState' section, not in the .gnaural file. On the first open of a
// file whose project has no section yet, the section is seeded from the file's own values
// (one-time migration); after that the project is the source of truth: the file's tags are
// ignored on read and never written again (stale tags stay in old files, see plan R9).
//
// The pure merge/seed/patch logic lives in voice-state-model.ts (unit-tested there).
import type { GnauralScheduleData } from '@protocol'
import { readProjectSectionFor, writeProjectSectionFor } from './use-project'
import {
  VOICE_STATE_SECTION,
  mergeVoiceStateIntoSchedule,
  mergeVoiceStatePatchesInto,
  seedVoiceStateFromSchedule,
  type VoiceStatePatch,
  type VoiceStateSection,
} from './voice-state-model'

export type { VoiceStateEntry, VoiceStatePatch, VoiceStateSection } from './voice-state-model'
export { VOICE_STATE_SECTION } from './voice-state-model'

/** Merge the project's voiceState over a schedule dump; seed the section on first open. */
export async function applyProjectVoiceState(path: string, data: GnauralScheduleData): Promise<GnauralScheduleData> {
  const stored = await readProjectSectionFor<VoiceStateSection>(path, VOICE_STATE_SECTION)
  if (stored === null || typeof stored !== 'object') {
    writeProjectSectionFor(path, VOICE_STATE_SECTION, seedVoiceStateFromSchedule(data))
    return data
  }
  return mergeVoiceStateIntoSchedule(data, stored)
}

/** Persist UI patches: read the current section (pending-write aware), merge, write back. */
export async function writeVoiceStatePatches(
  path: string,
  patches: readonly VoiceStatePatch[],
  seedFallback: GnauralScheduleData | null,
): Promise<void> {
  const stored = await readProjectSectionFor<VoiceStateSection>(path, VOICE_STATE_SECTION)
  const base: VoiceStateSection = stored !== null && typeof stored === 'object'
    ? stored
    : seedFallback !== null
      ? seedVoiceStateFromSchedule(seedFallback)
      : {}
  writeProjectSectionFor(path, VOICE_STATE_SECTION, mergeVoiceStatePatchesInto(base, patches))
}
