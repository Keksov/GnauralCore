<template>
  <!-- SB2.2 (status-bar plan, req 2): the bottom status bar of the Tracks editor. The minimap is
       rendered by the host (TracksPanel) into the #minimap slot on top (SB-D2 alignment); this row
       holds the editable cursor position, the format gear, and the read-only duration. -->
  <div class="track-status-bar">
    <slot name="minimap" />
    <div class="track-status-bar__fields">
      <!-- (a) current cursor position — editable (req 2a). -->
      <label class="track-status-bar__field">
        <span class="track-status-bar__label">{{ t('audio.statusPosition') }}</span>
        <q-input
          dense outlined
          class="track-status-bar__input"
          :model-value="buf"
          :aria-label="t('audio.statusPosition')"
          @update:model-value="(v) => (buf = String(v ?? ''))"
          @focus="onFocus"
          @blur="onBlur"
          @keyup.enter="onEnter"
          @keyup.esc="onCancel"
        />
      </label>

      <!-- (b) format picker — a gear listing the formats; the current one is checked (req 2b). -->
      <q-btn
        dense flat round size="sm"
        icon="settings"
        class="track-status-bar__gear"
        :aria-label="t('audio.statusTimeFormat')"
      >
        <q-tooltip>{{ t('audio.statusTimeFormat') }}</q-tooltip>
        <q-menu>
          <q-list dense style="min-width: 200px">
            <q-item-label header class="q-py-xs">{{ t('audio.statusTimeFormat') }}</q-item-label>
            <q-item
              v-for="f in TIME_FORMATS"
              :key="f"
              clickable
              v-close-popup
              :active="f === format"
              active-class="text-primary"
              @click="emit('update:format', f)"
            >
              <q-item-section avatar style="min-width: 28px">
                <q-icon v-if="f === format" name="check" size="18px" />
              </q-item-section>
              <q-item-section>{{ t(`audio.timeFormat_${f}`) }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>

      <!-- (c) duration — read-only (req 2c). -->
      <div class="track-status-bar__field">
        <span class="track-status-bar__label">{{ t('audio.statusDuration') }}</span>
        <span class="track-status-bar__duration">{{ durationText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  clampSec,
  formatTime,
  parseTime,
  TIME_FORMATS,
  type TimeFormat,
} from '../composables/time-format'

const props = defineProps<{
  /** Current cursor/playhead position, seconds. */
  positionSec: number
  /** Clip duration, seconds (read-only display). */
  durationSec: number
  /** Active display format (owned + persisted by the host). */
  format: TimeFormat
}>()

const emit = defineEmits<{
  (event: 'update:positionSec', value: number): void
  (event: 'update:format', value: TimeFormat): void
}>()

const { t } = useI18n()

// The position field: while the user is editing we leave their text alone; otherwise it mirrors the
// live position formatted in the current format (so it follows the playhead during playback — R4).
const buf = ref('')
const editing = ref(false)
watchEffect(() => {
  if (!editing.value) buf.value = formatTime(props.positionSec, props.format)
})

const durationText = computed(() => formatTime(props.durationSec, props.format))

function onFocus(): void {
  editing.value = true
}
function commit(): void {
  const parsed = parseTime(buf.value, props.format)
  editing.value = false
  if (Number.isFinite(parsed)) {
    const clamped = clampSec(parsed, props.durationSec)
    emit('update:positionSec', clamped)
    buf.value = formatTime(clamped, props.format)
  } else {
    // Invalid/empty input -> revert to the live position.
    buf.value = formatTime(props.positionSec, props.format)
  }
}
function onBlur(): void {
  if (editing.value) commit()
}
function onEnter(event: KeyboardEvent): void {
  ;(event.target as HTMLElement | null)?.blur() // blur triggers commit()
}
function onCancel(event: KeyboardEvent): void {
  editing.value = false
  buf.value = formatTime(props.positionSec, props.format)
  ;(event.target as HTMLElement | null)?.blur()
}
</script>

<style scoped>
/* SB2.1/SB2.2 (req 1): pinned strip at the bottom of the editor — the root section is a flex column,
   so flex:0 0 auto keeps the status bar its natural height while the tracks region scrolls above. */
.track-status-bar {
  border-top: 1px solid #1e293b;
  flex: 0 0 auto;
  margin-top: 6px;
  padding-top: 6px;
}

.track-status-bar__fields {
  align-items: center;
  color: #cbd5e1;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 4px 8px 0;
}

.track-status-bar__field {
  align-items: center;
  display: flex;
  gap: 6px;
}

.track-status-bar__label {
  color: #94a3b8;
  font-size: 12px;
}

.track-status-bar__input {
  width: 150px;
}

/* the input is compact — the status bar is a thin strip, not a form. */
.track-status-bar__input :deep(.q-field__control) {
  height: 28px;
  min-height: 28px;
}

.track-status-bar__duration {
  font-variant-numeric: tabular-nums;
}

.track-status-bar__gear {
  color: #cbd5e1;
  opacity: 0.8;
}
.track-status-bar__gear:hover {
  opacity: 1;
}
</style>
