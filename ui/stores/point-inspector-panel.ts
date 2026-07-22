// PI2.2 (point-inspector-panel): window state for the «Параметры точки» inspector panel — a consumer
// of the universal @panel control, mirroring stores/track-list-panel.ts / undo-journal-panel.ts. It is
// a NEW panel, so it uses the default mindwave-panel-point-inspector-* localStorage keys (no legacy
// mapping). Default: a small floating window; the user can dock it left/right/top/bottom from the
// panel's own dock menu. Detach is OFF in Phase 2 (PI-D2) — the dialog passes :allow-detach="false".
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const POINT_INSPECTOR_PANEL_ID = 'point-inspector'

export function usePointInspectorPanelState(): PanelWindowState {
  return usePanelWindowState(POINT_INSPECTOR_PANEL_ID, {
    defaultMode: 'floating',
    defaultDockSize: 320,
    minFloatW: 300,
    minFloatH: 260,
  })
}
