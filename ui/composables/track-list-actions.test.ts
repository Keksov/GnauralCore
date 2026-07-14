import { describe, expect, test } from 'bun:test'

import { applyTrackListAction, type TrackListActionContext } from './track-list-actions'
import type { TrackListAction } from './track-list-model'

// A recording double: every context method pushes `[method, ...args]` onto `calls`, so a test can
// assert exactly which authoritative call an action produced. fixPreparseVoice's return is scripted.
function makeCtx(fixResult = true): { ctx: TrackListActionContext; calls: unknown[][]; fixed: () => number } {
  const calls: unknown[][] = []
  let fixedCount = 0
  const rec = (name: string) => (...args: unknown[]): void => { calls.push([name, ...args]) }
  const ctx: TrackListActionContext = {
    gtracks: {
      mergeAllIntoOneLane: rec('mergeAllIntoOneLane'),
      spreadPerVoiceLanes: rec('spreadPerVoiceLanes'),
      showAllModesPerVoice: rec('showAllModesPerVoice'),
      setAllLanesHidden: rec('setAllLanesHidden'),
      setAllLanesMode: rec('setAllLanesMode'),
      setVoiceMode: rec('setVoiceMode'),
      setVoiceVisible: rec('setVoiceVisible'),
      setVoiceInMix: rec('setVoiceInMix'),
      setPointDragMode: rec('setPointDragMode'),
      fixPreparseVoice: (voiceId: number): boolean => { calls.push(['fixPreparseVoice', voiceId]); return fixResult },
    },
    overall: {
      setWaveHidden: rec('setWaveHidden'),
      setSpectrumHidden: rec('setSpectrumHidden'),
    },
    toggleVoiceMuted: rec('toggleVoiceMuted'),
    onFixed: (): void => { fixedCount += 1 },
  }
  return { ctx, calls, fixed: () => fixedCount }
}

describe('applyTrackListAction (PW5.7b)', () => {
  const cases: ReadonlyArray<readonly [TrackListAction, unknown[]]> = [
    [{ kind: 'merge-all' }, ['mergeAllIntoOneLane']],
    [{ kind: 'spread-all' }, ['spreadPerVoiceLanes']],
    [{ kind: 'show-all-modes' }, ['showAllModesPerVoice']],
    [{ kind: 'set-all-hidden', hidden: true }, ['setAllLanesHidden', true]],
    [{ kind: 'set-all-mode', mode: 'beat' }, ['setAllLanesMode', 'beat']],
    [{ kind: 'set-voice-mode', voiceId: 7, mode: 'base' }, ['setVoiceMode', 7, 'base']],
    [{ kind: 'set-voice-visible', voiceId: 7, visible: false }, ['setVoiceVisible', 7, false]],
    [{ kind: 'toggle-voice-muted', voiceId: 9 }, ['toggleVoiceMuted', 9]],
    [{ kind: 'set-voice-in-mix', voiceId: 9, inMix: true }, ['setVoiceInMix', 9, true]],
    [{ kind: 'set-point-drag-mode', mode: 'clamp' }, ['setPointDragMode', 'clamp']],
    [{ kind: 'set-wave-hidden', hidden: false }, ['setWaveHidden', false]],
    [{ kind: 'set-spectrum-hidden', hidden: true }, ['setSpectrumHidden', true]],
  ]

  for (const [action, expected] of cases) {
    test(`${action.kind} -> ${String(expected[0])}`, () => {
      const { ctx, calls } = makeCtx()
      applyTrackListAction(action, ctx)
      expect(calls).toEqual([expected])
    })
  }

  test('mute routes through the toggleVoiceMuted callback, not gtracks', () => {
    const { ctx, calls } = makeCtx()
    applyTrackListAction({ kind: 'toggle-voice-muted', voiceId: 3 }, ctx)
    expect(calls).toEqual([['toggleVoiceMuted', 3]])
  })

  test('fix-preparse calls onFixed only when the voice was actually fixed', () => {
    const ok = makeCtx(true)
    applyTrackListAction({ kind: 'fix-preparse', voiceId: 5 }, ok.ctx)
    expect(ok.calls).toEqual([['fixPreparseVoice', 5]])
    expect(ok.fixed()).toBe(1)

    const noop = makeCtx(false)
    applyTrackListAction({ kind: 'fix-preparse', voiceId: 5 }, noop.ctx)
    expect(noop.calls).toEqual([['fixPreparseVoice', 5]])
    expect(noop.fixed()).toBe(0)
  })
})
