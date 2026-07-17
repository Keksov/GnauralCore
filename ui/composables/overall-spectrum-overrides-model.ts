// SG3.2b (SG-D6/SG-D7, the PW5.7 «пульт» pattern): the JSON-SERIALIZABLE contract between the
// in-window per-graph «Параметры» panel and its detached child window. The parent pushes an
// OverridesSnapshot (both channel overrides + the program level + the preset list) to the child, and
// every gesture crosses back as ONE OverridesAction over the bridge. The child holds NO store (SS-D3)
// and keeps the scope selector LOCALLY — the action carries the scope so the authoritative main
// window knows which channel(s) to write. Nothing here may reference a class, function or proxy.
import type { SpectrogramSettings } from './spectrogram-settings'
import type { SpectrumPresetSnapshot } from './spectrum-settings-model'

/** The scope a gesture targets: «Оба канала» (both) or one channel. */
export type OverrideScope = 'both' | 0 | 1

/** Everything the per-graph view renders, flat and serializable. */
export interface OverridesSnapshot {
  /** The program-level defaults (edited via Меню→Настройки) — the inherit fallback. */
  readonly program: SpectrogramSettings
  /** The LEFT channel's individual override, or null = inherit the program level. */
  readonly channel0: SpectrogramSettings | null
  /** The RIGHT channel's individual override, or null = inherit. */
  readonly channel1: SpectrogramSettings | null
  /** SG3.5 (owner, WS-D9 mirror): the «Оба канала» PEER GROUP's own settings, or null = inherit.
   *  Editing it never touches the channels; it is what renders while the link toggle is ON. */
  readonly both: SpectrogramSettings | null
  readonly presets: readonly SpectrumPresetSnapshot[]
  /** SG3.4 (owner): «Применить к обоим каналам» — the waveform-dialog link analog. While ON the
   *  «Левый»/«Правый» scopes are locked in the view, so the channels cannot diverge. */
  readonly linkChannels: boolean
}

// Every gesture the view can perform, as one serializable union (discriminated by `kind`), each
// qualified by the active scope. Field edits are `set-field`; presets apply to the scope; `reset`
// clears the scope's override(s) back to the program level. Preset MANAGEMENT (save/rename/…) is not
// here — the per-graph panel only APPLIES presets (the library is managed from the program dialog).
export type OverridesAction =
  | { readonly kind: 'set-field'; readonly scope: OverrideScope; readonly key: keyof SpectrogramSettings; readonly value: string | number }
  | { readonly kind: 'apply-preset'; readonly scope: OverrideScope; readonly id: string }
  | { readonly kind: 'reset'; readonly scope: OverrideScope }
  // SG3.4: flip «Применить к обоим каналам». Scope-free — it is panel-level UI state, not a write
  // to a channel; it still crosses the detach bridge as an action so the MAIN window stays the
  // single writer of the persisted flag.
  | { readonly kind: 'set-link'; readonly value: boolean }

function scopeOverride(snapshot: OverridesSnapshot, scope: OverrideScope): SpectrogramSettings | null {
  if (scope === 'both') return snapshot.both
  return scope === 1 ? snapshot.channel1 : snapshot.channel0
}

/** What the form shows for a scope: its OWN group's override if set, else the program level.
 *  SG3.5: «Оба» is a peer group (WS-D9 mirror) — it shows its own slot, never a channel's. */
export function displayedForScope(snapshot: OverridesSnapshot, scope: OverrideScope): SpectrogramSettings {
  return scopeOverride(snapshot, scope) ?? snapshot.program
}

/** «Сброс» is enabled when the scope's own group has anything to clear. */
export function scopeHasOverride(snapshot: OverridesSnapshot, scope: OverrideScope): boolean {
  return scopeOverride(snapshot, scope) !== null
}

/** The main-window side that applies a (possibly bridged) action to the authoritative stores. Both
 *  the in-window adapter and the detached-panel bridge handler call this — never the child. */
export interface OverridesActionContext {
  readonly overrides: {
    getChannel: (ch: number) => SpectrogramSettings | null
    setChannel: (ch: number, settings: SpectrogramSettings) => void
    clearChannel: (ch: number) => void
    /** SG3.5: the «Оба» PEER GROUP's slot (a mono host maps all three onto its single entry). */
    getBoth: () => SpectrogramSettings | null
    setBoth: (settings: SpectrogramSettings) => void
    clearBoth: () => void
  }
  /** The program-level settings (the inherit fallback when a scope has no override). */
  readonly program: SpectrogramSettings
  /** Resolve a preset id to its settings (the child snapshot carries only id/name/builtin). */
  readonly findPreset: (id: string) => SpectrogramSettings | undefined
  /** SG3.4: persist the «Применить к обоим каналам» flag. Optional — a MONO host (the per-lane
   *  panel, VS2.7) has no channels to link and never shows the toggle. */
  readonly setLinkChannels?: (value: boolean) => void
}

export function applyOverridesAction(action: OverridesAction, ctx: OverridesActionContext): void {
  // What the scope currently shows (its own group's override ?? program) — the seed for an edit.
  const displayed = (scope: OverrideScope): SpectrogramSettings => {
    const o = scope === 'both' ? ctx.overrides.getBoth() : ctx.overrides.getChannel(scope)
    return o ?? ctx.program
  }
  // SG3.5: «Оба» writes its OWN group slot (WS-D9 mirror), never the channels.
  const write = (scope: OverrideScope, settings: SpectrogramSettings): void => {
    if (scope === 'both') ctx.overrides.setBoth(settings)
    else ctx.overrides.setChannel(scope, settings)
  }

  switch (action.kind) {
    case 'set-field': {
      // SG-D8 auto-individual: seed the override from the displayed settings (the program level while
      // inheriting) plus the one changed field.
      const base: SpectrogramSettings = { ...displayed(action.scope) }
      ;(base as unknown as Record<string, string | number>)[action.key] = action.value
      write(action.scope, base)
      break
    }
    case 'apply-preset': {
      const settings = ctx.findPreset(action.id)
      if (settings === undefined) return
      write(action.scope, settings)
      break
    }
    case 'reset': {
      if (action.scope === 'both') ctx.overrides.clearBoth()
      else ctx.overrides.clearChannel(action.scope)
      break
    }
    case 'set-link': {
      ctx.setLinkChannels?.(action.value)
      break
    }
  }
}
