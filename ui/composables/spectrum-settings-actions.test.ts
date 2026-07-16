import { describe, expect, test } from 'bun:test'

import { DEFAULT_SPECTROGRAM_SETTINGS } from './spectrogram-settings'
import { applySpectrumSettingsAction, type SpectrumSettingsActionContext } from './spectrum-settings-actions'

// A fake store that records calls, so the apply function can be tested without Vue/Pinia.
function makeCtx() {
  const calls: string[] = []
  const ctx: SpectrumSettingsActionContext = {
    settings: { ...DEFAULT_SPECTROGRAM_SETTINGS },
    reset() {
      calls.push('reset')
    },
    applyPresetById(id) {
      calls.push(`apply:${id}`)
    },
    saveAsPreset(name) {
      calls.push(`saveAs:${name}`)
      return 'new-id'
    },
    updatePreset(id) {
      calls.push(`update:${id}`)
    },
    renamePreset(id, name) {
      calls.push(`rename:${id}:${name}`)
    },
    deletePreset(id) {
      calls.push(`delete:${id}`)
    },
    duplicatePreset(id) {
      calls.push(`duplicate:${id}`)
      return 'dup-id'
    },
    importPresets(json) {
      calls.push(`import:${json}`)
      return 1
    },
  }
  return { ctx, calls }
}

describe('applySpectrumSettingsAction (SS3.1)', () => {
  test('set mutates the settings record at the given key', () => {
    const { ctx, calls } = makeCtx()
    applySpectrumSettingsAction({ kind: 'set', key: 'gain', value: 42 }, ctx)
    expect(ctx.settings.gain).toBe(42)
    // a plain field edit touches nothing else.
    expect(calls).toEqual([])
  })

  test('set works for string-valued keys too', () => {
    const { ctx } = makeCtx()
    applySpectrumSettingsAction({ kind: 'set', key: 'palette', value: 'pink' }, ctx)
    expect(ctx.settings.palette).toBe('pink' as never)
  })

  test('each preset/reset action routes to exactly one store method', () => {
    const { ctx, calls } = makeCtx()
    applySpectrumSettingsAction({ kind: 'reset' }, ctx)
    applySpectrumSettingsAction({ kind: 'apply-preset', id: 'p1' }, ctx)
    applySpectrumSettingsAction({ kind: 'save-as', name: 'My preset' }, ctx)
    applySpectrumSettingsAction({ kind: 'update-preset', id: 'p2' }, ctx)
    applySpectrumSettingsAction({ kind: 'rename-preset', id: 'p3', name: 'Renamed' }, ctx)
    applySpectrumSettingsAction({ kind: 'delete-preset', id: 'p4' }, ctx)
    applySpectrumSettingsAction({ kind: 'duplicate-preset', id: 'p5' }, ctx)
    applySpectrumSettingsAction({ kind: 'import-presets', json: '[]' }, ctx)
    expect(calls).toEqual([
      'reset',
      'apply:p1',
      'saveAs:My preset',
      'update:p2',
      'rename:p3:Renamed',
      'delete:p4',
      'duplicate:p5',
      'import:[]',
    ])
  })

  test('every action is JSON-serializable (crosses the bridge unchanged)', () => {
    const actions = [
      { kind: 'set', key: 'gain', value: 42 },
      { kind: 'reset' },
      { kind: 'apply-preset', id: 'p1' },
      { kind: 'save-as', name: 'x' },
      { kind: 'rename-preset', id: 'p', name: 'n' },
      { kind: 'import-presets', json: '[]' },
    ]
    for (const a of actions) {
      expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    }
  })
})
