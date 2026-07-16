// SS3.1 (SS-D2): the SINGLE apply function for «Параметры» actions, used on BOTH sides — the
// in-window adapter applies straight to the store, the detached parent applies bridged actions. The
// context is typed structurally (no Vue/Pinia imports) so it is unit-testable with a fake, and the
// real spectrogram store satisfies it as-is.
import type { SpectrogramSettings } from './spectrogram-settings'
import type { SpectrumSettingsAction } from './spectrum-settings-model'

type MutableSettings = { -readonly [K in keyof SpectrogramSettings]: SpectrogramSettings[K] }

/** The slice of the spectrogram store applySpectrumSettingsAction needs. */
export interface SpectrumSettingsActionContext {
  readonly settings: MutableSettings
  reset(): void
  applyPresetById(id: string): void
  saveAsPreset(name: string): string
  updatePreset(id: string): void
  renamePreset(id: string, name: string): void
  deletePreset(id: string): void
  duplicatePreset(id: string, name?: string): string | null
  importPresets(json: string): number
}

/** Total switch over the action union — one context call per kind, no dialogs/notifications. */
export function applySpectrumSettingsAction(
  action: SpectrumSettingsAction,
  ctx: SpectrumSettingsActionContext,
): void {
  switch (action.kind) {
    case 'set':
      // The field kind guarantees the runtime type; the store's reactive settings persist via watch.
      (ctx.settings as Record<string, string | number>)[action.key] = action.value
      break
    case 'reset':
      ctx.reset()
      break
    case 'apply-preset':
      ctx.applyPresetById(action.id)
      break
    case 'save-as':
      ctx.saveAsPreset(action.name)
      break
    case 'update-preset':
      ctx.updatePreset(action.id)
      break
    case 'rename-preset':
      ctx.renamePreset(action.id, action.name)
      break
    case 'delete-preset':
      ctx.deletePreset(action.id)
      break
    case 'duplicate-preset':
      ctx.duplicatePreset(action.id)
      break
    case 'import-presets':
      ctx.importPresets(action.json)
      break
  }
}
