import { describe, expect, test } from "bun:test"

import { muteNonSoloVoices } from "./gnaural-solo-render"

const XML = `<gnaural>
  <voice><id>0</id><voice_mute>0</voice_mute><entries/></voice>
  <voice><id>1</id><voice_mute>0</voice_mute><entries/></voice>
  <voice><id>2</id><entries/></voice>
</gnaural>`

describe("muteNonSoloVoices (GT4.3 / GT-D17)", () => {
  test("solo=[1]: only voice 1 audible; others muted; a missing tag is inserted", () => {
    const out = muteNonSoloVoices(XML, [1])
    expect(/<id>0<\/id><voice_mute>1<\/voice_mute>/.test(out)).toBe(true) // muted
    expect(/<id>1<\/id><voice_mute>0<\/voice_mute>/.test(out)).toBe(true) // audible
    expect(out).toContain("<id>2</id>")
    expect((out.match(/<voice_mute>1<\/voice_mute>/g) ?? []).length).toBe(2) // voices 0 and 2
    expect((out.match(/<voice_mute>0<\/voice_mute>/g) ?? []).length).toBe(1) // voice 1
  })

  test("a multi-voice solo set unmutes exactly that set", () => {
    const out = muteNonSoloVoices(XML, [0, 2])
    expect((out.match(/<voice_mute>0<\/voice_mute>/g) ?? []).length).toBe(2) // voices 0, 2
    expect((out.match(/<voice_mute>1<\/voice_mute>/g) ?? []).length).toBe(1) // voice 1 muted
  })

  test("an empty solo set mutes every voice", () => {
    const out = muteNonSoloVoices(XML, [])
    expect((out.match(/<voice_mute>1<\/voice_mute>/g) ?? []).length).toBe(3)
    expect(out.includes("<voice_mute>0</voice_mute>")).toBe(false)
  })

  test("a voice without an <id> is left untouched", () => {
    const noId = `<gnaural><voice><entries/></voice></gnaural>`
    expect(muteNonSoloVoices(noId, [1])).toBe(noId)
  })
})

describe("applyVoiceMuteMap (project-store PR2.4)", () => {
  const XML = [
    "<gnaural>",
    "<voice><id>0</id><voice_mute>1</voice_mute><entries/></voice>",
    "<voice><id>1</id><entries/></voice>",
    "<voice><id>2</id><voice_mute>0</voice_mute><entries/></voice>",
    "</gnaural>",
  ].join("\n")

  test("stamps mapped voices (overriding stale tags), leaves unmapped voices untouched", async () => {
    const { applyVoiceMuteMap } = await import("./gnaural-solo-render")
    const out = applyVoiceMuteMap(XML, new Map([[0, false], [1, true]]))
    expect(out.includes("<voice><id>0</id><voice_mute>0</voice_mute><entries/></voice>")).toBe(true)
    expect(out.includes("<voice_mute>1</voice_mute>")).toBe(true) // voice 1 got a tag inserted
    expect(out.includes("<voice><id>2</id><voice_mute>0</voice_mute><entries/></voice>")).toBe(true) // untouched
  })

  test("an empty map returns the input unchanged", async () => {
    const { applyVoiceMuteMap } = await import("./gnaural-solo-render")
    expect(applyVoiceMuteMap(XML, new Map())).toBe(XML)
  })
})
