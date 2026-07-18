// SF23.3: Audacity-style audio view mode for the «Треки» overall graphs — waveform / spectrogram /
// both / overlay. Extracted from TracksPanel.vue (viewmode-graph-header VH-D5) so the shared
// ViewModeDropdown.vue and TracksPanel import one source of truth (no duplicated list, no cycle).
export type AudioViewMode = 'waveform' | 'spectrogram' | 'both' | 'overlay'

// Order shown in the dropdown menu.
export const AUDIO_VIEW_MODES: readonly AudioViewMode[] = ['both', 'overlay', 'spectrogram', 'waveform']
