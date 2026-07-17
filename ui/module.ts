import messages from './i18n'

export const gnauralModule = {
  id: 'gnaural',
  messages,
  routes: [
    {
      name: 'gnaural.audio',
      path: 'audio',
      navLabelKey: 'nav.audio',
      component: () => import('./pages/AudioPage.vue'),
    },
  ],
  // GT10.17 (owner req. 66): the audio settings moved INTO the Audio tab (dialog); the general
  // Settings page no longer hosts them.
  settingsTabs: [],
  // PW2.1 (PW-D4): panels this module can show in a detached child window. The content component
  // is the same one PanelWindow hosts in the main window; 'open' events are forwarded over the
  // panel bridge back to the main window (PW2.2).
  panels: [
    {
      id: 'file-open',
      titleKey: 'fsBrowser.title',
      icon: 'folder_open',
      component: () => import('./components/FileOpenPanel.vue'),
      events: ['open'],
    },
    // PW5.7c: «Список треков» detached content is the remote adapter — it renders the parent-pushed
    // snapshot and bridges each gesture back as one serializable 'action' (no child-side gtracks or
    // localStorage, PW-D11). The parent (TrackListDialog) applies the action to the shared singletons.
    {
      id: 'track-list',
      titleKey: 'audio.tracksListPanel',
      icon: 'queue_music',
      component: () => import('./components/TrackListRemote.vue'),
      events: ['action'],
    },
    // SG3.2b (SG-D6/SS-D3): «Параметры» detached content is the PER-GRAPH remote adapter — it renders
    // the parent-pushed OverridesSnapshot and bridges each gesture back as one scope-qualified 'action'
    // (no child-side override store, SS-D3). SpectrumSettingsDialog applies the action to the stores.
    {
      id: 'spectrum-settings',
      titleKey: 'audio.spectrogramSettingsTitle',
      icon: 'tune',
      component: () => import('./components/SpectrogramOverridesRemote.vue'),
      events: ['action'],
    },
    // VS2.7 (VS-D3 rev 3): the per-LANE solo-spectrum panel detaches the same way — its child content
    // is the mono twin of the remote above; LaneSpectrumSettingsDialog applies the bridged actions.
    {
      id: 'lane-spectrum-settings',
      titleKey: 'audio.gtrackSpectrumTitle',
      icon: 'tune',
      component: () => import('./components/LaneSpectrumSettingsRemote.vue'),
      events: ['action'],
    },
  ],
} as const