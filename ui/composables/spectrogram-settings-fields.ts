// SS2.1 (SS-D5/SS-D6): shared shapes for the data-driven «Параметры» panel, extracted from
// SpectrogramSettingsPanel so the field renderer (SpectrogramSettingsFields) and the block layout
// (the panel itself) can share the Field/Group types without a circular import. `clamp` is the one
// piece of pure logic here and is unit-tested; the field builders stay in the panel because they
// need the i18n `t()`.
import type { SpectrogramSettings } from './spectrogram-settings'

export type SelectableKey = keyof SpectrogramSettings

export interface SliderSpec {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

// SF16.1: numeric spinbox spec (min/max/step + rounding decimals for the -/+ steppers).
export interface SpinSpec {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly decimals: number
}

export interface Field {
  readonly key: SelectableKey
  readonly kind: 'select' | 'number' | 'slider' | 'spin'
  readonly label: string
  readonly help: string
  readonly options?: { label: string; value: string | number }[]
  readonly slider?: SliderSpec
  readonly spin?: SpinSpec
}

export interface Group {
  readonly key: string
  readonly title: string
  readonly fields: Field[]
}

// SF16.1: round to the spec step (kills FP drift from repeated +/-), then bound to [min,max].
export function clamp(aValue: number, aSpec: SpinSpec): number {
  const stepped = Math.round(aValue / aSpec.step) * aSpec.step
  const bounded = Math.min(aSpec.max, Math.max(aSpec.min, stepped))
  return Number(bounded.toFixed(aSpec.decimals))
}

// SS2.1 (SS-D4, owner req 3/4/8): the tiles<->accordion rule. Tiles need two blocks to fit side by
// side, so the switch is at 2*MIN_BLOCK + gap; below that the panel is a single-column accordion.
// MIN_BLOCK is the narrowest a block's controls stay usable at (the old fixed panel was 300px, so
// 280 leaves room for two + a gap in a ~580px window; owner confirms the feel at SS2.2).
export const SPECTRUM_BLOCK_MIN_PX = 280
// SS2.5: the tiles grid is now gapless (one shared border between neighbours), so two blocks fit at
// exactly 2*MIN, no inter-block gap to add.
export const SPECTRUM_BLOCK_GAP_PX = 0
export const SPECTRUM_TILES_THRESHOLD_PX = 2 * SPECTRUM_BLOCK_MIN_PX + SPECTRUM_BLOCK_GAP_PX

export type SpectrumLayout = 'tiles' | 'accordion'

export function layoutForWidth(aWidthPx: number): SpectrumLayout {
  return aWidthPx >= SPECTRUM_TILES_THRESHOLD_PX ? 'tiles' : 'accordion'
}
