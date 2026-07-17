<template>
  <!-- VS2.7 (VS-D3 rev 3, owner): the per-lane solo-spectrum settings in the SAME standard
       dockable/detachable @panel chrome as the overall spectrum's «Параметры» (SpectrumSettingsDialog
       is the model). The content is the SAME pure form (SpectrogramOverridesView) in mono mode; only
       the data binding differs — the lane's single laneSpectrum override instead of the overall
       per-channel overrides. One panel instance, retargeted to the last-clicked lane (SG-D7 pattern).
       Detach mirrors SS-D3: the child owns no store — PanelWindow pushes `snapshot`, and the child
       (LaneSpectrumSettingsRemote) bridges each gesture back as one 'action', applied HERE to the
       authoritative lane override. -->
  <PanelWindow
    :state="panel"
    :title="t('audio.gtrackSpectrumTitle')"
    icon="tune"
    :bridge-state="snapshot"
    @panel-event="onBridgedEvent"
  >
    <div class="lane-spectrum-dialog__body">
      <SpectrogramOverridesView mono :snapshot="snapshot" @action="applyAction" />
    </div>
  </PanelWindow>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { QSpinnerHourglass } from 'quasar'
import PanelWindow from '@panel/PanelWindow.vue'
import { useLaneSpectrumPanelState, useLaneSpectrumTarget } from '../stores/lane-spectrum-panel'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { useSpectrogramStore } from '../stores/spectrogram'
import {
  applyOverridesAction,
  type OverridesAction,
  type OverridesSnapshot,
} from '../composables/overall-spectrum-overrides-model'

// Kept lazy (as SpectrumSettingsDialog keeps its panel): the editor pulls in the whole spectrogram
// form, so it stays out of the eager chunk until a lane gear is clicked.
const AsyncPanelLoading = defineComponent({
  name: 'AsyncLaneSpectrumLoading',
  setup() {
    return () => h('div', { class: 'lane-spectrum-dialog__placeholder' }, [
      h(QSpinnerHourglass, { color: 'primary', size: '28px' }),
    ])
  },
})
const SpectrogramOverridesView = defineAsyncComponent({
  loader: () => import('./SpectrogramOverridesView.vue'),
  delay: 120,
  loadingComponent: AsyncPanelLoading,
})

const { t } = useI18n()
const panel = useLaneSpectrumPanelState()
const targetLaneId = useLaneSpectrumTarget()
const gtracks = useSharedGtrackLanes()
const spectrogramStore = useSpectrogramStore()

// VS2.4/VS2.7: the channel-based OverridesSnapshot contract fits a MONO lane naturally — the single
// laneSpectrum override plays both "channels", so displayedForScope/scopeHasOverride and the SG-D8
// auto-individual seeding all work unchanged over the one entry.
const snapshot = computed<OverridesSnapshot>(() => {
  const id = targetLaneId.value
  const o = id === null ? null : gtracks.getLaneSpectrum(id)
  const override = o === null ? null : { ...o }
  return {
    program: { ...spectrogramStore.settings },
    channel0: override,
    channel1: override,
    // Mono locks the view's scope to 'both', so the lane's single override IS the both group.
    both: override,
    presets: spectrogramStore.allPresets.map((p) => ({ id: p.id, name: p.name, builtin: p.builtin })),
    // Mono: no channels to link — the view hides the toggle, the flag is inert.
    linkChannels: true,
  }
})

function applyAction(action: OverridesAction): void {
  const laneId = targetLaneId.value
  if (laneId === null) return
  applyOverridesAction(action, {
    overrides: {
      getChannel: () => gtracks.getLaneSpectrum(laneId),
      setChannel: (_ch, s) => gtracks.setLaneSpectrum(laneId, s),
      clearChannel: () => gtracks.clearLaneSpectrum(laneId),
      getBoth: () => gtracks.getLaneSpectrum(laneId),
      setBoth: (s) => gtracks.setLaneSpectrum(laneId, s),
      clearBoth: () => gtracks.clearLaneSpectrum(laneId),
    },
    program: spectrogramStore.settings,
    findPreset: (id) => spectrogramStore.allPresets.find((p) => p.id === id)?.settings,
  })
}

// The detached child's bridged gestures land here (the main window is the single writer, SS-D3).
function onBridgedEvent(name: string, payload: readonly unknown[]): void {
  if (name !== 'action') return
  applyAction(payload[0] as OverridesAction)
}
</script>

<style scoped>
.lane-spectrum-dialog__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.lane-spectrum-dialog__placeholder {
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 24px 0;
}
</style>
