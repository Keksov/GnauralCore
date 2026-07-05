import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  mergeStoredSettings,
  mergeStoredUserPresets,
  presetSettings,
  settingsEqual,
  SPECTROGRAM_PRESETS,
  toAnalysisParams,
  toRenderOptions,
  type SpectrogramPresetName,
  type SpectrogramSettings,
  type SpectrogramUserPreset,
} from '../composables/spectrogram-settings'

type MutableSpectrogramSettings = { -readonly [K in keyof SpectrogramSettings]: SpectrogramSettings[K] }

const STORAGE_KEY = 'mindwave-spectrogram-settings'
const PRESETS_KEY = 'mindwave-spectrogram-user-presets'
const ACTIVE_KEY = 'mindwave-spectrogram-active-preset'

/** A preset as the UI consumes it (built-in or user), with a stable id. */
export interface SpectrogramPresetEntry {
  readonly id: string
  readonly name: string
  readonly settings: SpectrogramSettings
  readonly builtin: boolean
}

function loadStoredSettings(): SpectrogramSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return mergeStoredSettings(raw === null ? null : (JSON.parse(raw) as unknown))
  } catch {
    return { ...DEFAULT_SPECTROGRAM_SETTINGS }
  }
}

function persistSettings(aSettings: SpectrogramSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(aSettings))
  } catch {
    // storage unavailable -> ignore
  }
}

function loadUserPresets(): SpectrogramUserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    return mergeStoredUserPresets(raw === null ? null : (JSON.parse(raw) as unknown))
  } catch {
    return []
  }
}

function persistUserPresets(aPresets: readonly SpectrogramUserPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(aPresets))
  } catch {
    // ignore
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function persistActiveId(aId: string | null): void {
  try {
    if (aId === null) localStorage.removeItem(ACTIVE_KEY)
    else localStorage.setItem(ACTIVE_KEY, aId)
  } catch {
    // ignore
  }
}

function newPresetId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`
}

/**
 * Spectrogram settings store (U4.1) + preset manager (SF18). `renderOptions` and
 * `analysisParams` are derived groups consumed by the view (DU5). Built-in presets are
 * read-only; user presets persist to localStorage. `activePresetId` + `isModified` drive
 * the panel's preset UI.
 */
export const useSpectrogramStore = defineStore('spectrogram', () => {
  const settings = reactive<MutableSpectrogramSettings>(loadStoredSettings())
  const userPresets = ref<SpectrogramUserPreset[]>(loadUserPresets())
  const activePresetId = ref<string | null>(loadActiveId())

  const renderOptions = computed(() => toRenderOptions(settings))
  const analysisParams = computed(() => toAnalysisParams(settings))

  // built-in presets first, then user presets — the unified list the UI renders.
  const allPresets = computed<SpectrogramPresetEntry[]>(() => [
    ...SPECTROGRAM_PRESETS.map((p) => ({ id: p.name, name: p.label, settings: p.settings, builtin: true })),
    ...userPresets.value.map((p) => ({ id: p.id, name: p.name, settings: p.settings, builtin: false })),
  ])

  const activePreset = computed<SpectrogramPresetEntry | null>(() =>
    activePresetId.value === null
      ? null
      : allPresets.value.find((p) => p.id === activePresetId.value) ?? null,
  )

  // true when the live settings diverge from the active preset (drives the "*" badge).
  const isModified = computed(
    () => activePreset.value !== null && !settingsEqual(settings, activePreset.value.settings),
  )

  // persistence (U4.2 + SF18)
  watch(settings, () => persistSettings(settings), { deep: true })
  watch(userPresets, () => persistUserPresets(userPresets.value), { deep: true })
  watch(activePresetId, () => persistActiveId(activePresetId.value))

  function reset(): void {
    Object.assign(settings, DEFAULT_SPECTROGRAM_SETTINGS)
    activePresetId.value = null
  }

  function applyPresetById(aId: string): void {
    const preset = allPresets.value.find((p) => p.id === aId)
    if (preset === undefined) return
    Object.assign(settings, preset.settings)
    activePresetId.value = aId
  }

  // Back-compat: apply a built-in preset by its name.
  function applyPreset(aName: SpectrogramPresetName): void {
    const preset = presetSettings(aName)
    if (preset !== null) {
      Object.assign(settings, preset)
      activePresetId.value = aName
    }
  }

  /** Save the current settings as a new user preset; returns its id and selects it. */
  function saveAsPreset(aName: string): string {
    const id = newPresetId()
    const name = aName.trim() === '' ? 'Preset' : aName.trim()
    userPresets.value = [...userPresets.value, { id, name, settings: { ...settings } }]
    activePresetId.value = id
    return id
  }

  /** Overwrite an existing user preset with the current settings. */
  function updatePreset(aId: string): void {
    userPresets.value = userPresets.value.map((p) =>
      p.id === aId ? { ...p, settings: { ...settings } } : p,
    )
  }

  function renamePreset(aId: string, aName: string): void {
    const name = aName.trim()
    if (name === '') return
    userPresets.value = userPresets.value.map((p) => (p.id === aId ? { ...p, name } : p))
  }

  function deletePreset(aId: string): void {
    userPresets.value = userPresets.value.filter((p) => p.id !== aId)
    if (activePresetId.value === aId) activePresetId.value = null
  }

  /** Duplicate any preset (built-in or user) into a new user preset; returns its id. */
  function duplicatePreset(aId: string, aName?: string): string | null {
    const src = allPresets.value.find((p) => p.id === aId)
    if (src === undefined) return null
    const id = newPresetId()
    const name = (aName ?? `${src.name} copy`).trim() || `${src.name} copy`
    userPresets.value = [...userPresets.value, { id, name, settings: { ...src.settings } }]
    return id
  }

  /** Serialize the user presets for export (JSON string). */
  function exportPresets(): string {
    return JSON.stringify(userPresets.value, null, 2)
  }

  /** Import presets from a JSON string; fresh ids avoid collisions. Returns the count added. */
  function importPresets(aJson: string): number {
    let parsed: unknown
    try {
      parsed = JSON.parse(aJson)
    } catch {
      return 0
    }
    const incoming = mergeStoredUserPresets(parsed).map((p) => ({ ...p, id: newPresetId() }))
    if (incoming.length > 0) userPresets.value = [...userPresets.value, ...incoming]
    return incoming.length
  }

  return {
    settings,
    renderOptions,
    analysisParams,
    userPresets,
    activePresetId,
    activePreset,
    allPresets,
    isModified,
    reset,
    applyPreset,
    applyPresetById,
    saveAsPreset,
    updatePreset,
    renamePreset,
    deletePreset,
    duplicatePreset,
    exportPresets,
    importPresets,
  }
})
