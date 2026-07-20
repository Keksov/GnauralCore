// UG3.1 (undo-global-journal, UG-D5): window state for the «Журнал операций» (undo operations)
// panel — the next consumer of the universal @panel control, mirroring stores/track-list-panel.ts.
// A NEW panel, so it uses the default mindwave-panel-undo-journal-* localStorage keys.
//
// Not a Pinia store despite living here: usePanelWindowState keeps a module-level singleton per
// panelId, which is exactly why the toggle button (TracksPanel's toolbar) and the host (AudioPage)
// reach the same object without any prop plumbing.
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const UNDO_JOURNAL_PANEL_ID = 'undo-journal'

export function useUndoJournalPanelState(): PanelWindowState {
  return usePanelWindowState(UNDO_JOURNAL_PANEL_ID, {
    defaultMode: 'floating',
    defaultDockSize: 320,
  })
}
