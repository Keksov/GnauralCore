import { describe, expect, test } from 'bun:test'

import type { GnauralScheduleData } from '@protocol'

import { GTrackModel, type GTrackPoint, type GTrackSchedule, type GTrackVoice } from './gtrack-model'
import { lintSchedule, type GTrackLintRule } from './gtrack-lint'

function pt(timeSec: number, volL: number, volR: number, baseFreq = 200, beatFreqHalf = 5): GTrackPoint {
  return { timeSec, volL, volR, baseFreq, beatFreqHalf }
}

function voice(id: number, points: GTrackPoint[], extra: Partial<GTrackVoice> = {}): GTrackVoice {
  return {
    id, type: 'binaural', typeIndex: 0, description: `v${id}`, mono: false, color: null,
    audioFilePath: '', points, preparse: false, ...extra,
  }
}

function sched(voices: GTrackVoice[], loopCount = 1): GTrackSchedule {
  return { title: '', author: '', description: '', totalTimeSec: 100, loopCount,
    overallVolL: 1, overallVolR: 1, stereoSwap: false, voices }
}

const rules = (s: GTrackSchedule): GTrackLintRule[] => lintSchedule(s).map((d) => d.rule)

describe('lintSchedule (GT9.1 / GT-D21)', () => {
  test('end-click: a voice ending at non-zero volume is flagged; ending at zero is not', () => {
    const loud = sched([voice(0, [pt(0, 0.5, 0.5), pt(10, 0.73, 0.73)])])
    const diags = lintSchedule(loud)
    expect(diags.some((d) => d.rule === 'end-click')).toBe(true)
    const clickAt = diags.find((d) => d.rule === 'end-click')!
    expect(clickAt.voiceId).toBe(0)
    expect(clickAt.pointIndex).toBe(1) // the last point
    expect(clickAt.timeSec).toBe(10)

    const faded = sched([voice(0, [pt(0, 0.5, 0.5), pt(9.9, 0.5, 0.5), pt(10, 0, 0)])])
    expect(rules(faded)).not.toContain('end-click')
  })

  test('loop-click: only when loopCount>1 and end volume != start volume', () => {
    const pts = [pt(0, 0.2, 0.2), pt(10, 0.8, 0.8)] // start 0.2 != end 0.8
    expect(rules(sched([voice(0, pts)], 57))).toContain('loop-click') // loops -> seam click
    expect(rules(sched([voice(0, pts)], 1))).not.toContain('loop-click') // single pass -> no seam
    const even = [pt(0, 0.3, 0.3), pt(10, 0.3, 0.3)] // start == end
    expect(rules(sched([voice(0, even)], 100))).not.toContain('loop-click')
  })

  test('degenerate-tail: last segment ~zero duration (SummerSunshine 1e-13)', () => {
    const s = sched([voice(0, [pt(0, 0.5, 0.5), pt(50, 0.5, 0.5), pt(50 + 1e-13, 0.1, 0.15)])])
    const diags = lintSchedule(s)
    expect(diags.some((d) => d.rule === 'degenerate-tail')).toBe(true)
    // also end-click (ends at 0.15 > 0): both fire on this voice
    expect(diags.some((d) => d.rule === 'end-click')).toBe(true)
  })

  test('zero-run: >=2 consecutive zero-duration segments (CandyWreck)', () => {
    // 4 points at the same time = 3 consecutive zero-duration segments.
    const s = sched([voice(0, [pt(0, 0.4, 0.4), pt(9, 0.4, 0.4), pt(9, 0.3, 0.3), pt(9, 0.2, 0.2), pt(9, 0, 0)])])
    const zr = lintSchedule(s).filter((d) => d.rule === 'zero-run')
    expect(zr.length).toBe(1)
    expect(zr[0]!.pointIndex).toBe(1)
  })

  test('extreme-value: NaN is an error; denormal + out-of-range are warnings', () => {
    const nan = lintSchedule(sched([voice(0, [pt(0, 0.5, 0.5), pt(10, Number.NaN, 0.5)])]))
    const ev = nan.find((d) => d.rule === 'extreme-value')!
    expect(ev.severity).toBe('error')

    const denorm = lintSchedule(sched([voice(0, [pt(0, 4e-70, 0.5), pt(10, 0, 0)])])) // Penfold 4e-70
    expect(denorm.some((d) => d.rule === 'extreme-value' && d.severity === 'warning')).toBe(true)

    const over = lintSchedule(sched([voice(0, [pt(0, 1.5, 0.5), pt(10, 0, 0)])]))
    expect(over.some((d) => d.rule === 'extreme-value')).toBe(true)
  })

  test('missing-audiofile: a pcm voice with no source path', () => {
    const noFile = sched([voice(1, [pt(0, 0.3, 0.3), pt(10, 0, 0)], { typeIndex: 2, type: 'pcm', audioFilePath: '' })])
    expect(rules(noFile)).toContain('missing-audiofile')
    const withFile = sched([voice(1, [pt(0, 0.3, 0.3), pt(10, 0, 0)], { typeIndex: 2, type: 'pcm', audioFilePath: 'clip.wav' })])
    expect(rules(withFile)).not.toContain('missing-audiofile')
  })

  test('a clean schedule (fade to zero, single pass) yields no diagnostics', () => {
    const clean = sched([
      voice(0, [pt(0, 0.5, 0.5), pt(30, 0.6, 0.6), pt(30.1, 0, 0)]),
      voice(1, [pt(0, 0.2, 0.2), pt(60, 0.2, 0.2), pt(60.1, 0, 0)]),
    ], 1)
    expect(lintSchedule(clean)).toEqual([])
  })

  test('errors sort before warnings', () => {
    const s = sched([voice(0, [pt(0, 0.5, 0.5), pt(10, Number.POSITIVE_INFINITY, 0.9)])]) // error + end-click warning
    const diags = lintSchedule(s)
    expect(diags[0]!.severity).toBe('error')
  })
})

// One loud tonal voice (ends at 0.7), as a dump the model can load.
function loudDump(loopCount = 1): GnauralScheduleData {
  return {
    title: '', author: '', description: '', totalTimeSec: 10, loopCount,
    overallVolL: 1, overallVolR: 1, stereoSwap: false, voiceCount: 1,
    voices: [{
      id: 0, type: 'binaural', typeIndex: 0, description: 'v', hidden: false, muted: false,
      mono: false, color: null, audioFilePath: '', totalDurationSec: 10, entryCount: 1,
      entries: [{ startSec: 0, endSec: 10, durationSec: 10, baseFreqStart: 200, baseFreqEnd: 200,
        beatFreqHalfStart: 5, beatFreqHalfEnd: 5, volLStart: 0.2, volLEnd: 0.7, volRStart: 0.2, volREnd: 0.7 }],
    }],
  }
}

describe('GT9.3 auto-fix operations clear the diagnostic (model + lint)', () => {
  test('end-fade: insert a point 0.1s before the end + drive the last point to zero', () => {
    const model = new GTrackModel(loudDump())
    expect(lintSchedule(model.schedule).some((d) => d.rule === 'end-click')).toBe(true)
    model.edit(() => {
      const pts = model.schedule.voices[0]!.points
      const endTime = pts[pts.length - 1]!.timeSec
      model.insertPoint(0, endTime - 0.1)
      const v = model.schedule.voices.find((x) => x.id === 0)!
      model.setPointFields(0, v.points.length - 1, { volL: 0, volR: 0 })
    })
    expect(lintSchedule(model.schedule).some((d) => d.rule === 'end-click')).toBe(false)
  })

  test('loop-align: matching the last point volume to the first clears the loop-click', () => {
    const model = new GTrackModel(loudDump(5)) // loops -> seam click (start 0.2 != end 0.7)
    expect(lintSchedule(model.schedule).some((d) => d.rule === 'loop-click')).toBe(true)
    model.edit(() => {
      const pts = model.schedule.voices[0]!.points
      const first = pts[0]!
      model.setPointFields(0, pts.length - 1, { volL: first.volL, volR: first.volR })
    })
    expect(lintSchedule(model.schedule).some((d) => d.rule === 'loop-click')).toBe(false)
  })
})
