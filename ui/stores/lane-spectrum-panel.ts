// VS2.7 (VS-D3 rev 3, owner): the per-lane solo-spectrum settings live in a standard
// dockable/detachable @panel window, exactly like the overall spectrum's «Параметры»
// (stores/spectrum-settings-panel.ts) — not a q-dialog. ONE panel instance, retargeted to the lane
// whose gear was clicked (the SG-D7 pattern: the overall group also runs one retargetable panel).
//
// Not a Pinia store despite living here: usePanelWindowState keeps a module-level singleton per
// panelId, which is how the gear (TracksPanel) and the host (AudioPage's dock-wrap) reach the same
// object without prop plumbing. The target lane id rides along as a module-level ref for the same
// reason — the dialog component and TracksPanel are far apart in the tree.
import { ref, type Ref } from 'vue'
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const LANE_SPECTRUM_PANEL_ID = 'lane-spectrum-settings'

export function useLaneSpectrumPanelState(): PanelWindowState {
  return usePanelWindowState(LANE_SPECTRUM_PANEL_ID, {
    defaultMode: 'floating',
    defaultDockSize: 320,
  })
}

/** The lane the panel currently edits (null until a gear is clicked). */
const laneSpectrumTarget: Ref<number | null> = ref(null)

export function useLaneSpectrumTarget(): Ref<number | null> {
  return laneSpectrumTarget
}
