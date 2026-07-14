<template>
  <!-- SB2.2 (status-bar plan, req 2): the bottom status bar of the Tracks editor. The minimap is
       rendered by the host (TracksPanel) into the #minimap slot on top (SB-D2 alignment); this row
       holds the editable cursor position, the format gear, and the read-only duration. -->
  <div class="track-status-bar">
    <!-- (feedback #2) the minimap row is rendered only when visible — hiding it (v-if, not v-show)
         drops it from the flow so the status bar shrinks by exactly the minimap height. -->
    <slot v-if="minimapVisible" name="minimap" />
    <div class="track-status-bar__fields">
      <!-- (a) current cursor position — editable (req 2a). The step arrows + format gear sit INSIDE
           the field frame (feedback #2/#3): the arrows change whichever segment the caret is in. -->
      <label ref="labelEl" class="track-status-bar__field">
        <span class="track-status-bar__label">{{ t('audio.statusPosition') }}</span>
        <div class="track-status-bar__field-col" :style="{ width: fieldWidth }">
        <q-input
          dense outlined
          class="track-status-bar__input"
          :model-value="buf"
          :aria-label="t('audio.statusPosition')"
          @update:model-value="(v) => (buf = String(v ?? ''))"
          @focus="onFocus"
          @blur="onBlur"
          @click="trackCaret"
          @keyup="trackCaret"
          @keyup.enter="onEnter"
          @keyup.esc="onCancel"
          @keydown.up.prevent="step(1)"
          @keydown.down.prevent="step(-1)"
        >
          <template #append>
            <!-- (3) segment step arrows — change the field the caret is in. -->
            <div class="track-status-bar__spin">
              <q-btn
                dense flat size="xs" icon="keyboard_arrow_up"
                :aria-label="t('audio.statusStepUp')"
                @mousedown.prevent="step(1)"
              />
              <q-btn
                dense flat size="xs" icon="keyboard_arrow_down"
                :aria-label="t('audio.statusStepDown')"
                @mousedown.prevent="step(-1)"
              />
            </div>
            <!-- (2) format picker gear — moved inside the field frame. -->
            <q-btn
              dense flat round size="sm"
              icon="settings"
              class="track-status-bar__gear"
              :aria-label="t('audio.statusTimeFormat')"
              @mousedown.prevent
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
          </template>
        </q-input>
        <!-- (feedback) the active format shown under the value in a small font. -->
        <span class="track-status-bar__format">{{ t(`audio.timeFormat_${format}`) }}</span>
        </div>
      </label>

      <!-- (c) duration — read-only (req 2c). -->
      <div class="track-status-bar__field">
        <span class="track-status-bar__label">{{ t('audio.statusDuration') }}</span>
        <span class="track-status-bar__duration">{{ durationText }}</span>
      </div>

      <q-space />

      <!-- (feedback #2) show/hide the minimap — pinned to the right of the status bar. -->
      <q-btn
        dense flat round size="sm"
        icon="map"
        class="track-status-bar__minimap-toggle"
        :color="minimapVisible ? 'primary' : undefined"
        :aria-label="t('audio.statusToggleMinimap')"
        @click="emit('update:minimapVisible', !minimapVisible)"
      >
        <q-tooltip>{{ t('audio.statusToggleMinimap') }}</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watchEffect } from 'vue'
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
  /** Whether the minimap row is shown (toggled from the right of the bar; owned by the host). */
  minimapVisible: boolean
}>()

const emit = defineEmits<{
  (event: 'update:positionSec', value: number): void
  (event: 'update:format', value: TimeFormat): void
  (event: 'update:minimapVisible', value: boolean): void
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

// (feedback #1) the field auto-fits the value for the current format: width = text (in tabular-nums
// `ch` units) + a fixed allowance for the in-frame arrows + gear. A short minimum keeps the append
// controls usable for tiny values.
const fieldWidth = computed(() => `calc(${Math.max(buf.value.length, 4)}ch + 78px)`)

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

// --- (feedback #3) segment step arrows -------------------------------------------------------
// The step arrows (and Up/Down keys) change whichever field the text caret sits in. Each format's
// display groups map, left to right, to these units (seconds). The caret's group index = the number
// of separators (':' / '.') before it, clamped to the group count.
const FORMAT_UNITS: Record<TimeFormat, number[]> = {
  sec: [1],
  sec_ms: [1, 0.001],
  hms: [3600, 60, 1],
  dhms: [86400, 3600, 60, 1],
  hms_cs: [3600, 60, 1, 0.01],
  hms_ms: [3600, 60, 1, 0.001],
}

const labelEl = ref<HTMLLabelElement | null>(null)
const caretPos = ref(0)
function getInput(): HTMLInputElement | null {
  return labelEl.value?.querySelector('input') ?? null
}
function trackCaret(event: Event): void {
  const el = event.target as HTMLInputElement | null
  if (el === null || typeof el.selectionStart !== 'number') return
  caretPos.value = el.selectionStart
}

function groupIndexAt(text: string, caret: number): number {
  let idx = 0
  for (let i = 0; i < caret && i < text.length; i++) {
    if (text[i] === ':' || text[i] === '.') idx++
  }
  return idx
}
/** Char ranges [start,end) of each digit group (split on ':' and '.'). */
function groupRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === ':' || text[i] === '.') {
      ranges.push([start, i])
      start = i + 1
    }
  }
  return ranges
}

function step(dir: 1 | -1): void {
  const text = buf.value
  const units = FORMAT_UNITS[props.format]
  const gi = Math.min(groupIndexAt(text, caretPos.value), units.length - 1)
  const unit = units[gi]

  const parsed = parseTime(text, props.format)
  const base = Number.isFinite(parsed) ? parsed : props.positionSec
  const next = clampSec(base + dir * unit, props.durationSec)

  editing.value = true // hold the field so the live-position watcher doesn't overwrite our edit
  emit('update:positionSec', next)
  buf.value = formatTime(next, props.format)

  // Re-select the same group so repeated clicks/keys keep stepping the same field.
  void nextTick(() => {
    const el = getInput()
    if (el === null) return
    const range = groupRanges(buf.value)[gi]
    if (range === undefined) return
    el.focus()
    el.setSelectionRange(range[0], range[1])
    caretPos.value = range[0]
  })
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

/* (feedback #1) the field auto-fits the value: width is set inline (fieldWidth) on this column, the
   input fills it, and tabular-nums keeps every digit one `ch` wide so the sizing is exact. */
.track-status-bar__field-col {
  display: flex;
  flex-direction: column;
}
.track-status-bar__input {
  width: 100%;
}
.track-status-bar__input :deep(input) {
  font-variant-numeric: tabular-nums;
}

/* the current format, shown small under the value (feedback). */
.track-status-bar__format {
  color: #64748b;
  font-size: 10px;
  line-height: 1.2;
  padding-left: 2px;
  white-space: nowrap;
}

/* the input is compact — the status bar is a thin strip, not a form. */
.track-status-bar__input :deep(.q-field__control) {
  height: 30px;
  min-height: 30px;
}
/* keep the in-frame arrows + gear tight against the right edge of the field. */
.track-status-bar__input :deep(.q-field__append) {
  gap: 2px;
  height: 30px;
  padding-left: 2px;
}

/* (feedback #3) two stacked step arrows inside the field frame. */
.track-status-bar__spin {
  display: flex;
  flex-direction: column;
}
.track-status-bar__spin :deep(.q-btn) {
  line-height: 1;
  min-height: 13px;
  padding: 0;
}
.track-status-bar__spin :deep(.q-icon) {
  font-size: 16px;
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
