<template>
  <div class="undo-journal-panel">
    <!-- UG3.1 (req 3): the action log, oldest first. Row 0 is the initial state; each step row shows
         the operation kind + the changed voices + the commit time. Rows past the cursor are the
         undone (redo) tail, rendered dimmed. -->
    <div v-if="rows.length === 1" class="undo-journal-panel__empty text-grey">
      {{ t('audio.undoJournalEmpty') }}
    </div>
    <q-list v-else dense class="undo-journal-panel__list">
      <q-item
        v-for="row in rows"
        :key="row.key"
        clickable
        :active="pendingTarget === row.cursor"
        active-class="undo-journal-panel__row--pending"
        :class="{ 'undo-journal-panel__row--undone': row.cursor > gtracks.undoCursor.value }"
        @click="selectRow(row.cursor)"
      >
        <q-item-section avatar class="undo-journal-panel__icon">
          <q-icon :name="row.icon" size="18px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ row.title }}</q-item-label>
          <q-item-label v-if="row.subtitle !== ''" caption>{{ row.subtitle }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <!-- req 8: the current position marker — a single click must never move the state. -->
          <q-badge v-if="row.cursor === gtracks.undoCursor.value" color="primary" outline>
            {{ t('audio.undoJournalCurrent') }}
          </q-badge>
          <span v-else-if="row.time !== ''" class="undo-journal-panel__time">{{ row.time }}</span>
        </q-item-section>
        <!-- UG3.2b (req 12): hover shows the point-level diff — number, time, was/became fields. -->
        <app-tooltip v-if="row.changes.length > 0" max-width="360px">
          <div v-for="(line, li) in row.changes" :key="li" class="undo-journal-panel__tip-line">{{ line }}</div>
        </app-tooltip>
      </q-item>
    </q-list>
    <q-separator />
    <div class="undo-journal-panel__actions">
      <!-- UG3.2 (req 7/8): clearing forgets history only — the schedule state is untouched. -->
      <q-btn-dropdown dense flat no-caps :label="t('audio.undoJournalClear')" :disable="rows.length === 1">
        <q-list dense>
          <q-item v-close-popup clickable @click="gtracks.clearUndoHistory('all')">
            <q-item-section>{{ t('audio.undoJournalClearAll') }}</q-item-section>
          </q-item>
          <q-item
            v-close-popup clickable
            :disable="pendingTarget === null || pendingTarget === 0"
            @click="clearBeforeSelection"
          >
            <q-item-section>{{ t('audio.undoJournalClearBefore') }}</q-item-section>
          </q-item>
          <q-item
            v-close-popup clickable
            :disable="gtracks.undoCursor.value >= gtracks.undoSteps.value.length"
            @click="gtracks.clearUndoHistory('redo-tail')"
          >
            <q-item-section>{{ t('audio.undoJournalClearTail') }}</q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
      <q-space />
      <!-- UG3.1 (req 8): the TWO-STEP rollback — the state moves ONLY here, never on row click. -->
      <q-btn
        dense unelevated no-caps color="primary"
        :label="t('audio.undoJournalApply')"
        :disable="pendingTarget === null || pendingTarget === gtracks.undoCursor.value"
        @click="applyRollback"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// UG3.1 (undo-global-journal, req 3+8): the operations-panel CONTENT. Reads the shared gtracks
// singleton directly (nothing to plumb — same pattern as the spectrum-settings panel). A row click
// only SELECTS (highlight); the state rolls back exclusively via «Применить» (rollbackToCursor).
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppTooltip from '@tooltip/AppTooltip.vue'

import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { describeStepChanges, type GTrackPoint, type GTrackStepPointChange } from '../composables/gtrack-model'

const { t } = useI18n()
const gtracks = useSharedGtrackLanes()

const KIND_ICONS: Record<string, string> = {
  'point-edit': 'edit',
  'point-move': 'open_with',
  'point-insert': 'add_circle_outline',
  'point-remove': 'delete_outline',
  'fix-preparse': 'build',
  'lint-fix': 'healing',
}

function kindLabel(kind: string): string {
  const key = `audio.undoKind_${kind}`
  const label = t(key)
  return label === key ? t('audio.undoKind_edit') : label // unknown kind -> generic «Правка»
}

function formatTime(atMs: number): string {
  const d = new Date(atMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

interface JournalRow {
  key: string
  cursor: number // the history cursor position this row represents (0 = initial state)
  icon: string
  title: string
  subtitle: string
  time: string
  changes: string[] // UG3.2b (req 12): the hover diff, one line per changed/added/removed point
}

// UG3.2b: value formatting for the diff lines — beat is displayed as the FULL beat (2x half,
// GT-D6), everything else trimmed to 3 decimals like the inspector fields.
function fmt(n: number): number {
  return Number(n.toFixed(3))
}

function fieldShort(field: string): string {
  return t(`audio.undoField_${field}`)
}

function changeLine(c: GTrackStepPointChange): string {
  const head = `#${c.index + 1} · ${t('audio.undoField_timeSec')} ${fmt(c.point.timeSec)}`
  if (c.change === 'changed') {
    const parts = c.fields.map((f) => {
      const scale = f.field === 'beatFreqHalf' ? 2 : 1
      return `${fieldShort(f.field)} ${fmt(f.before * scale)} → ${fmt(f.after * scale)}`
    })
    return `${head}: ${parts.join(', ')}`
  }
  const p: GTrackPoint = c.point
  const values = [
    `${t('audio.undoField_baseFreq')} ${fmt(p.baseFreq)}`,
    `${t('audio.undoField_beatFreqHalf')} ${fmt(p.beatFreqHalf * 2)}`,
    `${t('audio.undoField_volL')} ${fmt(p.volL)}`,
    `${t('audio.undoField_volR')} ${fmt(p.volR)}`,
  ].join(', ')
  const verb = c.change === 'added' ? t('audio.undoJournalPointAdded') : t('audio.undoJournalPointRemoved')
  return `${head} — ${verb} (${values})`
}

const rows = computed<JournalRow[]>(() => {
  const out: JournalRow[] = [{
    key: 'initial',
    cursor: 0,
    icon: 'flag',
    title: t('audio.undoJournalInitial'),
    subtitle: '',
    time: '',
    changes: [],
  }]
  gtracks.undoSteps.value.forEach((step, i) => {
    out.push({
      key: step.id,
      cursor: i + 1,
      icon: KIND_ICONS[step.kind] ?? 'edit',
      title: kindLabel(step.kind),
      subtitle: step.label,
      time: formatTime(step.atMs),
      changes: describeStepChanges(step, 8).map(changeLine),
    })
  })
  return out
})

// req 8: pending selection (highlight only). Reset whenever the log itself changes shape (a new
// edit truncated the redo tail, a file switch rebuilt the history) so a stale target can't apply.
const pendingTarget = ref<number | null>(null)
watch(() => gtracks.undoSteps.value, () => { pendingTarget.value = null })

function selectRow(cursor: number): void {
  pendingTarget.value = cursor === pendingTarget.value ? null : cursor
}

function applyRollback(): void {
  const target = pendingTarget.value
  if (target === null) return
  gtracks.rollbackToCursor(target)
  pendingTarget.value = null
}

// UG3.2 (req 7): forget the steps OLDER than the selected row (the selection marks the kept base).
function clearBeforeSelection(): void {
  const target = pendingTarget.value
  if (target === null || target === 0) return
  gtracks.clearUndoHistory('before', target)
  pendingTarget.value = null
}
</script>

<style scoped>
.undo-journal-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.undo-journal-panel__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.undo-journal-panel__empty {
  flex: 1 1 auto;
  padding: 16px;
  text-align: center;
}

.undo-journal-panel__icon {
  min-width: 28px;
}

.undo-journal-panel__row--pending {
  background: rgba(25, 118, 210, 0.12);
}

.undo-journal-panel__row--undone {
  opacity: 0.45;
}

.undo-journal-panel__time {
  font-size: 11px;
  opacity: 0.7;
}

.undo-journal-panel__tip-line {
  white-space: nowrap;
}

.undo-journal-panel__actions {
  display: flex;
  padding: 8px;
}
</style>
