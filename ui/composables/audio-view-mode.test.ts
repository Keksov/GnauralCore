import { describe, expect, test } from 'bun:test'
import ru from '../i18n/ru.json'
import en from '../i18n/en.json'
import { AUDIO_VIEW_MODES, type AudioViewMode } from './audio-view-mode'

// viewmode-graph-header: the shared list feeds both TracksPanel (persist/gating) and the
// icon-only ViewModeDropdown. Guard the contract the dropdown renders against.
describe('AUDIO_VIEW_MODES', () => {
  test('is exactly the four Audacity-style modes (unique)', () => {
    expect([...AUDIO_VIEW_MODES].sort()).toEqual(['both', 'overlay', 'spectrogram', 'waveform'])
    expect(new Set(AUDIO_VIEW_MODES).size).toBe(AUDIO_VIEW_MODES.length)
  })

  test('every mode has a ru + en label (audio.viewMode_<m>)', () => {
    for (const m of AUDIO_VIEW_MODES) {
      const key = `viewMode_${m}` as const
      expect((ru.audio as Record<string, string>)[key], `ru ${key}`).toBeTruthy()
      expect((en.audio as Record<string, string>)[key], `en ${key}`).toBeTruthy()
    }
  })

  test('type accepts each listed mode', () => {
    const roundtrip: AudioViewMode[] = [...AUDIO_VIEW_MODES]
    expect(roundtrip).toContain('both')
  })
})
