// GT4.3 (GT-D17): produce a "solo" .gnaural — only the given voice ids audible, every other voice
// muted — so the server can render a per-lane solo spectrum/waveform (the audio of exactly a lane's
// voice set). Pure string transform (no DOM), so it runs in the server render path and under bun.

const VOICE_BLOCK = /<voice\b[^>]*>[\s\S]*?<\/voice>/g
const VOICE_ID = /<id>\s*(-?\d+)\s*<\/id>/
const VOICE_MUTE = /<voice_mute>[\s\S]*?<\/voice_mute>/

/**
 * Return `xml` with every voice's `<voice_mute>` normalized to solo membership: voices whose `<id>`
 * is in `soloVoiceIds` are unmuted (`0`), all others muted (`1`). A voice with no `<voice_mute>` tag
 * gets one inserted before `</voice>`. Voices without an `<id>` are left untouched. An empty solo
 * set mutes everything (silence) — callers pass a non-empty set.
 */
export function muteNonSoloVoices(xml: string, soloVoiceIds: readonly number[]): string {
  const solo = new Set(soloVoiceIds)
  return xml.replace(VOICE_BLOCK, (block) => {
    const idMatch = VOICE_ID.exec(block)
    if (idMatch === null) return block
    const value = solo.has(Number(idMatch[1])) ? "0" : "1"
    if (VOICE_MUTE.test(block)) {
      return block.replace(VOICE_MUTE, `<voice_mute>${value}</voice_mute>`)
    }
    return block.replace(/<\/voice>/, `  <voice_mute>${value}</voice_mute>\n  </voice>`)
  })
}

/**
 * project-store PR2.4 (PR-D11, owner req 9): stamp explicit `<voice_mute>` values from the
 * project's voiceState section onto the XML before a render — the file's own (possibly stale)
 * tags are overridden for voices present in the map and left untouched otherwise. Same mechanics
 * as muteNonSoloVoices; pure string transform.
 */
export function applyVoiceMuteMap(xml: string, muteById: ReadonlyMap<number, boolean>): string {
  if (muteById.size === 0) return xml
  return xml.replace(VOICE_BLOCK, (block) => {
    const idMatch = VOICE_ID.exec(block)
    if (idMatch === null) return block
    const muted = muteById.get(Number(idMatch[1]))
    if (muted === undefined) return block
    const value = muted ? "1" : "0"
    if (VOICE_MUTE.test(block)) {
      return block.replace(VOICE_MUTE, `<voice_mute>${value}</voice_mute>`)
    }
    return block.replace(/<\/voice>/, `  <voice_mute>${value}</voice_mute>\n  </voice>`)
  })
}
