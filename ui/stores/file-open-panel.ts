// PW1.2 (PW-D3): the file-open panel's window state, served by the universal panel composable
// (@panel). The legacy storage keys keep every FB4.x-era persisted value (mode/geometry/open)
// working without migration; prevMode is new and gets the default 'mindwave-panel-*' key.
import { usePanelWindowState, type PanelWindowState } from '@panel/use-panel-window'

export const FILE_OPEN_PANEL_ID = 'file-open'

const LEGACY_PREFIX = 'mindwave-fs-browser-'

export function useFileOpenPanelState(): PanelWindowState {
  return usePanelWindowState(FILE_OPEN_PANEL_ID, {
    storageKeys: {
      mode: `${LEGACY_PREFIX}win-mode`,
      dockSize: `${LEGACY_PREFIX}dock-size`,
      floatRect: `${LEGACY_PREFIX}float`,
      open: `${LEGACY_PREFIX}open`,
    },
  })
}
