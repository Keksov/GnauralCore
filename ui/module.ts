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
} as const