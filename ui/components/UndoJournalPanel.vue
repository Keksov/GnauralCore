<template>
  <div class="undo-journal-panel">
    <!-- UG3.4 (req 14): the panel toolbar. Sort by edit time — newest on top by default; the toggle
         is highlighted when the non-default (oldest-first) order is active. -->
    <div class="undo-journal-panel__toolbar">
      <q-space />
      <!-- OB-D7 (req 5): inline branches — the toggle sits LEFT of the sort button.
           BM1.5 (req 6): the colour now indicates branch PRESENCE (blue = the log has branches);
           the click still switches inline <-> bottom placement. -->
      <q-btn
        dense flat round size="sm" icon="account_tree"
        :color="gtracks.undoBranches.value.length > 0 ? 'primary' : undefined"
        :aria-label="inlineBranchesLabel"
        @click="toggleInlineBranches"
      >
        <app-tooltip>{{ inlineBranchesLabel }}</app-tooltip>
      </q-btn>
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
    <div
      v-if="rows.length === 1 && deepRows.length === 0 && !showDeepLoad && !(inlineBranches && branchGroups.length > 0)"
      class="undo-journal-panel__empty text-grey"
    >
      {{ t('audio.undoJournalEmpty') }}
    </div>
    <!-- undo-log perf investigation (2026-07-22): this list is append-only and only ever grows
         (196+ commits observed live) — a plain q-list rendered ALL of it as real DOM nodes, so
         even a per-row-cheap update (v-memo) still had to walk the WHOLE history on every single
         edit. That base cost (200-300ms at ~200 rows) was just below the rate of rapid successive
         edits, so renders queued up and compounded into multi-second stalls (confirmed live: fast
         right after opening, then degrading — the classic signature of a backlog, not of data
         growth per se). q-virtual-scroll renders only the visible slice, making the per-edit cost
         O(visible rows) instead of O(total history) regardless of how long the journal gets. -->
    <q-virtual-scroll
      v-else
      ref="journalVirtualScroll"
      :items="renderedDisplayItems"
      :virtual-scroll-item-size="56"
      class="undo-journal-panel__list"
      v-slot="{ item }"
    >
        <!-- UG4.1b (req 13, вариант а): the watershed line — everything on the DOOMED side of it
             will not survive closing the file under the current auto-clean settings. The doomed
             side depends on the sort order (req 14): oldest-first -> above, newest-first -> below. -->
        <div v-if="item.kind === 'divider'" key="divider" class="undo-journal-panel__doomed-divider">
          {{ t(sortNewestFirst ? 'audio.undoJournalDoomedBelow' : 'audio.undoJournalDoomedAbove') }}
        </div>
        <!-- VL5.1: pre-window history pager. -->
        <q-item
          v-else-if="item.kind === 'load-more'"
          key="load-more"
          dense
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
        <!-- OB-D7 (req 5): inline mode — the branch block joins the stream at its birth time,
             expanding accordion-style right inside the journal. One display item = one block, so
             the newest-first reverse moves it whole and never tears the accordion apart. A single
             wrapping div gives q-virtual-scroll one root to measure (the block's height varies
             with expand state, which virtual-scroll re-measures on its own).
             undo-journal-key-dup fix (owner 2026-07-24, «Duplicate keys found during update: 2»):
             this block's <div> mixes an UNKEYED head q-item with a keyed conditional <template>.
             Vue then keys the children positionally and the head collides with a compiler-assigned
             branch key from a sibling block — surfacing as a numeric duplicate. Giving the head and
             the loading spinner explicit per-tip keys makes the div's children uniformly keyed, so
             the collision is gone (confirmed live: the warning disappeared, warnHandler stayed
             silent). -->
        <div v-else-if="item.kind === 'branch'" :key="`inline-${item.group.branch.tip}`">
          <q-item :key="`bh-${item.group.branch.tip}`" dense clickable class="undo-journal-panel__branch-head" @click="toggleBranch(item.group.branch.tip)">
            <q-item-section avatar class="undo-journal-panel__icon">
              <q-icon :name="expandedBranchTip === item.group.branch.tip ? 'expand_more' : 'chevron_right'" size="18px" />
            </q-item-section>
            <q-item-section>
              <q-item-label>
                {{ branchTitle(item.group.branch) }}
                <q-badge
                  v-for="tag in item.group.branch.tags"
                  :key="tag"
                  color="secondary"
                  class="undo-journal-panel__tag"
                >{{ tag }}</q-badge>
              </q-item-label>
              <q-item-label caption>{{ branchSubtitle(item.group.branch) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <div class="row no-wrap items-center">
                <!-- BM2.2 (BM-D5): three-way merge of the branch into the current line. -->
                <q-btn dense flat round size="sm" icon="call_merge" :aria-label="t('audio.undoBranchMerge')" @click.stop="startBranchMerge(item.group.branch.tip)">
                  <app-tooltip>{{ t('audio.undoBranchMerge') }}</app-tooltip>
                </q-btn>
                <q-btn dense flat round size="sm" icon="delete_outline" :aria-label="t('audio.undoBranchDelete')" @click.stop>
                  <app-tooltip>{{ t('audio.undoBranchDelete') }}</app-tooltip>
                  <q-popup-proxy>
                    <q-banner dense class="undo-journal-panel__branch-confirm">
                      {{ t('audio.undoBranchDeleteConfirm', { n: item.group.branch.exclusiveCommits }) }}
                      <template #action>
                        <q-btn v-close-popup dense flat no-caps :label="t('audio.undoBranchDeleteCancel')" />
                        <q-btn
                          v-close-popup dense flat no-caps color="negative"
                          :label="t('audio.undoBranchDelete')"
                          @click="deleteBranch(item.group.branch.tip)"
                        />
                      </template>
                    </q-banner>
                  </q-popup-proxy>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
          <template v-if="expandedBranchTip === item.group.branch.tip">
            <q-item v-if="branchStepRows(item.group) === null" :key="`bs-${item.group.branch.tip}`" dense class="undo-journal-panel__branch-step">
              <q-item-section avatar class="undo-journal-panel__icon">
                <q-spinner size="14px" />
              </q-item-section>
            </q-item>
            <q-item
              v-for="row in branchStepRows(item.group) ?? []"
              :key="row.key"
              clickable dense
              :active="pendingDeepCid === row.deepCid"
              active-class="undo-journal-panel__row--pending"
              class="undo-journal-panel__row--deep undo-journal-panel__branch-step"
              @click="openRowActions(row, $event)"
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
            </q-item>
          </template>
        </div>
      <q-item
        v-else
        :key="item.row.key"
        v-memo="[
          item.row, pendingTarget, pendingDeepCid,
          item.row.deepCid === null && item.row.cursor > gtracks.undoCursor.value,
          item.row.deepCid === null && item.row.cursor === gtracks.undoCursor.value,
          hoveredRowKey === item.row.key,
        ]"
        dense
        clickable
        :active="item.row.deepCid !== null ? pendingDeepCid === item.row.deepCid : pendingTarget === item.row.cursor"
        active-class="undo-journal-panel__row--pending"
        :class="{
          'undo-journal-panel__row--undone': item.row.deepCid === null && item.row.cursor > gtracks.undoCursor.value,
          'undo-journal-panel__row--doomed': item.row.doomed,
          'undo-journal-panel__row--deep': item.row.deepCid !== null,
        }"
        @click="openRowActions(item.row, $event)"
        @mouseenter="hoveredRowKey = item.row.key"
        @mouseleave="hoveredRowKey = null"
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
             removed points (owner 2026-07-20: «под каждый тип действия — свой формат»).
             undo-log-perf investigation (2026-07-23, round 5): mounted ONLY for the hovered row.
             app-tooltip renders a real <q-tooltip> — a full Quasar component with anchor logic, a
             portal, parent-element listeners and observers — so an always-present one per row made
             every visible row cost 10-20ms to patch (measured: <QItem> patch entries), which is
             what kept <QList> patch climbing no matter how the list data was cached or debounced.
             model-value + no-parent-event because a tooltip mounted while the pointer is ALREADY
             inside the row would never receive the mouseenter its own hover handling waits for. -->
        <app-tooltip
          v-if="item.row.changes.length > 0 && hoveredRowKey === item.row.key"
          max-width="480px"
          :model-value="true"
          no-parent-event
        >
          <!-- MSR-D7 (req 4): a step touching >1 point shows just the count, not per-point tables. -->
          <div v-if="item.row.pointCount > 1" class="undo-journal-panel__tip-head">
            {{ t('audio.undoTipGroupPoints', { n: item.row.pointCount }) }}
          </div>
          <div v-for="(c, ci) in (item.row.pointCount > 1 ? [] : item.row.changes)" :key="ci" class="undo-journal-panel__tip-change">
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
    </q-virtual-scroll>
    <q-separator />
    <!-- undo-orphan-branches (OB-D1/OB-D2/OB-D3): abandoned lines of the log — flat tips, lazy
         (summaries on first open, a branch's steps on expand). Selecting a step reuses the
         deep-row selection, so «Применить» performs the same checkout; deletion erases only the
         tip's exclusive suffix and is refused while a tag protects it. OB-D7: hidden while the
         inline mode shows the same blocks inside the journal stream. -->
    <q-expansion-item
      v-if="!inlineBranches"
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
              <div class="row no-wrap items-center">
                <!-- BM2.2 (BM-D5): three-way merge of the branch into the current line. -->
                <q-btn dense flat round size="sm" icon="call_merge" :aria-label="t('audio.undoBranchMerge')" @click.stop="startBranchMerge(group.branch.tip)">
                  <app-tooltip>{{ t('audio.undoBranchMerge') }}</app-tooltip>
                </q-btn>
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
              </div>
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
              @click="openRowActions(row, $event)"
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
                <!-- MSR-D7 (req 4): >1 point -> count only. -->
                <div v-if="row.pointCount > 1" class="undo-journal-panel__tip-head">
                  {{ t('audio.undoTipGroupPoints', { n: row.pointCount }) }}
                </div>
                <div v-for="(c, ci) in (row.pointCount > 1 ? [] : row.changes)" :key="ci" class="undo-journal-panel__tip-change">
                  <div class="undo-journal-panel__tip-head">{{ tipHead(c) }}</div>
                </div>
              </app-tooltip>
            </q-item>
          </template>
        </template>
      </q-list>
    </q-expansion-item>
    <!-- undo-journal-row-actions RA1.2 (owner 2026-07-23): «при клике по записи показывать диалог
         возможных действий с этой записью». RA-D1 — это ДОПОЛНЕНИЕ: нижняя панель продолжает
         работать как раньше. RA-D4 — новой бизнес-логики нет, все действия зовут те же функции,
         что и панель. RA-D6 — ОДНА всплывающая панель на весь журнал (не по одной на строку):
         рендерится только когда открыта, поэтому стоимость строки журнала не меняется вовсе.
         RA-D8 (приёмка RA1.7) — это QMenu, а не QDialog: диалог Quasar всегда центрируется по
         экрану, а владелец просил открывать «рядом с текущей записью», поэтому попап привязан
         к DOM-элементу строки (:target) — тот же контрол, что уже несёт меню меток этой панели. -->
    <q-menu
      v-model="rowActionsOpen"
      :target="rowActionsAnchor ?? false"
      no-parent-event
      anchor="center right"
      self="center left"
      :offset="[8, 0]"
      max-height="80vh"
      class="undo-journal-panel__row-actions"
    >
      <div class="undo-journal-panel__row-actions-head">
        <q-icon v-if="rowActionsRow !== null" :name="rowActionsRow.icon" size="18px" />
        <span class="text-weight-medium">{{ rowActionsRow?.title ?? t('audio.undoRowActionsTitle') }}</span>
        <span v-if="rowActionsRow !== null && rowActionsRow.subtitle !== ''" class="text-grey ellipsis">
          {{ rowActionsRow.subtitle }}
        </span>
        <q-space />
        <span v-if="rowActionsRow !== null && rowActionsRow.time !== ''" class="undo-journal-panel__time">
          {{ rowActionsRow.time }}
        </span>
      </div>
      <!-- RA-D7 (уточнено owner на приёмке RA1.7): изменения идут СРАЗУ после заголовка записи и
           показываются целиком — без сворачивания и без собственного скролла. Источник тот же уже
           посчитанный row.changes, ничего не пересчитывается; вертикальный скролл, если он вообще
           понадобится, лежит на самом меню (max-height). -->
      <template v-if="rowActionsChanges.length > 0">
        <q-separator />
        <div class="undo-journal-panel__row-actions-diff">
          <div class="undo-journal-panel__row-actions-caption text-grey">{{ t('audio.undoRowActionsChanges') }}</div>
          <!-- MSR-D7 (req 4): a >1-point step shows just the count, not per-point tables. -->
          <div v-if="rowActionsPointCount > 1" class="undo-journal-panel__tip-head">
            {{ t('audio.undoTipGroupPoints', { n: rowActionsPointCount }) }}
          </div>
          <div v-for="(c, ci) in (rowActionsPointCount > 1 ? [] : rowActionsChanges)" :key="ci" class="undo-journal-panel__tip-change">
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
        </div>
      </template>
      <q-separator />
      <!-- Порядок пунктов задан владельцем на приёмке RA1.7: «Метки» — последний пункт. -->
      <q-list dense>
        <!-- RA-D5: недоступные действия остаются видимыми в disabled-виде; пояснение «почему» —
             нативным title на ОБЁРТКЕ, т.к. на disabled-кнопке тултип показаться не может
             (AGENTS.md, стандартное исключение 2). -->
        <div :title="rowActionsCanApply ? undefined : t('audio.undoRowActionsApplyAtCursor')">
          <q-item clickable :disable="!rowActionsCanApply" @click="rowActionsApply">
            <q-item-section avatar class="undo-journal-panel__icon">
              <q-icon name="history" size="18px" />
            </q-item-section>
            <q-item-section>{{ t('audio.undoRowActionsApply') }}</q-item-section>
          </q-item>
        </div>
        <div :title="rowActionsCanClearBefore ? undefined : t('audio.undoRowActionsClearBeforeUnavailable')">
          <q-item clickable :disable="!rowActionsCanClearBefore" @click="rowActionsClearBefore">
            <q-item-section avatar class="undo-journal-panel__icon">
              <q-icon name="delete_sweep" size="18px" />
            </q-item-section>
            <q-item-section>{{ t('audio.undoRowActionsClearBefore') }}</q-item-section>
          </q-item>
        </div>
        <div :title="rowActionsCanTag ? undefined : t('audio.undoRowActionsTagsUnavailable')">
          <q-expansion-item
            dense
            icon="sell"
            :label="t('audio.undoRowActionsTags')"
            :disable="!rowActionsCanTag"
          >
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
                    :placeholder="t('audio.undoJournalTagName')"
                    @keyup.enter="addTag"
                  />
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    dense flat no-caps
                    :label="t('audio.undoJournalTagAdd')"
                    :disable="newTagName.trim() === ''"
                    @click="addTag"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-expansion-item>
        </div>
      </q-list>
      <!-- Футер с «Закрыть» (owner 2026-07-23). QMenu закрывается и по клику вне, и по Esc, но
           владелец просил явную кнопку — v-close-popup закрывает ближайший попап. -->
      <q-separator />
      <div class="undo-journal-panel__row-actions-footer">
        <q-btn v-close-popup dense flat no-caps :label="t('audio.undoRowActionsClose')" />
      </div>
    </q-menu>
    <!-- BM2.2 (req 4): merge-conflict resolution — «моя версия / из ветки» per conflict. -->
    <q-dialog v-model="mergeDialogOpen">
      <q-card class="undo-journal-panel__merge-dialog">
        <q-card-section class="text-subtitle2">{{ t('audio.undoBranchMergeConflictsTitle') }}</q-card-section>
        <q-separator />
        <q-card-section class="undo-journal-panel__merge-list">
          <div
            v-for="c in pendingMerge?.plan.conflicts ?? []"
            :key="mergeConflictKey(c)"
            class="undo-journal-panel__merge-conflict"
          >
            <div class="text-weight-medium">{{ mergeConflictTitle(c) }}</div>
            <q-option-group
              v-model="mergeChoices[mergeConflictKey(c)]"
              :options="conflictOptions(c)"
              type="radio"
              dense
            />
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn v-close-popup dense flat no-caps :label="t('audio.cancel')" @click="pendingMerge = null" />
          <q-btn dense unelevated no-caps color="primary" :label="t('audio.undoBranchMergeApply')" @click="confirmMergeChoices" />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-separator />
    <div class="undo-journal-panel__actions">
      <!-- UG3.2 (req 7/8): clearing forgets history only — the schedule state is untouched. -->
      <q-btn-dropdown dense flat no-caps :label="t('audio.undoJournalClear')" :disable="rows.length === 1">
        <q-list dense>
          <!-- BM1.5 (req 7): clearing EVERYTHING also wipes the server log — irreversible, so it
               asks a Да/Нет confirmation first. -->
          <q-item v-close-popup clickable @click="confirmClearAll">
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
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Dialog, Notify } from 'quasar'
import AppTooltip from '@tooltip/AppTooltip.vue'

import type { ProjectUndoLogBranch } from '@protocol'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { describeStepChanges, describeStepChangeCount, type GTrackPoint, type GTrackStepPointChange, type GTrackUndoStep } from '../composables/gtrack-model'
import { mergeConflictKey, type MergeChoice, type MergeConflict, type PlannedBranchMerge } from '../composables/undo-branch-merge'
import { perfLog, perfNow } from '../composables/perf-log'

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
  'merge': 'call_merge',
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
  atMs: number // OB-D7: raw commit time — the inline branch blocks interleave by it (0 = initial)
  changes: GTrackStepPointChange[] // UG3.2b (req 12): the structured hover diff per point
  pointCount: number // MSR-D7 (req 4): TOTAL points the step touched (uncapped); >1 => show a count summary
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

// undo-log perf investigation (2026-07-22): confirmed live — this computed used to rebuild every
// row (including a fresh `changes` array via describeStepChanges) on every single edit, even for
// the 50+ older steps whose underlying data never changed. Vue's v-for keeps the DOM node (the key
// matches) but still re-patches each <q-item> because the ROW OBJECT and its `changes`/`tags`
// arrays are new references every time, so prop-equality can't short-circuit — <QList> patch was
// measured at 1000-1200ms (matching a ~50-70 row journal, ~13-17ms/row). Fixed by caching each
// row keyed by its step's OWN identity (existing GTrackUndoStep objects are never mutated in place —
// commitEdit only ever pushes new ones — so an unchanged step is still the SAME reference) and
// reusing the previous row wholesale when nothing that feeds it changed.
const EMPTY_TAGS: string[] = []
function tagsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a === b || (a.length === b.length && a.every((v, i) => v === b[i]))
}
const rowCache = new Map<string, { readonly step: GTrackUndoStep; readonly row: JournalRow }>()
const rows = computed<JournalRow[]>(() => {
  const perfStart = perfNow()
  let cacheHits = 0
  let cacheMisses = 0
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
    atMs: 0,
    changes: [],
    pointCount: 0,
    doomed: false,
    tags: initialCid === null ? EMPTY_TAGS : byCid.get(initialCid) ?? EMPTY_TAGS,
  }]
  const seen = new Set<string>()
  gtracks.undoSteps.value.forEach((step, i) => {
    seen.add(step.id)
    const cursor = i + 1
    const doomed = !kept.has(step.id)
    const tags = byCid.get(step.id) ?? EMPTY_TAGS
    const cached = rowCache.get(step.id)
    if (cached !== undefined && cached.step === step && cached.row.cursor === cursor
      && cached.row.doomed === doomed && tagsEqual(cached.row.tags, tags)) {
      cacheHits += 1
      out.push(cached.row)
      return
    }
    cacheMisses += 1
    const row: JournalRow = {
      key: step.id,
      cursor,
      deepCid: null,
      icon: KIND_ICONS[step.kind] ?? 'edit',
      title: kindLabel(step.kind),
      subtitle: step.label,
      time: formatTime(step.atMs),
      atMs: step.atMs,
      changes: describeStepChanges(step, 8),
      pointCount: describeStepChangeCount(step),
      doomed,
      tags,
    }
    rowCache.set(step.id, { step, row })
    out.push(row)
  })
  for (const key of rowCache.keys()) if (!seen.has(key)) rowCache.delete(key)
  // undo-log-perf investigation (2026-07-23, round 4 — debounced reset() didn't help): confirm
  // rather than assume the row cache is doing its job and this computed's own JS cost is cheap —
  // if misses climb with total step count instead of staying ~1/edit, the cache isn't hitting.
  perfLog('rows', perfStart, { total: out.length, hits: cacheHits, misses: cacheMisses })
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
    atMs: row.atMs,
    changes: row.step === null ? [] : describeStepChanges(row.step, 8),
    pointCount: row.step === null ? 0 : describeStepChangeCount(row.step),
    doomed: false,
    tags: byCid.get(row.cid) ?? [],
  }))
})

// undo-journal-earlier-history-gate EH1.2 (owner 2026-07-24): the «Ранняя история…» pager shows
// ONLY when the log actually holds history older than the adopted window (deepUndoHasEarlier). It
// used to show optimistically before any click, and a click then discovered there was nothing to
// fetch and hid it — a pure no-op the owner rightly questioned. deepUndoHasEarlier gates that away;
// the second clause keeps the pager visible across the paging cycle once real earlier history is
// being loaded.
const showDeepLoad = computed(() =>
  gtracks.deepUndoHasEarlier.value && (!gtracks.deepUndoLoaded.value || gtracks.deepUndoHasMore.value),
)

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

// OB-D7 (req 5): inline branches — persisted like the sort; default off = the bottom section.
const INLINE_BRANCHES_STORAGE_KEY = 'mindwave-undo-journal-branches-inline'
function loadInlineBranches(): boolean {
  try {
    return localStorage.getItem(INLINE_BRANCHES_STORAGE_KEY) === 'inline'
  } catch {
    return false
  }
}
const inlineBranches = ref(loadInlineBranches())
const inlineBranchesLabel = computed(() => t('audio.undoBranchesInline'))
function toggleInlineBranches(): void {
  inlineBranches.value = !inlineBranches.value
  try {
    localStorage.setItem(INLINE_BRANCHES_STORAGE_KEY, inlineBranches.value ? 'inline' : 'bottom')
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
  | { readonly kind: 'branch'; readonly group: BranchGroup } // OB-D7: one block = one item
const displayItems = computed<DisplayItem[]>(() => {
  const perfStart = perfNow()
  const chronological: DisplayItem[] = []
  if (showDeepLoad.value) chronological.push({ kind: 'load-more' })

  // OB-D7 (req 5): inline mode — each branch block enters the stream at its birth time (fromMs,
  // the branch's first record). The block is a single item, so the newest-first reverse moves it
  // whole and the accordion never tears.
  const pendingBranches = inlineBranches.value
    ? [...branchGroups.value].sort((a, b) => a.branch.fromMs - b.branch.fromMs)
    : []
  let nextBranch = 0
  const pushRow = (row: JournalRow): void => {
    while (nextBranch < pendingBranches.length && pendingBranches[nextBranch]!.branch.fromMs <= row.atMs) {
      chronological.push({ kind: 'branch', group: pendingBranches[nextBranch]! })
      nextBranch += 1
    }
    chronological.push({ kind: 'row', row })
  }

  for (const row of deepRows.value) pushRow(row)
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
    pushRow(row)
  }
  if (seenDoomed && !dividerPlaced) chronological.push({ kind: 'divider' })
  while (nextBranch < pendingBranches.length) {
    // Branches younger than every journal row (abandoned after the last surviving edit).
    chronological.push({ kind: 'branch', group: pendingBranches[nextBranch]! })
    nextBranch += 1
  }
  const result = sortNewestFirst.value ? [...chronological].reverse() : chronological
  // undo-log-perf investigation (2026-07-23, round 4): isolate the pure-JS rebuild+reverse cost
  // (expected sub-ms even at hundreds of items) from whatever Vue/QVirtualScroll does with the
  // result — if THIS number stays tiny while <QList> patch keeps climbing, the array rebuild
  // itself is cleared as a suspect and the cost is downstream, in rendering the array's items.
  perfLog('displayItems', perfStart, {
    total: result.length,
    branches: inlineBranches.value ? branchGroups.value.length : 0,
    expandedBranchRows: expandedBranchTip.value === null
      ? 0
      : (branchGroups.value.find((g) => g.branch.tip === expandedBranchTip.value)?.rows?.length ?? -1),
  })
  return result
})

// req 8: pending selection (highlight only). Reset whenever the log itself changes shape (a new
// edit truncated the redo tail, a file switch rebuilt the history) so a stale target can't apply.
const pendingTarget = ref<number | null>(null)
const pendingDeepCid = ref<string | null>(null)
// undo-log-perf (2026-07-23): which row's diff tooltip is actually mounted — see the template.
const hoveredRowKey = ref<string | null>(null)
watch(() => gtracks.undoSteps.value, () => {
  pendingTarget.value = null
  pendingDeepCid.value = null
})

// undo-journal-row-actions RA1.2 (owner 2026-07-23, «при клике по записи показывать диалог
// возможных действий»). Selecting is no longer a TOGGLE (RA-D2): a second click used to clear the
// selection, which with a dialog would leave the user looking at actions for a row that «Применить»
// no longer has a target for. The click always selects its own row, so the dialog and the bottom
// action bar are guaranteed to act on the same entry.
function selectRowForActions(row: JournalRow): void {
  if (row.deepCid !== null) {
    pendingTarget.value = null
    pendingDeepCid.value = row.deepCid
  } else {
    pendingDeepCid.value = null
    pendingTarget.value = row.cursor
  }
}

// RA-D6: ONE dialog per panel, never one per row. The undo-log-perf investigation (closed
// 2026-07-23) established that an always-present app-tooltip per row cost 10-20ms PER ROW across
// ~70 rendered rows and was the journal's main slowdown — so the rows themselves gain no new
// component here, only a click handler.
const rowActionsOpen = ref(false)
const rowActionsRow = shallowRef<JournalRow | null>(null)
// RA-D8 (owner 2026-07-23, приёмка RA1.7): the popup opens NEXT TO its row, not centred on screen.
// QDialog cannot do that — it always centres its card — so the control is a QMenu anchored to the
// clicked row element (the same control the tag menu of this panel already uses). Vue patches the
// row in place on selection change (same :key), so this element reference stays live.
const rowActionsAnchor = shallowRef<HTMLElement | null>(null)

// `Event`, not `MouseEvent`: QItem types its @click payload as the base Event, and currentTarget —
// the only thing needed here — is declared on it, so widening beats casting.
async function openRowActions(row: JournalRow, event: Event): Promise<void> {
  // Toggle is OURS, not QMenu's (see no-parent-event in the template). Owner bug 2026-07-23: a
  // third click on the same row did nothing. Root cause read out of Quasar's source — use-anchor.js
  // binds its own `click -> toggle` on the anchor element, so two controllers fought over one
  // visibility state: our handler set it true, then QMenu's toggle flipped it straight back off.
  // Clicking a DIFFERENT row appeared to «fix» it only because the anchor listener was still bound
  // to the previous row. click-outside.js ignores clicks inside the anchor, so with QMenu's own
  // listener off, this handler is the single controller and the sequence is deterministic.
  const sameRow = rowActionsOpen.value && rowActionsRow.value?.key === row.key
  rowActionsOpen.value = false
  if (sameRow) return // second click on the same row closes, third opens again

  selectRowForActions(row)
  rowActionsRow.value = row
  rowActionsAnchor.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  // Re-anchoring while the popup is still shown can leave it positioned against the old row;
  // closing first and reopening after the DOM settles keeps the move clean.
  await nextTick()
  rowActionsOpen.value = true
}

/** «Применить» is pointless on the row that IS the current position (same gate as the bottom bar). */
const rowActionsCanApply = computed<boolean>(() => {
  const row = rowActionsRow.value
  if (row === null) return false
  return row.deepCid !== null || row.cursor !== gtracks.undoCursor.value
})

/** Clearing older history walks the in-memory window, so it needs a window row above position 0. */
const rowActionsCanClearBefore = computed<boolean>(() => {
  const row = rowActionsRow.value
  return row !== null && row.deepCid === null && row.cursor > 0
})

/** Tagging needs the row's server-side commit — absent until the log has synced this step. */
const rowActionsCanTag = computed<boolean>(() => selectedCid.value !== null)

const rowActionsChanges = computed<readonly GTrackStepPointChange[]>(() => rowActionsRow.value?.changes ?? [])
// MSR-D7 (req 4): the subform, like the tooltips, collapses a >1-point step to a single count.
const rowActionsPointCount = computed<number>(() => rowActionsRow.value?.pointCount ?? 0)

async function rowActionsApply(): Promise<void> {
  rowActionsOpen.value = false
  await applyRollback()
}

function rowActionsClearBefore(): void {
  if (!rowActionsCanClearBefore.value) return
  Dialog.create({
    title: t('audio.undoRowActionsClearBefore'),
    message: t('audio.undoRowActionsClearBeforeConfirm'),
    ok: { label: t('audio.undoJournalClearAllYes'), color: 'negative', flat: true, noCaps: true },
    cancel: { label: t('audio.undoJournalClearAllNo'), flat: true, noCaps: true },
  }).onOk(() => {
    rowActionsOpen.value = false
    clearBeforeSelection()
  })
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
// OB-D7: the inline toggle needs the summaries without the bottom section ever opening; the
// undoTags dep retries the load after a project restore completes (tags refresh = log synced).
watch(
  [branchesOpen, inlineBranches, () => gtracks.undoBranchesLoaded.value, () => gtracks.undoTags.value],
  () => {
    if ((branchesOpen.value || inlineBranches.value) && !gtracks.undoBranchesLoaded.value && !gtracks.undoBranchesLoading.value) {
      void gtracks.loadUndoBranches()
    }
  },
  { immediate: true },
)
watch(() => gtracks.undoBranches.value, (next) => {
  expandedBranchTip.value = null
  // BM1.5 (req 6): branches present -> show them right away; in the bottom mode that means the
  // section auto-expands (still collapsible by hand; inline mode shows blocks in the stream).
  if (next.length > 0 && !inlineBranches.value) branchesOpen.value = true
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
        atMs: row.atMs,
        changes: row.step === null ? [] : describeStepChanges(row.step, 8),
        pointCount: row.step === null ? 0 : describeStepChangeCount(row.step),
        doomed: false,
        tags: byCid.get(row.cid) ?? [],
      })),
    }
  })
})

// undo-log perf investigation (2026-07-22): q-virtual-scroll caches each row's MEASURED height by
// array INDEX, on the assumption a given index always holds the same logical row. Newest-first
// prepends the new row at index 0 on every edit, shifting every existing row's index by one — the
// cached heights then describe the WRONG rows, compounding the (already-approximate) size estimate
// error until scrolling snaps to correct it (owner repro: "impossible to scroll to the bottom, list
// jumps, scrollbar resets to top"). Declared after branchGroups: displayItems's computed reads
// branchGroups.value, and watch()'s source getter runs synchronously at creation time to collect
// dependencies — placed any earlier, that synchronous run hits branchGroups before its own `const`
// has executed (TDZ ReferenceError, confirmed live: broke the whole panel on open).
//
// round 2 (owner: slowed down again): resetting on every length change paid Quasar's full
// cache-rebuild-plus-forced-reflow cost on every single edit. Debouncing JUST the reset() call
// (round 3) didn't fix it either — confirmed live via rows/displayItems timing (sub-ms, ~100%
// cache hits) plus a qitems tally showing the count of >10ms <QItem> patches climbing from a
// handful to 15+ over a rapid-edit session: reset() only repairs the height CACHE after the fact,
// it never stops every visible row's CONTENT from genuinely differing from last render — THAT's
// what Vue is correctly (if expensively) reacting to on every edit, cache or no cache.
//
// round 4: the only way to stop paying for a per-edit index shift is to stop FEEDING the shift to
// q-virtual-scroll on every edit. renderedDisplayItems is a debounced view of displayItems: the
// first edit after a quiet spell updates it immediately (a single edit still feels instant), but
// further edits within the same burst are absorbed WITHOUT touching the prop q-virtual-scroll
// sees — Vue does zero list re-render work for them — and the burst's accumulated change (and a
// cache reset, now worth its cost because it's amortized over the whole burst instead of paid per
// edit) lands once, shortly after the user stops.
const journalVirtualScroll = ref<{ reset: () => void } | null>(null)
const renderedDisplayItems = shallowRef<DisplayItem[]>(displayItems.value)
const JOURNAL_RENDER_DEBOUNCE_MS = 400
let journalRenderTimer: ReturnType<typeof setTimeout> | null = null

watch(displayItems, (next) => {
  if (journalRenderTimer === null) {
    renderedDisplayItems.value = next // leading edge: a single/occasional edit shows immediately
  }
  if (journalRenderTimer !== null) clearTimeout(journalRenderTimer)
  journalRenderTimer = setTimeout(() => {
    journalRenderTimer = null
    renderedDisplayItems.value = displayItems.value
    journalVirtualScroll.value?.reset()
  }, JOURNAL_RENDER_DEBOUNCE_MS)
})
onBeforeUnmount(() => {
  if (journalRenderTimer !== null) clearTimeout(journalRenderTimer)
})

/** OB-D7: inner rows follow the list sort — newest-first keeps the tip on top. */
function branchStepRows(group: BranchGroup): JournalRow[] | null {
  if (group.rows === null) return null
  return sortNewestFirst.value ? group.rows : [...group.rows].reverse()
}

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

// BM2.2 (BM-D5): the merge flow. Clean plans apply immediately; conflicts open the dialog with
// «из ветки» preselected (the user just asked to merge the branch); apply is ONE kind='merge'
// transaction — Ctrl-Z rolls the whole merge back, the branch stays in the list.
const mergeDialogOpen = ref(false)
const pendingMerge = ref<PlannedBranchMerge | null>(null)
const mergeChoices = ref<Record<string, MergeChoice>>({})

async function startBranchMerge(tip: string): Promise<void> {
  const planned = await gtracks.planUndoBranchMergeFor(tip)
  if (planned === 'no-base') {
    Notify.create({ type: 'warning', message: t('audio.undoBranchMergeNoBase') })
    return
  }
  if (planned === 'failed') {
    Notify.create({ type: 'negative', message: t('audio.undoBranchMergeFailed') })
    return
  }
  if (planned.plan.conflicts.length === 0) {
    finishMerge(planned, new Map())
    return
  }
  const defaults: Record<string, MergeChoice> = {}
  for (const c of planned.plan.conflicts) defaults[mergeConflictKey(c)] = 'theirs'
  mergeChoices.value = defaults
  pendingMerge.value = planned
  mergeDialogOpen.value = true
}

function confirmMergeChoices(): void {
  const planned = pendingMerge.value
  if (planned === null) return
  mergeDialogOpen.value = false
  finishMerge(planned, new Map(Object.entries(mergeChoices.value) as [string, MergeChoice][]))
}

function finishMerge(planned: PlannedBranchMerge, choices: ReadonlyMap<string, MergeChoice>): void {
  const result = gtracks.applyUndoBranchMergeFor(planned, choices)
  pendingMerge.value = null
  if (result === 'stale') {
    Notify.create({ type: 'warning', message: t('audio.undoBranchMergeStale') })
  } else if (result === 'nothing') {
    Notify.create({ type: 'info', message: t('audio.undoBranchMergeNothing') })
  } else if (result === 'failed') {
    Notify.create({ type: 'negative', message: t('audio.undoBranchMergeFailed') })
  } else {
    Notify.create({ type: 'positive', message: t('audio.undoBranchMerged', { n: result.applied }) })
    if (planned.plan.lockedVoiceIds.length > 0) {
      Notify.create({ type: 'warning', message: t('audio.undoBranchMergeLocked') })
    }
  }
}

function mergeVariantLabel(point: GTrackPoint | null): string {
  if (point === null) return t('audio.undoBranchMergePointAbsent')
  return `t ${fmt(point.timeSec)} · ${t('audio.undoField_baseFreq')} ${fmt(point.baseFreq)}`
    + ` · ${t('audio.undoField_beatFreqHalf')} ${fmt(point.beatFreqHalf * 2)}`
    + ` · L ${fmt(point.volL)} R ${fmt(point.volR)}`
}

function mergeConflictTitle(c: MergeConflict): string {
  return c.kind === 'voice'
    ? t('audio.undoBranchMergeVoiceConflict', { name: c.voiceName, ours: c.oursPoints.length, theirs: c.theirsPoints.length })
    : t('audio.undoBranchMergePointConflict', { name: c.voiceName, time: fmt((c.ours ?? c.theirs ?? c.base)!.timeSec) })
}

function conflictOptions(c: MergeConflict): { label: string; value: MergeChoice }[] {
  if (c.kind === 'voice') {
    return [
      { label: t('audio.undoBranchMergeMine'), value: 'ours' },
      { label: t('audio.undoBranchMergeTheirs'), value: 'theirs' },
    ]
  }
  return [
    { label: `${t('audio.undoBranchMergeMine')}: ${mergeVariantLabel(c.ours)}`, value: 'ours' },
    { label: `${t('audio.undoBranchMergeTheirs')}: ${mergeVariantLabel(c.theirs)}`, value: 'theirs' },
  ]
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

// BM1.5 (req 7): «Очистить всю историю» wipes the SERVER log too — irreversible by design
// (VL4.2 req 7 «целиком»), so it must be confirmed explicitly.
function confirmClearAll(): void {
  Dialog.create({
    title: t('audio.undoJournalClearAll'),
    message: t('audio.undoJournalClearAllConfirm'),
    ok: { label: t('audio.undoJournalClearAllYes'), color: 'negative', flat: true, noCaps: true },
    cancel: { label: t('audio.undoJournalClearAllNo'), flat: true, noCaps: true },
  }).onOk(() => {
    gtracks.clearUndoHistory('all')
  })
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

/* BM2.2: the merge-conflict dialog. */
.undo-journal-panel__merge-dialog {
  min-width: 380px;
  max-width: 560px;
}

.undo-journal-panel__merge-list {
  max-height: 60vh;
  overflow-y: auto;
}

.undo-journal-panel__merge-conflict + .undo-journal-panel__merge-conflict {
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  margin-top: 8px;
  padding-top: 8px;
}

.undo-journal-panel__tag-menu {
  min-width: 200px;
  padding: 4px;
}

/* undo-journal-row-actions RA1.2 + RA-D8: the per-entry actions popup, anchored to its row. */
.undo-journal-panel__row-actions {
  max-width: 560px;
  min-width: 320px;
}

.undo-journal-panel__row-actions-head {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
  padding: 10px 16px;
}

/* RA-D7 (уточнено на приёмке RA1.7): the diff is shown in FULL — no inner scroll box of its own.
   The popup as a whole carries max-height, so an extreme entry still cannot outgrow the viewport. */
.undo-journal-panel__row-actions-diff {
  padding: 6px 16px 10px;
}

.undo-journal-panel__row-actions-caption {
  font-size: 11px;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.undo-journal-panel__row-actions-footer {
  display: flex;
  justify-content: flex-end;
  padding: 4px 8px;
}

/* The tip-change separator is authored for the dark tooltip plate; inside the popup it sits on the
   themed surface, so it needs a neutral rule that works on both. */
.undo-journal-panel__row-actions-diff .undo-journal-panel__tip-change + .undo-journal-panel__tip-change {
  border-top: 1px solid rgba(128, 128, 128, 0.35);
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
