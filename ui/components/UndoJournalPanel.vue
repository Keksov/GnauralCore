<template>
  <div class="undo-journal-panel">
    <!-- UG3.4 (req 14): the panel toolbar. Sort by edit time — newest on top by default; the toggle
         is highlighted when the non-default (oldest-first) order is active. -->
    <div class="undo-journal-panel__toolbar">
      <q-space />
      <q-btn
        dense flat round size="sm" icon="swap_vert"
        :color="sortNewestFirst ? undefined : 'primary'"
        :aria-label="sortLabel"
        @click="toggleSort"
      >
        <app-tooltip>{{ sortLabel }}</app-tooltip>
      </q-btn>
    </div>
    <q-separator />
    <!-- UG3.1 (req 3): the action log. Each step row shows the operation kind + the changed voices
         + the commit time; rows past the cursor are the undone (redo) tail, rendered dimmed. -->
    <div v-if="rows.length === 1" class="undo-journal-panel__empty text-grey">
      {{ t('audio.undoJournalEmpty') }}
    </div>
    <q-list v-else dense class="undo-journal-panel__list">
      <template v-for="(item, ii) in displayItems" :key="item.kind === 'row' ? item.row.key : `divider-${ii}`">
        <!-- UG4.1b (req 13, вариант а): the watershed line — everything on the DOOMED side of it
             will not survive closing the file under the current auto-clean settings. The doomed
             side depends on the sort order (req 14): oldest-first -> above, newest-first -> below. -->
        <div v-if="item.kind === 'divider'" class="undo-journal-panel__doomed-divider">
          {{ t(sortNewestFirst ? 'audio.undoJournalDoomedBelow' : 'audio.undoJournalDoomedAbove') }}
        </div>
      <q-item
        v-else
        clickable
        :active="pendingTarget === item.row.cursor"
        active-class="undo-journal-panel__row--pending"
        :class="{
          'undo-journal-panel__row--undone': item.row.cursor > gtracks.undoCursor.value,
          'undo-journal-panel__row--doomed': item.row.doomed,
        }"
        @click="selectRow(item.row.cursor)"
      >
        <q-item-section avatar class="undo-journal-panel__icon">
          <q-icon :name="item.row.icon" size="18px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ item.row.title }}</q-item-label>
          <q-item-label v-if="item.row.subtitle !== ''" caption>{{ item.row.subtitle }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <!-- req 8: the current position marker — a single click must never move the state. -->
          <q-badge v-if="item.row.cursor === gtracks.undoCursor.value" color="primary" outline>
            {{ t('audio.undoJournalCurrent') }}
          </q-badge>
          <span v-else-if="item.row.time !== ''" class="undo-journal-panel__time">{{ item.row.time }}</span>
        </q-item-section>
        <!-- UG3.2b/rev2 (req 12): hover shows a rectangular per-point diff block. Each change type
             has its own format: a was/became table for edits and moves, a value table for added and
             removed points (owner 2026-07-20: «под каждый тип действия — свой формат»). -->
        <app-tooltip v-if="item.row.changes.length > 0" max-width="480px">
          <div v-for="(c, ci) in item.row.changes" :key="ci" class="undo-journal-panel__tip-change">
            <div class="undo-journal-panel__tip-head">{{ tipHead(c) }}</div>
            <table v-if="c.change === 'changed'" class="undo-journal-panel__tip-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{{ t('audio.undoTipWas') }}</th>
                  <th>{{ t('audio.undoTipBecame') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in c.fields" :key="f.field">
                  <td class="undo-journal-panel__tip-name">{{ fieldShort(f.field) }}</td>
                  <td class="undo-journal-panel__tip-num">{{ fmtField(f.field, f.before) }}</td>
                  <td class="undo-journal-panel__tip-num undo-journal-panel__tip-num--after">{{ fmtField(f.field, f.after) }}</td>
                </tr>
              </tbody>
            </table>
            <table v-else class="undo-journal-panel__tip-table">
              <tbody>
                <tr v-for="[name, value] in pointRows(c.point)" :key="name">
                  <td class="undo-journal-panel__tip-name">{{ name }}</td>
                  <td class="undo-journal-panel__tip-num">{{ value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </app-tooltip>
      </q-item>
      </template>
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
  changes: GTrackStepPointChange[] // UG3.2b (req 12): the structured hover diff per point
  doomed: boolean // UG4.1b (req 13): will NOT survive closing the file under the current settings
}

// UG3.2b: value formatting for the diff — beat is displayed as the FULL beat (2x half, GT-D6),
// everything else trimmed to 3 decimals like the inspector fields.
function fmt(n: number): number {
  return Number(n.toFixed(3))
}

function fieldShort(field: string): string {
  return t(`audio.undoField_${field}`)
}

function fmtField(field: string, value: number): number {
  return fmt(field === 'beatFreqHalf' ? value * 2 : value)
}

function tipHead(c: GTrackStepPointChange): string {
  const key = c.change === 'added'
    ? 'audio.undoTipPointAdded'
    : c.change === 'removed' ? 'audio.undoTipPointRemoved' : 'audio.undoTipPointChanged'
  return t(key, { n: c.index + 1, time: fmt(c.point.timeSec) })
}

function pointRows(p: GTrackPoint): Array<[string, number]> {
  return [
    [t('audio.undoField_baseFreq'), fmt(p.baseFreq)],
    [t('audio.undoField_beatFreqHalf'), fmt(p.beatFreqHalf * 2)],
    [t('audio.undoField_volL'), fmt(p.volL)],
    [t('audio.undoField_volR'), fmt(p.volR)],
  ]
}

const rows = computed<JournalRow[]>(() => {
  const kept = gtracks.persistedUndoStepIds.value
  const out: JournalRow[] = [{
    key: 'initial',
    cursor: 0,
    icon: 'flag',
    title: t('audio.undoJournalInitial'),
    subtitle: '',
    time: '',
    changes: [],
    doomed: false,
  }]
  gtracks.undoSteps.value.forEach((step, i) => {
    out.push({
      key: step.id,
      cursor: i + 1,
      icon: KIND_ICONS[step.kind] ?? 'edit',
      title: kindLabel(step.kind),
      subtitle: step.label,
      time: formatTime(step.atMs),
      changes: describeStepChanges(step, 8),
      doomed: !kept.has(step.id),
    })
  })
  return out
})

// UG3.4 (req 14): sort by edit time — newest on top by DEFAULT; the choice is a persisted editor
// preference like the other 'mindwave-*' keys.
const SORT_STORAGE_KEY = 'mindwave-undo-journal-sort'
function loadSortNewestFirst(): boolean {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) !== 'oldest'
  } catch {
    return true
  }
}
const sortNewestFirst = ref(loadSortNewestFirst())
const sortLabel = computed(() => t(sortNewestFirst.value ? 'audio.undoJournalSortNewest' : 'audio.undoJournalSortOldest'))
function toggleSort(): void {
  sortNewestFirst.value = !sortNewestFirst.value
  try {
    localStorage.setItem(SORT_STORAGE_KEY, sortNewestFirst.value ? 'newest' : 'oldest')
  } catch { /* session-local */ }
}

// UG4.1b (req 13, вариант а) + UG3.4: the render list. In chronological order the watershed line
// sits between the doomed prefix and the first surviving row; reversing the list for newest-first
// flips it into «kept above / doomed below» automatically (the label follows sortNewestFirst).
type DisplayItem = { readonly kind: 'row'; readonly row: JournalRow } | { readonly kind: 'divider' }
const displayItems = computed<DisplayItem[]>(() => {
  const chronological: DisplayItem[] = []
  let seenDoomed = false
  let dividerPlaced = false
  for (const row of rows.value) {
    // The divider closes the doomed PREFIX: it goes before the first surviving step row that
    // follows doomed ones (a doomed redo tail beyond the window keeps its stripe only).
    if (row.cursor > 0) {
      if (row.doomed) {
        seenDoomed = true
      } else if (seenDoomed && !dividerPlaced) {
        chronological.push({ kind: 'divider' })
        dividerPlaced = true
      }
    }
    chronological.push({ kind: 'row', row })
  }
  if (seenDoomed && !dividerPlaced) chronological.push({ kind: 'divider' })
  return sortNewestFirst.value ? [...chronological].reverse() : chronological
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

/* UG3.4 (req 14): the panel toolbar (sort toggle). */
.undo-journal-panel__toolbar {
  display: flex;
  flex: 0 0 auto;
  padding: 2px 4px;
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

/* UG4.1b (req 13, вариант б): the amber left stripe on rows that will not survive closing the
   file — the same left-stripe idiom as the voice grouping (GT-D20). */
.undo-journal-panel__row--doomed {
  border-left: 3px solid #f2c037;
}

/* UG4.1b (вариант а): the watershed line — rows above it are not persisted. */
.undo-journal-panel__doomed-divider {
  border-top: 1px dashed #f2c037;
  color: #b28704;
  font-size: 11px;
  line-height: 1.2;
  margin-top: 2px;
  padding: 2px 8px 4px;
}

.undo-journal-panel__time {
  font-size: 11px;
  opacity: 0.7;
}

.undo-journal-panel__tip-change + .undo-journal-panel__tip-change {
  border-top: 1px solid rgba(255, 255, 255, 0.25);
  margin-top: 6px;
  padding-top: 5px;
}

.undo-journal-panel__tip-head {
  font-weight: 600;
  margin-bottom: 2px;
  white-space: nowrap;
}

.undo-journal-panel__tip-table {
  border-collapse: collapse;
}

.undo-journal-panel__tip-table th {
  font-weight: 400;
  opacity: 0.7;
  padding: 0 6px;
  text-align: right;
}

.undo-journal-panel__tip-table th:first-child {
  padding-left: 0;
  text-align: left;
}

.undo-journal-panel__tip-name {
  opacity: 0.85;
  padding-right: 10px;
  white-space: nowrap;
}

.undo-journal-panel__tip-num {
  font-variant-numeric: tabular-nums;
  padding: 0 6px;
  text-align: right;
  white-space: nowrap;
}

.undo-journal-panel__tip-num--after {
  font-weight: 600;
}

.undo-journal-panel__actions {
  display: flex;
  padding: 8px;
}
</style>
