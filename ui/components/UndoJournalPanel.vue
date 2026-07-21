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
         + the commit time; rows past the cursor are the undone (redo) tail, rendered dimmed.
         VL5.1: DEEP rows (older than the in-memory window, living only in the log) join the list
         at the chronological bottom; «Применить» on one performs a checkout. -->
    <div v-if="rows.length === 1 && deepRows.length === 0 && !showDeepLoad" class="undo-journal-panel__empty text-grey">
      {{ t('audio.undoJournalEmpty') }}
    </div>
    <q-list v-else dense class="undo-journal-panel__list">
      <template v-for="(item, ii) in displayItems" :key="item.kind === 'row' ? item.row.key : `${item.kind}-${ii}`">
        <!-- UG4.1b (req 13, вариант а): the watershed line — everything on the DOOMED side of it
             will not survive closing the file under the current auto-clean settings. The doomed
             side depends on the sort order (req 14): oldest-first -> above, newest-first -> below. -->
        <div v-if="item.kind === 'divider'" class="undo-journal-panel__doomed-divider">
          {{ t(sortNewestFirst ? 'audio.undoJournalDoomedBelow' : 'audio.undoJournalDoomedAbove') }}
        </div>
        <!-- VL5.1: pre-window history pager. -->
        <q-item
          v-else-if="item.kind === 'load-more'"
          clickable
          class="undo-journal-panel__load-more"
          :disable="gtracks.deepUndoLoading.value"
          @click="gtracks.loadDeepUndoHistory()"
        >
          <q-item-section avatar class="undo-journal-panel__icon">
            <q-spinner v-if="gtracks.deepUndoLoading.value" size="16px" />
            <q-icon v-else name="unfold_more" size="18px" />
          </q-item-section>
          <q-item-section>{{ t('audio.undoJournalDeepLoad') }}</q-item-section>
        </q-item>
      <q-item
        v-else
        clickable
        :active="item.row.deepCid !== null ? pendingDeepCid === item.row.deepCid : pendingTarget === item.row.cursor"
        active-class="undo-journal-panel__row--pending"
        :class="{
          'undo-journal-panel__row--undone': item.row.deepCid === null && item.row.cursor > gtracks.undoCursor.value,
          'undo-journal-panel__row--doomed': item.row.doomed,
          'undo-journal-panel__row--deep': item.row.deepCid !== null,
        }"
        @click="item.row.deepCid !== null ? selectDeepRow(item.row.deepCid) : selectRow(item.row.cursor)"
      >
        <q-item-section avatar class="undo-journal-panel__icon">
          <q-icon :name="item.row.icon" size="18px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ item.row.title }}
            <!-- VL-D9: tag badges — a tagged commit (and its chain) is GC-protected. -->
            <q-badge
              v-for="tag in item.row.tags"
              :key="tag"
              color="secondary"
              class="undo-journal-panel__tag"
            >{{ tag }}</q-badge>
          </q-item-label>
          <q-item-label v-if="item.row.subtitle !== ''" caption>{{ item.row.subtitle }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <!-- req 8: the current position marker — a single click must never move the state. -->
          <q-badge v-if="item.row.deepCid === null && item.row.cursor === gtracks.undoCursor.value" color="primary" outline>
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
    <!-- undo-orphan-branches (OB-D1/OB-D2/OB-D3): abandoned lines of the log — flat tips, lazy
         (summaries on first open, a branch's steps on expand). Selecting a step reuses the
         deep-row selection, so «Применить» performs the same checkout; deletion erases only the
         tip's exclusive suffix and is refused while a tag protects it. -->
    <q-expansion-item
      v-model="branchesOpen"
      dense
      icon="call_split"
      :label="branchesLabel"
      class="undo-journal-panel__branches"
    >
      <div v-if="gtracks.undoBranchesLoading.value" class="undo-journal-panel__branches-note">
        <q-spinner size="16px" />
      </div>
      <div v-else-if="branchGroups.length === 0" class="undo-journal-panel__branches-note text-grey">
        {{ t('audio.undoBranchesEmpty') }}
      </div>
      <q-list v-else dense class="undo-journal-panel__branches-list">
        <template v-for="group in branchGroups" :key="group.branch.tip">
          <q-item clickable class="undo-journal-panel__branch-head" @click="toggleBranch(group.branch.tip)">
            <q-item-section avatar class="undo-journal-panel__icon">
              <q-icon :name="expandedBranchTip === group.branch.tip ? 'expand_more' : 'chevron_right'" size="18px" />
            </q-item-section>
            <q-item-section>
              <q-item-label>
                {{ branchTitle(group.branch) }}
                <q-badge
                  v-for="tag in group.branch.tags"
                  :key="tag"
                  color="secondary"
                  class="undo-journal-panel__tag"
                >{{ tag }}</q-badge>
              </q-item-label>
              <q-item-label caption>{{ branchSubtitle(group.branch) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn dense flat round size="sm" icon="delete_outline" :aria-label="t('audio.undoBranchDelete')" @click.stop>
                <app-tooltip>{{ t('audio.undoBranchDelete') }}</app-tooltip>
                <q-popup-proxy>
                  <q-banner dense class="undo-journal-panel__branch-confirm">
                    {{ t('audio.undoBranchDeleteConfirm', { n: group.branch.exclusiveCommits }) }}
                    <template #action>
                      <q-btn v-close-popup dense flat no-caps :label="t('audio.undoBranchDeleteCancel')" />
                      <q-btn
                        v-close-popup dense flat no-caps color="negative"
                        :label="t('audio.undoBranchDelete')"
                        @click="deleteBranch(group.branch.tip)"
                      />
                    </template>
                  </q-banner>
                </q-popup-proxy>
              </q-btn>
            </q-item-section>
          </q-item>
          <template v-if="expandedBranchTip === group.branch.tip">
            <q-item v-if="group.rows === null" dense class="undo-journal-panel__branch-step">
              <q-item-section avatar class="undo-journal-panel__icon">
                <q-spinner size="14px" />
              </q-item-section>
            </q-item>
            <q-item
              v-for="row in group.rows ?? []"
              :key="row.key"
              clickable dense
              :active="pendingDeepCid === row.deepCid"
              active-class="undo-journal-panel__row--pending"
              class="undo-journal-panel__row--deep undo-journal-panel__branch-step"
              @click="selectDeepRow(row.deepCid!)"
            >
              <q-item-section avatar class="undo-journal-panel__icon">
                <q-icon :name="row.icon" size="18px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ row.title }}
                  <q-badge
                    v-for="tag in row.tags"
                    :key="tag"
                    color="secondary"
                    class="undo-journal-panel__tag"
                  >{{ tag }}</q-badge>
                </q-item-label>
                <q-item-label v-if="row.subtitle !== ''" caption>{{ row.subtitle }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <span class="undo-journal-panel__time">{{ row.time }}</span>
              </q-item-section>
              <app-tooltip v-if="row.changes.length > 0" max-width="480px">
                <div v-for="(c, ci) in row.changes" :key="ci" class="undo-journal-panel__tip-change">
                  <div class="undo-journal-panel__tip-head">{{ tipHead(c) }}</div>
                </div>
              </app-tooltip>
            </q-item>
          </template>
        </template>
      </q-list>
    </q-expansion-item>
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
      <!-- VL-D9: tags of the selected row. -->
      <q-btn dense flat round icon="sell" :disable="selectedCid === null" :aria-label="t('audio.undoJournalTags')">
        <app-tooltip>{{ t('audio.undoJournalTags') }}</app-tooltip>
        <q-menu>
          <q-list dense class="undo-journal-panel__tag-menu">
            <q-item v-for="tag in selectedCidTags" :key="tag" dense>
              <q-item-section>{{ tag }}</q-item-section>
              <q-item-section side>
                <q-btn dense flat round size="xs" icon="close" @click="gtracks.deleteUndoTag(tag)" />
              </q-item-section>
            </q-item>
            <q-item dense>
              <q-item-section>
                <q-input
                  v-model="newTagName"
                  dense
                  autofocus
                  :placeholder="t('audio.undoJournalTagName')"
                  @keyup.enter="addTag"
                />
              </q-item-section>
              <q-item-section side>
                <q-btn dense flat no-caps :label="t('audio.undoJournalTagAdd')" :disable="newTagName.trim() === ''" @click="addTag" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
      <q-space />
      <!-- UG3.1 (req 8): the TWO-STEP rollback — the state moves ONLY here, never on row click.
           VL5.1: on a deep row this is a checkout (itself one undoable history step). -->
      <q-btn
        dense unelevated no-caps color="primary"
        :label="t('audio.undoJournalApply')"
        :loading="applying"
        :disable="pendingDeepCid === null && (pendingTarget === null || pendingTarget === gtracks.undoCursor.value)"
        @click="applyRollback"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// UG3.1 (undo-global-journal, req 3+8): the operations-panel CONTENT. Reads the shared gtracks
// singleton directly (nothing to plumb — same pattern as the spectrum-settings panel). A row click
// only SELECTS (highlight); the state rolls back exclusively via «Применить» (rollbackToCursor for
// window rows, checkoutUndoCommit for deep ones — VL5.1, undo-versioned-log).
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Notify } from 'quasar'
import AppTooltip from '@tooltip/AppTooltip.vue'

import type { ProjectUndoLogBranch } from '@protocol'
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
  'checkout': 'history',
  'snapshot': 'photo_camera',
  'meta': 'archive',
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
  deepCid: string | null // VL5.1: non-null = a pre-window row addressed by its log cid
  icon: string
  title: string
  subtitle: string
  time: string
  changes: GTrackStepPointChange[] // UG3.2b (req 12): the structured hover diff per point
  doomed: boolean // UG4.1b (req 13): will NOT survive closing the file under the current settings
  tags: string[] // VL-D9: names of the tags pinned to this row's commit
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

// VL-D9: reverse map commit cid -> tag names for the row badges.
const tagsByCid = computed<Map<string, string[]>>(() => {
  const out = new Map<string, string[]>()
  for (const [name, cid] of Object.entries(gtracks.undoTags.value)) {
    const list = out.get(cid)
    if (list === undefined) out.set(cid, [name])
    else list.push(name)
  }
  return out
})

const rows = computed<JournalRow[]>(() => {
  const kept = gtracks.persistedUndoStepIds.value
  const byCid = tagsByCid.value
  const initialCid = gtracks.undoLogCidAt(0)
  const out: JournalRow[] = [{
    key: 'initial',
    cursor: 0,
    deepCid: null,
    icon: 'flag',
    title: t('audio.undoJournalInitial'),
    subtitle: '',
    time: '',
    changes: [],
    doomed: false,
    tags: initialCid === null ? [] : byCid.get(initialCid) ?? [],
  }]
  gtracks.undoSteps.value.forEach((step, i) => {
    out.push({
      key: step.id,
      cursor: i + 1,
      deepCid: null,
      icon: KIND_ICONS[step.kind] ?? 'edit',
      title: kindLabel(step.kind),
      subtitle: step.label,
      time: formatTime(step.atMs),
      changes: describeStepChanges(step, 8),
      doomed: !kept.has(step.id),
      tags: byCid.get(step.id) ?? [],
    })
  })
  return out
})

// VL5.1: pre-window rows, mapped to the same shape (fetched newest-first, so reverse for the
// chronological build below). Snapshot/meta rows have their own labels and no diff tooltip.
const deepRows = computed<JournalRow[]>(() => {
  const byCid = tagsByCid.value
  return [...gtracks.deepUndoRows.value].reverse().map((row) => ({
    key: `deep-${row.cid}`,
    cursor: -1,
    deepCid: row.cid,
    icon: KIND_ICONS[row.kind] ?? KIND_ICONS[row.type] ?? 'edit',
    title: row.type === 'snapshot'
      ? t('audio.undoJournalSnapshot')
      : row.type === 'meta' ? t('audio.undoJournalImported') : kindLabel(row.kind),
    subtitle: row.label,
    time: formatTime(row.atMs),
    changes: row.step === null ? [] : describeStepChanges(row.step, 8),
    doomed: false,
    tags: byCid.get(row.cid) ?? [],
  }))
})

const showDeepLoad = computed(() => !gtracks.deepUndoLoaded.value || gtracks.deepUndoHasMore.value)

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
// VL5.1: the deep (pre-window) rows and their pager sit at the chronological start — with the
// default newest-first sort the past is what you scroll DOWN into.
type DisplayItem =
  | { readonly kind: 'row'; readonly row: JournalRow }
  | { readonly kind: 'divider' }
  | { readonly kind: 'load-more' }
const displayItems = computed<DisplayItem[]>(() => {
  const chronological: DisplayItem[] = []
  if (showDeepLoad.value) chronological.push({ kind: 'load-more' })
  for (const row of deepRows.value) chronological.push({ kind: 'row', row })
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
const pendingDeepCid = ref<string | null>(null)
watch(() => gtracks.undoSteps.value, () => {
  pendingTarget.value = null
  pendingDeepCid.value = null
})

function selectRow(cursor: number): void {
  pendingDeepCid.value = null
  pendingTarget.value = cursor === pendingTarget.value ? null : cursor
}

function selectDeepRow(cid: string): void {
  pendingTarget.value = null
  pendingDeepCid.value = cid === pendingDeepCid.value ? null : cid
}

// VL-D9: the commit cid behind the current selection (window rows map through the position/step
// ids, the initial row through position 0; null while the log is not synced yet).
const selectedCid = computed<string | null>(() => {
  if (pendingDeepCid.value !== null) return pendingDeepCid.value
  const target = pendingTarget.value
  if (target === null) return null
  if (target === 0) return gtracks.undoLogCidAt(0)
  return gtracks.undoSteps.value[target - 1]?.id ?? null
})
const selectedCidTags = computed<string[]>(() => {
  const cid = selectedCid.value
  return cid === null ? [] : tagsByCid.value.get(cid) ?? []
})

const newTagName = ref('')
function addTag(): void {
  const cid = selectedCid.value
  const name = newTagName.value.trim()
  if (cid === null || name === '') return
  gtracks.setUndoTag(name, cid)
  newTagName.value = ''
}

// undo-orphan-branches (OB-D1): the abandoned-branches section. Summaries load when the section
// first opens (or again after a file switch reset), a branch's steps when it is expanded; a
// selected step drives the SAME pendingDeepCid/«Применить» checkout as the deep rows (OB-D2).
const branchesOpen = ref(false)
const expandedBranchTip = ref<string | null>(null)
watch(
  [branchesOpen, () => gtracks.undoBranchesLoaded.value],
  () => {
    if (branchesOpen.value && !gtracks.undoBranchesLoaded.value && !gtracks.undoBranchesLoading.value) {
      void gtracks.loadUndoBranches()
    }
  },
)
watch(() => gtracks.undoBranches.value, () => {
  expandedBranchTip.value = null
})

const branchesLabel = computed(() => {
  const base = t('audio.undoBranchesTitle')
  return gtracks.undoBranchesLoaded.value ? `${base} (${gtracks.undoBranches.value.length})` : base
})

interface BranchGroup {
  readonly branch: ProjectUndoLogBranch
  readonly rows: JournalRow[] | null // null = the chain is still loading
}
const branchGroups = computed<BranchGroup[]>(() => {
  const byCid = tagsByCid.value
  return gtracks.undoBranches.value.map((branch) => {
    const loaded = gtracks.undoBranchRowsByTip.value.get(branch.tip)
    return {
      branch,
      // newest-first, as fetched: the tip on top — how far the branch went before it was left.
      rows: loaded === undefined ? null : loaded.map((row) => ({
        key: `branch-${row.cid}`,
        cursor: -1,
        deepCid: row.cid,
        icon: KIND_ICONS[row.kind] ?? KIND_ICONS[row.type] ?? 'edit',
        title: row.type === 'snapshot'
          ? t('audio.undoJournalSnapshot')
          : row.type === 'meta' ? t('audio.undoJournalImported') : kindLabel(row.kind),
        subtitle: row.label,
        time: formatTime(row.atMs),
        changes: row.step === null ? [] : describeStepChanges(row.step, 8),
        doomed: false,
        tags: byCid.get(row.cid) ?? [],
      })),
    }
  })
})

function toggleBranch(tip: string): void {
  if (expandedBranchTip.value === tip) {
    expandedBranchTip.value = null
    return
  }
  expandedBranchTip.value = tip
  void gtracks.loadUndoBranchSteps(tip)
}

function formatDayTime(atMs: number): string {
  const d = new Date(atMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? time : `${p(d.getDate())}.${p(d.getMonth() + 1)} ${time}`
}

function branchTitle(branch: ProjectUndoLogBranch): string {
  return `${formatDayTime(branch.fromMs)} – ${formatDayTime(branch.toMs)}`
}

function branchSubtitle(branch: ProjectUndoLogBranch): string {
  return t('audio.undoBranchSubtitle', { steps: branch.commits, snapshots: branch.snapshots })
}

async function deleteBranch(tip: string): Promise<void> {
  const outcome = await gtracks.deleteUndoBranch(tip)
  if (outcome === 'ok') {
    if (expandedBranchTip.value === tip) expandedBranchTip.value = null
    pendingDeepCid.value = null
    Notify.create({ type: 'positive', message: t('audio.undoBranchDeleted') })
  } else if (outcome === 'tagged') {
    Notify.create({ type: 'warning', message: t('audio.undoBranchTagged') })
  } else {
    Notify.create({ type: 'negative', message: t('audio.undoBranchDeleteFailed') })
  }
}

const applying = ref(false)
async function applyRollback(): Promise<void> {
  const deepCid = pendingDeepCid.value
  if (deepCid !== null) {
    applying.value = true
    try {
      const outcome = await gtracks.checkoutUndoCommit(deepCid)
      if (outcome === 'ok') {
        pendingDeepCid.value = null
      } else {
        const key = outcome === 'no-snapshot'
          ? 'audio.undoJournalCheckoutNoSnapshot'
          : outcome === 'mismatch' ? 'audio.undoJournalCheckoutMismatch' : 'audio.undoJournalCheckoutFailed'
        Notify.create({ type: 'negative', message: t(key) })
      }
    } finally {
      applying.value = false
    }
    return
  }
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

/* VL5.1: pre-window rows — history that lives only in the log; a blue-grey stripe + slight dim
   distinguishes them from the active undo window. */
.undo-journal-panel__row--deep {
  border-left: 3px solid #78909c;
  opacity: 0.75;
}

.undo-journal-panel__load-more {
  color: #78909c;
  font-size: 12px;
}

.undo-journal-panel__tag {
  margin-left: 4px;
  vertical-align: middle;
}

/* undo-orphan-branches (OB-D1): the abandoned-branches section — capped height, own scroll. */
.undo-journal-panel__branches {
  flex: 0 0 auto;
  max-height: 40%;
  overflow-y: auto;
}

.undo-journal-panel__branches-note {
  padding: 8px 16px;
}

.undo-journal-panel__branch-head {
  font-size: 12px;
}

.undo-journal-panel__branch-step {
  padding-left: 28px;
}

.undo-journal-panel__branch-confirm {
  max-width: 300px;
}

.undo-journal-panel__tag-menu {
  min-width: 200px;
  padding: 4px;
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
