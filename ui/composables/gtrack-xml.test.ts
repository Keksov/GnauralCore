import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { GnauralScheduleData } from '@protocol'

import { GTrackModel } from './gtrack-model'
import { GTrackXmlError, formatXmlNumber, patchGnauralXml, serializeVoiceEntries } from './gtrack-xml'

const STANDARD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- keep me: a comment that must survive the patch -->
<gnaural>
  <title>RT Test</title>
  <author>test</author>
  <schedule_description>round-trip</schedule_description>
  <loops>1</loops>
  <overallvolume_left>0.85</overallvolume_left>
  <overallvolume_right>0.85</overallvolume_right>
  <stereoswap>0</stereoswap>
  <voice>
    <id>1</id>
    <type>0</type>
    <description>carrier</description>
    <voice_mute>0</voice_mute>
    <voice_mono>0</voice_mono>
    <mindwave_unknown_field>preserve-me</mindwave_unknown_field>
    <mindwave_color>#88c0d0</mindwave_color>
    <entries>
      <entry duration="8" basefreq="144" beatfreq="24" volume_left="0.00" volume_right="0.00"/>
      <entry duration="12" basefreq="144" beatfreq="22" volume_left="0.45" volume_right="0.45"/>
      <entry duration="20" basefreq="140" beatfreq="18" volume_left="0.55" volume_right="0.55"/>
    </entries>
  </voice>
  <voice>
    <id>2</id>
    <type>1</type>
    <description>noise</description>
    <voice_mute>0</voice_mute>
    <voice_mono>1</voice_mono>
    <mindwave_color>#4c566a</mindwave_color>
    <entries>
      <entry duration="10" basefreq="0" beatfreq="0" volume_left="0.00" volume_right="0.00"/>
      <entry duration="40" basefreq="0" beatfreq="0" volume_left="0.12" volume_right="0.12"/>
    </entries>
  </voice>
</gnaural>
`

const PREPARSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gnaural>
  <title>Preparse</title>
  <loops>1</loops>
  <voice>
    <id>0</id>
    <type>0</type>
    <description>gen</description>
    <entries>
      <entry type="preparse" generator="circle.exe" steps="60" duration="60"/>
    </entries>
  </voice>
</gnaural>
`

describe('formatXmlNumber (GT1.2)', () => {
  test('integers plain, decimals trimmed, no exponent', () => {
    expect(formatXmlNumber(144)).toBe('144')
    expect(formatXmlNumber(0)).toBe('0')
    expect(formatXmlNumber(0.45)).toBe('0.45')
    expect(formatXmlNumber(0.5)).toBe('0.5')
    expect(formatXmlNumber(0.1)).toBe('0.1')
    expect(formatXmlNumber(1e-7)).toBe('0') // below 6-dp precision -> 0
    expect(() => formatXmlNumber(Number.NaN)).toThrow(GTrackXmlError)
  })
})

describe('serializeVoiceEntries (GT1.2)', () => {
  test('M+1 points -> M entries; beatfreq = 2*half', () => {
    const model = new GTrackModel({
      title: '', author: '', description: '', totalTimeSec: 20, loopCount: 1,
      overallVolL: 1, overallVolR: 1, stereoSwap: false, voiceCount: 1,
      voices: [{
        id: 1, type: 'tone', typeIndex: 0, description: '', hidden: false, muted: false,
        mono: false, color: null, audioFilePath: '', totalDurationSec: 20, entryCount: 2,
        entries: [
          { startSec: 0, endSec: 8, durationSec: 8, baseFreqStart: 144, baseFreqEnd: 144, beatFreqHalfStart: 12, beatFreqHalfEnd: 11, volLStart: 0, volLEnd: 0.45, volRStart: 0, volREnd: 0.45 },
          { startSec: 8, endSec: 20, durationSec: 12, baseFreqStart: 144, baseFreqEnd: 140, beatFreqHalfStart: 11, beatFreqHalfEnd: 9, volLStart: 0.45, volLEnd: 0.55, volRStart: 0.45, volREnd: 0.55 },
        ],
      }],
    })
    const voice = model.schedule.voices[0]!
    expect(voice.points.length).toBe(3)
    const xml = serializeVoiceEntries(voice, '  ')
    const lines = xml.split('\n')
    expect(lines.length).toBe(2) // 3 points -> 2 entries
    expect(lines[0]).toBe('  <entry duration="8" basefreq="144" beatfreq="24" volume_left="0" volume_right="0"/>')
    expect(lines[1]).toBe('  <entry duration="12" basefreq="144" beatfreq="22" volume_left="0.45" volume_right="0.45"/>')
  })
})

describe('patchGnauralXml (GT1.2)', () => {
  test('replaces only <entries>; preserves comment, metadata, unknown fields, untouched voices', () => {
    const model = new GTrackModel(standardXmlAsDump())
    // Edit voice 1: change P1 base 144 -> 150.
    model.edit(() => model.setPointField(1, 1, 'baseFreq', 150))
    const out = patchGnauralXml(STANDARD_XML, model.schedule)

    expect(out).toContain('<!-- keep me: a comment that must survive the patch -->')
    expect(out).toContain('<mindwave_unknown_field>preserve-me</mindwave_unknown_field>')
    expect(out).toContain('<title>RT Test</title>')
    // Voice 1, entry 2 now has basefreq 150.
    expect(out).toContain('basefreq="150"')
    // Voice 2 (untouched) still has its original noise entries.
    expect(out).toContain('duration="40" basefreq="0" beatfreq="0" volume_left="0.12" volume_right="0.12"')
    // Structure remains valid-ish: two voices, two <entries> blocks.
    expect(out.match(/<entries>/g)?.length).toBe(2)
  })

  test('bakes a preparse voice into concrete per-point entries', () => {
    // Hand-build a 2-point model for voice 0 (preparse has no usable dump here).
    const model = new GTrackModel({
      title: '', author: '', description: '', totalTimeSec: 60, loopCount: 1,
      overallVolL: 1, overallVolR: 1, stereoSwap: false, voiceCount: 1,
      voices: [{
        id: 0, type: 'tone', typeIndex: 0, description: 'gen', hidden: false, muted: false,
        mono: false, color: null, audioFilePath: '', totalDurationSec: 60, entryCount: 2,
        entries: [
          { startSec: 0, endSec: 30, durationSec: 30, baseFreqStart: 100, baseFreqEnd: 200, beatFreqHalfStart: 2, beatFreqHalfEnd: 3, volLStart: 0.5, volLEnd: 0.5, volRStart: 0.5, volREnd: 0.5 },
          { startSec: 30, endSec: 60, durationSec: 30, baseFreqStart: 200, baseFreqEnd: 200, beatFreqHalfStart: 3, beatFreqHalfEnd: 3, volLStart: 0.5, volLEnd: 0.5, volRStart: 0.5, volREnd: 0.5 },
        ],
      }],
    })
    const out = patchGnauralXml(PREPARSE_XML, model.schedule)
    expect(out).not.toContain('type="preparse"')
    expect(out).toContain('basefreq="100"')
    expect(out).toContain('beatfreq="4"') // 2*2
    expect(out.match(/<entry /g)?.length).toBe(2) // 3 points -> 2 concrete entries
  })

  test('throws when a scheduled voice is missing from the XML', () => {
    const model = new GTrackModel({
      title: '', author: '', description: '', totalTimeSec: 1, loopCount: 1,
      overallVolL: 1, overallVolR: 1, stereoSwap: false, voiceCount: 1,
      voices: [{
        id: 999, type: 'tone', typeIndex: 0, description: '', hidden: false, muted: false,
        mono: false, color: null, audioFilePath: '', totalDurationSec: 1, entryCount: 1,
        entries: [{ startSec: 0, endSec: 1, durationSec: 1, baseFreqStart: 1, baseFreqEnd: 1, beatFreqHalfStart: 0, beatFreqHalfEnd: 0, volLStart: 0, volLEnd: 0, volRStart: 0, volREnd: 0 }],
      }],
    })
    expect(() => patchGnauralXml(STANDARD_XML, model.schedule)).toThrow(GTrackXmlError)
  })
})

// --- Integration round-trip through the real Gnaural.exe (skips if the exe is absent) ------------

const EXE = resolve(import.meta.dir, '..', '..', 'cli', 'build', 'x64', 'Gnaural.exe')
const HAS_EXE = existsSync(EXE)

function dumpFile(filePath: string): GnauralScheduleData {
  const proc = Bun.spawnSync([EXE, '--dump-schedule', filePath], { cwd: dirname(EXE) })
  if (proc.exitCode !== 0) {
    throw new Error(`dump failed (${proc.exitCode}): ${proc.stderr.toString()}`)
  }
  return JSON.parse(proc.stdout.toString()) as GnauralScheduleData
}

// Hand-built dump equal to what Gnaural.exe --dump-schedule yields for STANDARD_XML, so the pure
// (exe-free) tests can build a model without spawning the binary. The integration block below uses
// the REAL dump instead.
function standardXmlAsDump(): GnauralScheduleData {
  return {
    title: 'RT Test', author: 'test', description: 'round-trip', totalTimeSec: 40, loopCount: 1,
    overallVolL: 0.85, overallVolR: 0.85, stereoSwap: false, voiceCount: 2,
    voices: [
      {
        id: 1, type: 'binaural', typeIndex: 0, description: 'carrier', hidden: false, muted: false,
        mono: false, color: '#88c0d0', audioFilePath: '', totalDurationSec: 40, entryCount: 3,
        entries: [
          { startSec: 0, endSec: 8, durationSec: 8, baseFreqStart: 144, baseFreqEnd: 144, beatFreqHalfStart: 12, beatFreqHalfEnd: 11, volLStart: 0, volLEnd: 0.45, volRStart: 0, volREnd: 0.45 },
          { startSec: 8, endSec: 20, durationSec: 12, baseFreqStart: 144, baseFreqEnd: 140, beatFreqHalfStart: 11, beatFreqHalfEnd: 9, volLStart: 0.45, volLEnd: 0.55, volRStart: 0.45, volREnd: 0.55 },
          { startSec: 20, endSec: 40, durationSec: 20, baseFreqStart: 140, baseFreqEnd: 140, beatFreqHalfStart: 9, beatFreqHalfEnd: 9, volLStart: 0.55, volLEnd: 0.55, volRStart: 0.55, volREnd: 0.55 },
        ],
      },
      {
        id: 2, type: 'pink_noise', typeIndex: 1, description: 'noise', hidden: false, muted: false,
        mono: true, color: '#4c566a', audioFilePath: '', totalDurationSec: 50, entryCount: 2,
        entries: [
          { startSec: 0, endSec: 10, durationSec: 10, baseFreqStart: 0, baseFreqEnd: 0, beatFreqHalfStart: 0, beatFreqHalfEnd: 0, volLStart: 0, volLEnd: 0.12, volRStart: 0, volREnd: 0.12 },
          { startSec: 10, endSec: 50, durationSec: 40, baseFreqStart: 0, baseFreqEnd: 0, beatFreqHalfStart: 0, beatFreqHalfEnd: 0, volLStart: 0.12, volLEnd: 0, volRStart: 0.12, volREnd: 0 },
        ],
      },
    ],
  }
}

describe.if(HAS_EXE)('patchGnauralXml round-trip via Gnaural.exe (GT1.2 gate)', () => {
  test('edit -> patch -> dump reproduces the edited model within tolerance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gtrack-rt-'))
    try {
      const srcPath = join(dir, 'src.gnaural')
      writeFileSync(srcPath, STANDARD_XML)

      // Establish the model from the REAL dump of the source.
      const model = new GTrackModel(dumpFile(srcPath))

      // Edit voice 1: move P1 in time (8 -> 6) and change its base freq (144 -> 150).
      model.edit(() => {
        model.movePoint(1, 1, 6)
        model.setPointField(1, 1, 'baseFreq', 150)
      })
      const edited = model.schedule

      // Patch the original XML from the edited model and re-dump.
      const patched = patchGnauralXml(STANDARD_XML, edited)
      const outPath = join(dir, 'out.gnaural')
      writeFileSync(outPath, patched)
      const reModel = new GTrackModel(dumpFile(outPath))

      // Compare every voice's points field-by-field.
      expect(reModel.schedule.voices.length).toBe(edited.voices.length)
      for (let vi = 0; vi < edited.voices.length; vi += 1) {
        const a = edited.voices[vi]!
        const b = reModel.schedule.voices[vi]!
        expect(b.id).toBe(a.id)
        expect(b.points.length).toBe(a.points.length)
        for (let pi = 0; pi < a.points.length; pi += 1) {
          const pa = a.points[pi]!
          const pb = b.points[pi]!
          expect(pb.timeSec).toBeCloseTo(pa.timeSec, 3)
          expect(pb.baseFreq).toBeCloseTo(pa.baseFreq, 3)
          expect(pb.beatFreqHalf).toBeCloseTo(pa.beatFreqHalf, 3)
          expect(pb.volL).toBeCloseTo(pa.volL, 3)
          expect(pb.volR).toBeCloseTo(pa.volR, 3)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
