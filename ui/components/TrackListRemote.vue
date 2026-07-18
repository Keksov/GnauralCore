<template>
  <!-- PW5.7c: the DETACHED «Список треков» adapter — the child OS window's content, resolved from
       module.ts panels[] by PanelHostPage. It holds NO gtracks/store/localStorage state of its own
       (PW-D11: the child is a separate JS realm and must not clobber the shared per-file state). It
       renders whatever snapshot the parent pushes over the panel bridge (arriving as the reactive
       `bridgeState` prop) and forwards every gesture back as a serializable TrackListAction; the
       parent applies it to the authoritative singletons and pushes the updated snapshot back. -->
  <TrackListView :snapshot="snapshot" @action="onAction" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import TrackListView from './TrackListView.vue'
import type { TrackListSnapshot, TrackListAction } from '../composables/track-list-model'

const props = defineProps<{ bridgeState?: unknown }>()
const emit = defineEmits<{ action: [action: TrackListAction] }>()

const { t } = useI18n()
const $q = useQuasar()

// Until the first snapshot arrives (child-ready triggers the parent's immediate push), render an
// empty list. isGnaural=false also keeps the gnaural-only controls hidden during that brief gap.
const EMPTY_SNAPSHOT: TrackListSnapshot = {
  isGnaural: false,
  allLanesHidden: false,
  pointDragMode: 'crossover',
  baseScaleMode: 'log',
  waveHidden: false,
  spectrumHidden: false,
  voices: [],
}
const snapshot = computed<TrackListSnapshot>(() => (props.bridgeState as TrackListSnapshot | undefined) ?? EMPTY_SNAPSHOT)

function onAction(action: TrackListAction): void {
  if (action.kind === 'fix-preparse') {
    // GT3.7 (owner req. 11 / R6): irreversible — confirm HERE (where the user is) and bridge only the
    // confirmed action; the parent applies it without re-confirming.
    $q.dialog({
      title: t('audio.gtrackFixTitle'),
      message: t('audio.gtrackFixWarning'),
      ok: { label: t('audio.gtrackFix'), color: 'primary' },
      cancel: { label: t('audio.cancel'), flat: true },
      persistent: true,
    }).onOk(() => emit('action', action))
    return
  }
  emit('action', action)
}
</script>
