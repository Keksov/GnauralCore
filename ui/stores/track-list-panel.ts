// PW5.2 (PW-D9): window state for the «Список треков» (track list) panel — the SECOND consumer of
// the universal @panel control, mirroring stores/file-open-panel.ts. It is a NEW panel, so it uses
// the default mindwave-panel-track-list-* localStorage keys (no legacy key mapping). Default: a
// floating window (the safest first-open mode); the user can dock it left/right/top/bottom or
// detach it (PW5.5) from the panel's own dock menu.
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const TRACK_LIST_PANEL_ID = 'track-list'

export function useTracksListPanelState(): PanelWindowState {
  return usePanelWindowState(TRACK_LIST_PANEL_ID, {
    defaultMode: 'floating',
    defaultDockSize: 300,
  })
}
