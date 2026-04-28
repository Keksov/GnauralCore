import { defineAsyncComponent } from 'vue'
import messages from './i18n'

const GnauralSettingsTab = defineAsyncComponent(() => import('./settings/GnauralSettingsTab.vue'))

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
  settingsTabs: [
    {
      name: 'audio',
      icon: 'graphic_eq',
      labelKey: 'settings.audioTab',
      component: GnauralSettingsTab,
    },
  ],
} as const