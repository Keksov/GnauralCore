import { describe, expect, test } from 'bun:test'

import { DEFAULT_SPECTROGRAM_SETTINGS, type SpectrogramSettings } from './spectrogram-settings'
import {
  channelOverride,
  clearBothOverride,
  clearChannelOverride,
  emptyOverrides,
  ensureChannelOverride,
  isChannelIndividual,
  loadOverrides,
  setBothOverride,
  setChannelOverride,
} from './overall-spectrum-overrides'

function settings(gain: number): SpectrogramSettings {
  return { ...DEFAULT_SPECTROGRAM_SETTINGS, gain }
}

describe('overall-spectrum-overrides (SG3.1)', () => {
  test('empty = both channels inherit the program level', () => {
    const o = emptyOverrides()
    expect(channelOverride(o, 0)).toBeNull()
    expect(channelOverride(o, 1)).toBeNull()
    expect(isChannelIndividual(o, 0)).toBe(false)
    expect(isChannelIndividual(o, 1)).toBe(false)
  })

  test('setChannel affects ONLY that channel; the other still inherits', () => {
    const o = setChannelOverride(emptyOverrides(), 0, settings(42))
    expect(channelOverride(o, 0)?.gain).toBe(42)
    expect(isChannelIndividual(o, 0)).toBe(true)
    expect(channelOverride(o, 1)).toBeNull()
    expect(isChannelIndividual(o, 1)).toBe(false)
  })

  test('channels 0 (L/mono) and 1 (R) are independent slots', () => {
    let o = setChannelOverride(emptyOverrides(), 0, settings(3))
    o = setChannelOverride(o, 1, settings(7))
    expect(channelOverride(o, 0)?.gain).toBe(3)
    expect(channelOverride(o, 1)?.gain).toBe(7)
    // slot() is defensive: any non-1 index reads the L slot, never throws
    expect(channelOverride(o, 5)?.gain).toBe(3)
  })

  test('clearChannel reverts a channel back to inherit, leaving the other', () => {
    let o = setBothOverride(settings(9))
    o = clearChannelOverride(o, 0)
    expect(isChannelIndividual(o, 0)).toBe(false)
    expect(channelOverride(o, 1)?.gain).toBe(9)
  })

  test('setChannel/setBoth clone the settings (no shared reference)', () => {
    const src = settings(3)
    const o = setChannelOverride(emptyOverrides(), 0, src)
    src.gain = 99
    expect(channelOverride(o, 0)?.gain).toBe(3)
  })

  test('ensureChannel seeds from the program level only when absent; keeps an existing override', () => {
    let o = ensureChannelOverride(emptyOverrides(), 0, settings(11))
    expect(channelOverride(o, 0)?.gain).toBe(11)
    // a second ensure with a different seed must NOT overwrite the existing individual settings
    o = ensureChannelOverride(o, 0, settings(22))
    expect(channelOverride(o, 0)?.gain).toBe(11)
  })

  test('setBoth writes both channels; clearBoth resets both to inherit', () => {
    let o = setBothOverride(settings(5))
    expect(channelOverride(o, 0)?.gain).toBe(5)
    expect(channelOverride(o, 1)?.gain).toBe(5)
    o = clearBothOverride()
    expect(isChannelIndividual(o, 0)).toBe(false)
    expect(isChannelIndividual(o, 1)).toBe(false)
  })

  test('loadOverrides tolerates junk and merges partial stored settings', () => {
    expect(loadOverrides(null)).toEqual(emptyOverrides())
    expect(loadOverrides('nope')).toEqual(emptyOverrides())
    const loaded = loadOverrides({ 0: { gain: 8 }, 1: null })
    expect(loaded[0]?.gain).toBe(8)
    // a merged partial still carries the full defaulted schema
    expect(loaded[0]?.palette).toBe(DEFAULT_SPECTROGRAM_SETTINGS.palette)
    expect(loaded[1]).toBeNull()
  })
})
