// SS3.1 (SS-D2, the PW5.7 «пульт» pattern): the shared, JSON-SERIALIZABLE contract between the
// in-window «Параметры» panel and its detached child window. A snapshot is pushed to the child and
// every gesture crosses back as ONE action over a BroadcastChannel — so nothing here may reference a
// class, a function, or a reactive proxy. Keep it plain data.
import type { SpectrogramSettings } from './spectrogram-settings'

/** A preset as the list renders it — no settings payload needed to display/apply it. */
export interface SpectrumPresetSnapshot {
  readonly id: string
  readonly name: string
  readonly builtin: boolean
}

/** Everything the view renders, flat and serializable. */
export interface SpectrumSettingsSnapshot {
  readonly settings: SpectrogramSettings
  readonly presets: readonly SpectrumPresetSnapshot[]
  readonly activePresetId: string | null
  readonly isModified: boolean
}

// Every gesture the view can perform, as one serializable union (discriminated by `kind`). Field
// edits are `set`; the rest mirror the store's preset actions. Export is NOT here — it is a local
// download (read-only), done in-window.
export type SpectrumSettingsAction =
  | { readonly kind: 'set'; readonly key: keyof SpectrogramSettings; readonly value: string | number }
  | { readonly kind: 'reset' }
  | { readonly kind: 'apply-preset'; readonly id: string }
  | { readonly kind: 'save-as'; readonly name: string }
  | { readonly kind: 'update-preset'; readonly id: string }
  | { readonly kind: 'rename-preset'; readonly id: string; readonly name: string }
  | { readonly kind: 'delete-preset'; readonly id: string }
  | { readonly kind: 'duplicate-preset'; readonly id: string }
  | { readonly kind: 'import-presets'; readonly json: string }
