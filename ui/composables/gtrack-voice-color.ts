// PW5.6c: shared voice-dot colour. Fallback palette matches GTrackView so the panel dots line up
// with the lane curves. Extracted from TracksPanel so it + TrackListPanel share ONE implementation.
import type { GTrackVoice } from './gtrack-model'

const VOICE_FALLBACK_COLORS = ['#67e8f9', '#fbbf24', '#a3be8c', '#f472b6', '#c084fc', '#f87171']
const VOICE_HEX = /^#[0-9a-fA-F]{6}$/

export function voiceDotColor(voice: GTrackVoice, index: number): string {
  return voice.color !== null && VOICE_HEX.test(voice.color)
    ? voice.color
    : VOICE_FALLBACK_COLORS[index % VOICE_FALLBACK_COLORS.length]!
}
