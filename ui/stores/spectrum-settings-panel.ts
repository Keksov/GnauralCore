// SS1.1 (SS-D1): window state for the «Параметры» (spectrogram settings) panel — the THIRD consumer
// of the universal @panel control, mirroring stores/track-list-panel.ts. It is a NEW panel, so it
// uses the default mindwave-panel-spectrum-settings-* localStorage keys: unlike file-open (which had
// to keep its legacy mindwave-fs-browser-* keys), there is nothing to stay compatible with — the
// panel's visibility was never persisted at all, it was a plain local ref in TracksPanel (SF3.1).
//
// Not a Pinia store despite living here: usePanelWindowState keeps a module-level singleton per
// panelId, which is exactly why the toggle button (TracksPanel's toolbar) and the host (AudioPage)
// reach the same object without any prop plumbing.
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const SPECTRUM_SETTINGS_PANEL_ID = 'spectrum-settings'

export function useSpectrumSettingsPanelState(): PanelWindowState {
  return usePanelWindowState(SPECTRUM_SETTINGS_PANEL_ID, {
    defaultMode: 'floating',
    defaultDockSize: 320,
  })
}
