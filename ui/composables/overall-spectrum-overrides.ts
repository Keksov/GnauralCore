// SG3.1 (SG-D7): per-CHANNEL individual overrides for the OVERALL spectrogram group.
// Channel 0 = Left (or Mono), 1 = Right. A `null` entry means "inherit the program-level settings"
// (the global useSpectrogramStore, edited via the Audio window's Меню→Настройки dialog, SG1.1).
//
// This module is the PURE state + transforms, so the resolution semantics (individual-else-program)
// are unit-tested without Pinia/DOM. stores/overall-spectrum-overrides.ts is the reactive + persisted
// wrapper the app uses. Modelled on the gtrack per-lane override (use-gtrack-lanes.ts laneSpectrum),
// but keyed by CHANNEL and global (the overall L/R channels are structural, like the program level
// they fall back to — not per-file the way gtrack lanes are).
import { mergeStoredSettings, type SpectrogramSettings } from './spectrogram-settings'

export interface SpectrumOverrides {
  0: SpectrogramSettings | null
  1: SpectrogramSettings | null
  /** SG3.5 (owner, WS-D9 mirror): «Оба канала» is a PEER GROUP with its own settings — editing it
   *  never touches the per-channel slots (and vice versa). Which group is IN EFFECT is decided by
   *  the link toggle: linked → `both`, unlinked → the per-channel slots (see effectiveOverride). */
  both: SpectrogramSettings | null
}

export function emptyOverrides(): SpectrumOverrides {
  return { 0: null, 1: null, both: null }
}

/** 0 = Left/Mono, anything else = Right — so callers can pass a raw channel index safely. */
function slot(ch: number): 0 | 1 {
  return ch === 1 ? 1 : 0
}

export function channelOverride(o: SpectrumOverrides, ch: number): SpectrogramSettings | null {
  return o[slot(ch)]
}

export function isChannelIndividual(o: SpectrumOverrides, ch: number): boolean {
  return channelOverride(o, ch) !== null
}

export function setChannelOverride(o: SpectrumOverrides, ch: number, settings: SpectrogramSettings): SpectrumOverrides {
  return { ...o, [slot(ch)]: { ...settings } }
}

export function clearChannelOverride(o: SpectrumOverrides, ch: number): SpectrumOverrides {
  return { ...o, [slot(ch)]: null }
}

/** Turn on the channel's override if absent, seeding from `seed` (usually the program-level settings). */
export function ensureChannelOverride(o: SpectrumOverrides, ch: number, seed: SpectrogramSettings): SpectrumOverrides {
  return isChannelIndividual(o, ch) ? o : setChannelOverride(o, ch, seed)
}

export function bothOverride(o: SpectrumOverrides): SpectrogramSettings | null {
  return o.both
}

/** SG3.5 (supersedes SG-D7's bulk write): «Оба» writes its OWN group slot, channels untouched. */
export function setBothOverride(o: SpectrumOverrides, settings: SpectrogramSettings): SpectrumOverrides {
  return { ...o, both: { ...settings } }
}

export function clearBothOverride(o: SpectrumOverrides): SpectrumOverrides {
  return { ...o, both: null }
}

/** The override IN EFFECT for a rendered channel: the «Оба» group while linked, else the channel's
 *  own slot; null = inherit the program level either way. */
export function effectiveOverride(o: SpectrumOverrides, linked: boolean, ch: number): SpectrogramSettings | null {
  return linked ? o.both : channelOverride(o, ch)
}

export function loadOverrides(raw: unknown): SpectrumOverrides {
  if (typeof raw !== 'object' || raw === null) return emptyOverrides()
  const p = raw as Record<string, unknown>
  return {
    0: p['0'] !== undefined && p['0'] !== null ? mergeStoredSettings(p['0']) : null,
    1: p['1'] !== undefined && p['1'] !== null ? mergeStoredSettings(p['1']) : null,
    // Pre-SG3.5 storage has no group slot -> inherit (the old bulk-written values stay on 0/1).
    both: p['both'] !== undefined && p['both'] !== null ? mergeStoredSettings(p['both']) : null,
  }
}
