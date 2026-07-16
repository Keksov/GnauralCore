<template>
  <!-- SG3.2b (SG-D6, PW5.7 «пульт»): the IN-WINDOW adapter for the per-graph «Параметры» panel. It
       builds the reactive OverridesSnapshot from the two stores (program level + per-channel
       overrides) and applies the pure view's scope-qualified actions straight to them. The detached
       child renders the SAME view through SpectrogramOverridesRemote instead (its actions are bridged
       back to SpectrumSettingsDialog, which applies them here-equivalently). -->
  <SpectrogramOverridesView :snapshot="snapshot" @action="applyAction" />
</template>

<script setup lang="ts">
import SpectrogramOverridesView from './SpectrogramOverridesView.vue'
import { useOverridesSnapshot, useApplyOverridesAction } from '../composables/use-overrides-snapshot'

const snapshot = useOverridesSnapshot()
const applyAction = useApplyOverridesAction()
</script>
