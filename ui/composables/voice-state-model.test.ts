import { describe, expect, test } from 'bun:test'

import type { GnauralScheduleData } from '@protocol'

import {
  mergeVoiceStateIntoSchedule,
  mergeVoiceStatePatchesInto,
  seedVoiceStateFromSchedule,
} from './voice-state-model'

function schedule(): GnauralScheduleData {
  const voice = (id: number, over: Partial<GnauralScheduleData['voices'][number]> = {}) => ({
    id,
    type: 'tone',
    typeIndex: 0,
    description: `v${id}`,
    hidden: false,
    muted: false,
    mono: false,
    color: '#111111',
    audioFilePath: '',
    totalDurationSec: 10,
    entryCount: 0,
    entries: [],
    ...over,
  })
  return {
    title: 'T',
    author: 'A',
    description: 'D',
    totalTimeSec: 10,
    loopCount: 1,
    overallVolL: 1,
    overallVolR: 1,
    stereoSwap: false,
    voiceCount: 2,
    voices: [voice(1), voice(2, { color: '#222222', muted: true })],
  }
}

describe('voice-state section (project-store PR2.4 / PR-D11)', () => {
  test('merge overlays only the fields an entry carries; unknown voices keep file values', () => {
    const merged = mergeVoiceStateIntoSchedule(schedule(), {
      '1': { muted: true },
      '999': { hidden: true },
    })
    expect(merged.voices[0]).toMatchObject({ id: 1, muted: true, hidden: false, color: '#111111' })
    expect(merged.voices[1]).toMatchObject({ id: 2, muted: true, color: '#222222' })
  })

  test('seed captures the file values for every voice (one-time migration)', () => {
    const seeded = seedVoiceStateFromSchedule(schedule())
    expect(seeded['1']).toEqual({ color: '#111111', hidden: false, muted: false })
    expect(seeded['2']).toEqual({ color: '#222222', hidden: false, muted: true })
  })

  test('patch merge is immutable, per-field, and stacks over existing entries', () => {
    const base = seedVoiceStateFromSchedule(schedule())
    const next = mergeVoiceStatePatchesInto(base, [
      { voiceId: 1, muted: true },
      { voiceId: 1, color: '#ABCDEF' },
      { voiceId: 3, hidden: true },
    ])
    expect(next['1']).toEqual({ color: '#ABCDEF', hidden: false, muted: true })
    expect(next['3']).toEqual({ hidden: true })
    expect(base['1']).toEqual({ color: '#111111', hidden: false, muted: false })
  })
})
