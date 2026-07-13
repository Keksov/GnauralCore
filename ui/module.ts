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
  ],
} as const