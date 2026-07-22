<template>
  <!-- PI2.1 (point-inspector-panel): the chrome-free CONTENT of «Параметры точки». Rendered inside
       PanelWindow (PointInspectorDialog) in-window; talks to the shared use-point-inspector singleton
       directly (nothing to plumb — same pattern as the undo-journal / spectrum-settings panels). Three
       states driven by inspectorMode (PI-D3 + PI-D7): a single-point form, a multi-select table, or —
       with nothing selected — a placeholder (the panel stays docked; content follows the selection). -->
  <div class="point-inspector-panel">
    <!-- PI-D7: nothing selected — the docked panel keeps its place and invites a selection. -->
    <div v-if="inspectorMode === 'none'" class="point-inspector-panel__empty text-grey">
      {{ t('audio.gtrackPointInspectorEmpty') }}
    </div>

    <!-- Table mode (owner req. 30): view + edit VALUE fields (not time — crossover reindexing would
         desync the multi-selection keys) across every multi-selected vertex, plus a bulk-delete. -->
    <template v-else-if="inspectorMode === 'table'">
      <!-- GT10.22 (owner req. 71): Ctrl/Alt+Arrow big-step is handled in the window keydown
           (TracksPanel.handleTracksKeyDown); data-step-field + data-step-row on each <td> identify the cell. -->
      <div class="point-inspector-panel__body">
        <q-markup-table dense flat dark class="point-inspector-panel__multi-table">
          <thead>
            <tr>
              <th class="point-inspector-panel__col-chk"></th>
              <th class="point-inspector-panel__col-num point-inspector-panel__col-idx">#</th>
              <th class="point-inspector-panel__col-num">{{ t('audio.gtrackPointTime') }}</th>
              <th class="point-inspector-panel__col-num">{{ t('audio.gtrackPointBase') }}</th>
              <th class="point-inspector-panel__col-num">{{ t('audio.gtrackPointBeat') }}</th>
              <th class="point-inspector-panel__col-num">{{ t('audio.gtrackPointVolL') }}</th>
              <th class="point-inspector-panel__col-num">{{ t('audio.gtrackPointVolR') }}</th>
            </tr>
          </thead>
          <tbody>
            <!-- GT10.41 (owner req.): points grouped by voice under a collapsible header. -->
            <template v-for="group in groupedMultiForm" :key="group.voiceId">
              <tr class="point-inspector-panel__group-row" @click="toggleGroup(group.voiceId)">
                <td colspan="7">
                  <q-icon :name="collapsedGroups.has(group.voiceId) ? 'chevron_right' : 'expand_more'" size="18px" />
                  {{ group.name }} <span class="text-grey">({{ group.rows.length }})</span>
                </td>
              </tr>
              <template v-if="!collapsedGroups.has(group.voiceId)">
                <tr v-for="row in group.rows" :key="`${row.voiceId}:${row.pointIndex}`">
                  <td class="point-inspector-panel__col-chk"><q-checkbox v-model="row.checked" dense /></td>
                  <!-- GT10.43 (owner req.): the point's ordinal (index) within its voice. -->
                  <td class="point-inspector-panel__col-num point-inspector-panel__col-idx text-grey">{{ row.pointIndex }}</td>
                  <!-- GT10.40: time is read-only in the table (crossover reindexing would desync keys). -->
                  <td class="point-inspector-panel__col-num">{{ row.timeSec }}</td>
                  <td class="point-inspector-panel__col-num" data-step-field="baseFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.baseFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="beatFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.beatFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="volL" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.volL" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="volR" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.volR" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                      @blur="maybeAutosaveMultiRow(row)" @keyup.enter="maybeAutosaveMultiRow(row)"
                    />
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </q-markup-table>
        <q-checkbox
          :model-value="gtracks.pointAutosave.value" dense
          :label="t('audio.gtrackAutosave')"
          @update:model-value="(v) => gtracks.setPointAutosave(v === true)"
        />
      </div>
      <q-separator />
      <div class="point-inspector-panel__actions">
        <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeleteSelected')" :disable="!multiForm.some((r) => r.checked)" @click="removeCheckedRows" />
        <q-space />
        <q-btn
          v-if="!gtracks.pointAutosave.value"
          dense unelevated no-caps color="primary"
          :label="t('audio.spectrogramZoomApply')"
          @click="applyAllMultiRows"
        />
      </div>
    </template>

    <!-- Single-point mode (GT3.3/GT3.12). -->
    <template v-else>
      <!-- GT10.22 (owner req. 71): Ctrl/Alt+Arrow big-step is handled in the window keydown
           (TracksPanel.handleTracksKeyDown). Each field is tagged data-step-field (on a native
           display:contents span) so the handler can find the focused field. -->
      <div class="point-inspector-panel__body q-gutter-sm">
        <span data-step-field="timeSec" style="display: contents">
          <q-input
            v-model.number="pointForm.timeSec" dense outlined type="number" :step="fieldStep('0.01')" min="0"
            :label="t('audio.gtrackPointTime')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
          />
        </span>
        <span data-step-field="baseFreq" style="display: contents">
          <q-input
            v-model.number="pointForm.baseFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
            :label="t('audio.gtrackPointBase')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
          />
        </span>
        <span data-step-field="beatFreq" style="display: contents">
          <q-input
            v-model.number="pointForm.beatFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
            :label="t('audio.gtrackPointBeat')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
          />
        </span>
        <!-- GT3.11 (owner req. 22): plain flex gap — q-col-gutter's negative margins made these
             overlap the beat-frequency field inside a q-gutter parent. -->
        <div class="point-inspector-panel__vol-row">
          <span data-step-field="volL" style="display: contents">
            <q-input
              v-model.number="pointForm.volL" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
              :label="t('audio.gtrackPointVolL')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
          </span>
          <span data-step-field="volR" style="display: contents">
            <q-input
              v-model.number="pointForm.volR" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
              :label="t('audio.gtrackPointVolR')" @blur="maybeAutosave" @keyup.enter="maybeAutosave"
            />
          </span>
        </div>
        <!-- Derived controls (GT-D6): editing them maps back onto volL/volR. -->
        <!-- GT10.37 (owner 2026-07-12): Volume is a numeric field with steppers (was a slider). -->
        <q-input
          :model-value="Number(pointFormVolume.toFixed(3))" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
          :label="t('audio.gtrackMode_volume')"
          @update:model-value="(v) => setPointFormVolume(Number(v) || 0)"
          @blur="maybeAutosave" @keyup.enter="maybeAutosave"
        />
        <template v-if="!pointDialogVoiceMono">
          <div class="text-caption text-grey">{{ t('audio.gtrackMode_balance') }}: {{ pointFormBalance.toFixed(2) }}</div>
          <!-- GT10.38 (owner 2026-07-12): horizontal padding so the thumb doesn't overflow the panel. -->
          <div class="point-inspector-panel__balance-slider">
            <q-slider
              :model-value="pointFormBalance" :min="-1" :max="1" :step="0.01" dense
              @update:model-value="(v) => setPointFormBalance(v ?? 0)" @change="maybeAutosave"
            />
          </div>
        </template>
        <q-checkbox
          :model-value="gtracks.pointAutosave.value" dense
          :label="t('audio.gtrackAutosave')"
          @update:model-value="(v) => gtracks.setPointAutosave(v === true)"
        />
      </div>
      <q-separator />
      <div class="point-inspector-panel__actions">
        <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeletePoint')" @click="deleteCurrentPointFromDialog" />
        <q-btn dense flat no-caps icon="add" :label="t('audio.gtrackAddPointRight')" :disable="!pointDialogHasNext" @click="addPointToRight" />
        <q-space />
        <q-btn
          v-if="!gtracks.pointAutosave.value"
          dense unelevated no-caps color="primary"
          :label="t('audio.spectrogramZoomApply')"
          @click="applyPointDialog"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSharedGtrackLanes } from '../composables/use-gtrack-lanes'
import { usePointInspector } from '../composables/use-point-inspector'

const { t } = useI18n()
const gtracks = useSharedGtrackLanes()
const {
  pointForm,
  multiForm,
  collapsedGroups,
  pointDialogVoiceMono,
  pointDialogHasNext,
  pointFormVolume,
  pointFormBalance,
  inspectorMode,
  groupedMultiForm,
  setPointFormVolume,
  setPointFormBalance,
  applyPointDialog,
  maybeAutosave,
  deleteCurrentPointFromDialog,
  addPointToRight,
  toggleGroup,
  maybeAutosaveMultiRow,
  removeCheckedRows,
  applyAllMultiRows,
  fieldStep,
} = usePointInspector()
</script>

<style scoped>
.point-inspector-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.point-inspector-panel__empty {
  flex: 1 1 auto;
  padding: 16px;
  text-align: center;
}

/* Body scrolls; footer actions stay pinned below the separator. */
.point-inspector-panel__body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px;
}

.point-inspector-panel__actions {
  align-items: center;
  display: flex;
  gap: 4px;
  padding: 8px;
}

/* GT3.11: volume L/R side by side without q-col-gutter's negative margins (req. 22). */
.point-inspector-panel__vol-row {
  display: flex;
  gap: 8px;
}
.point-inspector-panel__vol-row > * {
  flex: 1 1 0;
  min-width: 0;
}

/* GT10.38 (owner 2026-07-12): inset the balance slider so its thumb at the extremes stays inside the
   panel (otherwise it overflows and triggers a horizontal scrollbar). */
.point-inspector-panel__balance-slider {
  padding: 0 10px;
}

.point-inspector-panel__multi-table :deep(.q-field__control) {
  height: 32px;
}
.point-inspector-panel__multi-table th {
  font-size: 11px;
  white-space: nowrap;
}
.point-inspector-panel__multi-table td {
  min-width: 64px;
  padding: 2px 6px;
}
/* GT10.23 (owner req. 72): numeric headers + values right-aligned; the checkbox/ordinal columns narrow. */
.point-inspector-panel__multi-table th.point-inspector-panel__col-num,
.point-inspector-panel__multi-table td.point-inspector-panel__col-num {
  text-align: right;
}
.point-inspector-panel__multi-table th.point-inspector-panel__col-chk,
.point-inspector-panel__multi-table td.point-inspector-panel__col-chk {
  min-width: 0;
  width: 28px;
  text-align: center;
}
.point-inspector-panel__multi-table th.point-inspector-panel__col-idx,
.point-inspector-panel__multi-table td.point-inspector-panel__col-idx {
  min-width: 0;
  width: 36px;
}
/* GT10.41 (owner req.): collapsible per-voice group header row. */
.point-inspector-panel__group-row {
  cursor: pointer;
  user-select: none;
}
.point-inspector-panel__group-row td {
  background: rgba(148, 163, 184, 0.12);
  font-weight: 600;
  padding: 4px 6px;
}
.point-inspector-panel__group-row:hover td {
  background: rgba(148, 163, 184, 0.2);
}
</style>
