<template>
  <!-- PI3.2 (point-inspector-panel): the PURE «Параметры точки» view. Renders a PointInspectorSnapshot
       and emits exactly one PointInspectorAction per committed gesture — no composable/gtracks access.
       It owns only a transient INPUT BUFFER for the numeric fields (PI-D8): typing stays local until a
       blur/enter/Apply commits it as an action; the parent applies it and pushes an updated snapshot,
       which re-seeds the buffer. Used in-window (PointInspectorPanel) and in the detached child
       (PointInspectorRemote) alike. -->
  <div class="point-inspector-panel">
    <!-- Undo/redo apply to the whole model history — shown in every mode. -->
    <div class="point-inspector-panel__toolbar">
      <q-btn
        flat dense round size="sm" icon="undo" :disable="!snapshot.canUndo"
        :aria-label="t('audio.gtrackUndo')"
        @click="emit('action', { kind: 'undo' })"
      >
        <app-tooltip>{{ t('audio.gtrackUndo') }}</app-tooltip>
      </q-btn>
      <q-btn
        flat dense round size="sm" icon="redo" :disable="!snapshot.canRedo"
        :aria-label="t('audio.gtrackRedo')"
        @click="emit('action', { kind: 'redo' })"
      >
        <app-tooltip>{{ t('audio.gtrackRedo') }}</app-tooltip>
      </q-btn>
    </div>
    <q-separator />

    <!-- PI-D7: nothing selected — the docked panel keeps its place and invites a selection. -->
    <div v-if="snapshot.mode === 'none'" class="point-inspector-panel__empty text-grey">
      {{ t('audio.gtrackPointInspectorEmpty') }}
    </div>

    <!-- Table mode: value fields across every multi-selected vertex (not time — GT10.40) + bulk delete. -->
    <template v-else-if="snapshot.mode === 'table'">
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
            <template v-for="group in displayGroups" :key="group.voiceId">
              <tr class="point-inspector-panel__group-row" @click="toggleGroup(group.voiceId)">
                <td colspan="7">
                  <q-icon :name="collapsed.has(group.voiceId) ? 'chevron_right' : 'expand_more'" size="18px" />
                  {{ group.name }} <span class="text-grey">({{ group.rows.length }})</span>
                </td>
              </tr>
              <template v-if="!collapsed.has(group.voiceId)">
                <tr v-for="row in group.rows" :key="`${row.voiceId}:${row.pointIndex}`">
                  <td class="point-inspector-panel__col-chk"><q-checkbox v-model="row.checked" dense /></td>
                  <td class="point-inspector-panel__col-num point-inspector-panel__col-idx text-grey">{{ row.pointIndex }}</td>
                  <td class="point-inspector-panel__col-num">{{ row.timeSec }}</td>
                  <td class="point-inspector-panel__col-num" data-step-field="baseFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.baseFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                      @blur="autosaveRow(row)" @keyup.enter="autosaveRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="beatFreq" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.beatFreq" dense borderless type="number" input-class="text-right" :step="fieldStep('0.1')" min="0"
                      @blur="autosaveRow(row)" @keyup.enter="autosaveRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="volL" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.volL" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                      @blur="autosaveRow(row)" @keyup.enter="autosaveRow(row)"
                    />
                  </td>
                  <td class="point-inspector-panel__col-num" data-step-field="volR" :data-step-row="`${row.voiceId}:${row.pointIndex}`">
                    <q-input
                      v-model.number="row.volR" dense borderless type="number" input-class="text-right" :step="fieldStep('0.01')" min="0" max="1"
                      @blur="autosaveRow(row)" @keyup.enter="autosaveRow(row)"
                    />
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </q-markup-table>
        <q-checkbox
          :model-value="snapshot.autosave" dense
          :label="t('audio.gtrackAutosave')"
          @update:model-value="(v) => emit('action', { kind: 'set-autosave', on: v === true })"
        />
      </div>
      <q-separator />
      <div class="point-inspector-panel__actions">
        <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeleteSelected')" :disable="!rows.some((r) => r.checked)" @click="removeChecked" />
        <q-space />
        <q-btn
          v-if="!snapshot.autosave"
          dense unelevated no-caps color="primary"
          :label="t('audio.spectrogramZoomApply')"
          @click="applyAllRows"
        />
      </div>
    </template>

    <!-- Single-point mode. -->
    <template v-else>
      <div class="point-inspector-panel__body q-gutter-sm">
        <span data-step-field="timeSec" style="display: contents">
          <q-input
            v-model.number="form.timeSec" dense outlined type="number" :step="fieldStep('0.01')" min="0"
            :label="t('audio.gtrackPointTime')" @blur="autosaveForm" @keyup.enter="autosaveForm"
          />
        </span>
        <span data-step-field="baseFreq" style="display: contents">
          <q-input
            v-model.number="form.baseFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
            :label="t('audio.gtrackPointBase')" @blur="autosaveForm" @keyup.enter="autosaveForm"
          />
        </span>
        <span data-step-field="beatFreq" style="display: contents">
          <q-input
            v-model.number="form.beatFreq" dense outlined type="number" :step="fieldStep('0.1')" min="0"
            :label="t('audio.gtrackPointBeat')" @blur="autosaveForm" @keyup.enter="autosaveForm"
          />
        </span>
        <div class="point-inspector-panel__vol-row">
          <span data-step-field="volL" style="display: contents">
            <q-input
              v-model.number="form.volL" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
              :label="t('audio.gtrackPointVolL')" @blur="autosaveForm" @keyup.enter="autosaveForm"
            />
          </span>
          <span data-step-field="volR" style="display: contents">
            <q-input
              v-model.number="form.volR" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
              :label="t('audio.gtrackPointVolR')" @blur="autosaveForm" @keyup.enter="autosaveForm"
            />
          </span>
        </div>
        <!-- Derived controls (GT-D6): editing them maps back onto volL/volR. -->
        <q-input
          :model-value="Number(volume.toFixed(3))" dense outlined type="number" :step="fieldStep('0.01')" min="0" max="1"
          :label="t('audio.gtrackMode_volume')"
          @update:model-value="(v) => setVolume(Number(v) || 0)"
          @blur="autosaveForm" @keyup.enter="autosaveForm"
        />
        <template v-if="!snapshot.mono">
          <div class="text-caption text-grey">{{ t('audio.gtrackMode_balance') }}: {{ balance.toFixed(2) }}</div>
          <div class="point-inspector-panel__balance-slider">
            <q-slider
              :model-value="balance" :min="-1" :max="1" :step="0.01" dense
              @update:model-value="(v) => setBalance(v ?? 0)" @change="autosaveForm"
            />
          </div>
        </template>
        <q-checkbox
          :model-value="snapshot.autosave" dense
          :label="t('audio.gtrackAutosave')"
          @update:model-value="(v) => emit('action', { kind: 'set-autosave', on: v === true })"
        />
      </div>
      <q-separator />
      <div class="point-inspector-panel__actions">
        <q-btn dense flat no-caps color="negative" icon="delete" :label="t('audio.gtrackDeletePoint')" @click="emit('action', { kind: 'delete-point' })" />
        <q-btn dense flat no-caps icon="add" :label="t('audio.gtrackAddPointRight')" :disable="!snapshot.hasNext" @click="emit('action', { kind: 'add-point-right' })" />
        <q-space />
        <q-btn
          v-if="!snapshot.autosave"
          dense unelevated no-caps color="primary"
          :label="t('audio.spectrogramZoomApply')"
          @click="applyForm"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppTooltip from '@tooltip/AppTooltip.vue'
import { ctrlStepValue } from '../composables/gtrack-render'
import type { PointFormValues, PointInspectorAction, PointInspectorSnapshot, PointRowValues } from '../composables/point-inspector-model'

const props = defineProps<{ snapshot: PointInspectorSnapshot }>()
const emit = defineEmits<{ action: [action: PointInspectorAction] }>()

const { t } = useI18n()
const round3 = (x: number): number => Math.round(x * 1000) / 1000

// ---- single-point input buffer (PI-D8) ---------------------------------------------------------
const form = reactive({ timeSec: 0, baseFreq: 0, beatFreq: 0, volL: 0, volR: 0 })
// Re-seed the buffer only when the MODEL form values actually change (a new target, an applied edit,
// an undo) — never on an unrelated snapshot recompute, so mid-typing is not clobbered. A stable value
// key (not object identity) drives the watch.
const formKey = computed<string>(() => {
  const f = props.snapshot.form
  return f === null ? 'none' : `${f.timeSec},${f.baseFreq},${f.beatFreq},${f.volL},${f.volR}`
})
watch(formKey, () => {
  const f = props.snapshot.form
  if (f === null) return
  form.timeSec = f.timeSec
  form.baseFreq = f.baseFreq
  form.beatFreq = f.beatFreq
  form.volL = f.volL
  form.volR = f.volR
}, { immediate: true })

const volume = computed(() => (form.volL + form.volR) / 2)
const balance = computed(() => {
  const s = form.volL + form.volR
  return s <= 0 ? 0 : (form.volR - form.volL) / s
})
function setVolume(v: number): void {
  const clamp = (x: number): number => Math.max(0, Math.min(1, x))
  const cur = volume.value
  if (props.snapshot.mono || cur <= 0) {
    form.volL = round3(clamp(v))
    form.volR = round3(clamp(v))
    return
  }
  const f = v / cur
  form.volL = round3(clamp(form.volL * f))
  form.volR = round3(clamp(form.volR * f))
}
function setBalance(b: number): void {
  const clamp = (x: number): number => Math.max(0, Math.min(1, x))
  const s = form.volL + form.volR
  if (s <= 0) return
  const bb = Math.max(-1, Math.min(1, b))
  form.volL = round3(clamp((s * (1 - bb)) / 2))
  form.volR = round3(clamp((s * (1 + bb)) / 2))
}
function formValues(): PointFormValues {
  return { timeSec: Number(form.timeSec) || 0, baseFreq: Number(form.baseFreq) || 0, beatFreq: Number(form.beatFreq) || 0, volL: Number(form.volL) || 0, volR: Number(form.volR) || 0 }
}
function applyForm(): void {
  emit('action', { kind: 'apply', values: formValues() })
}
function autosaveForm(): void {
  if (props.snapshot.autosave) applyForm()
}

// ---- multi-select table buffer -----------------------------------------------------------------
interface TableRowBuf { voiceId: number; pointIndex: number; timeSec: number; baseFreq: number; beatFreq: number; volL: number; volR: number; checked: boolean }
const rows = ref<TableRowBuf[]>([])
const collapsed = ref<Set<number>>(new Set())
// Reconcile like GT3.16 review #5: a row whose key is still selected KEEPS its (possibly mid-edit)
// values + checked state; newly-selected keys seed from the snapshot; deselected keys drop. Driven by
// the selection KEY set, so pure value changes to still-selected rows don't discard uncommitted typing.
const rowKeySet = computed<string>(() =>
  props.snapshot.groups.flatMap((g) => g.rows.map((r) => `${r.voiceId}:${r.pointIndex}`)).join(','),
)
watch(rowKeySet, () => {
  const existing = new Map(rows.value.map((r) => [`${r.voiceId}:${r.pointIndex}`, r]))
  const next: TableRowBuf[] = []
  for (const g of props.snapshot.groups) {
    for (const r of g.rows) {
      const key = `${r.voiceId}:${r.pointIndex}`
      next.push(existing.get(key) ?? { ...r, checked: true })
    }
  }
  rows.value = next
}, { immediate: true })

const displayGroups = computed(() => {
  const nameByVoice = new Map<number, string>(props.snapshot.groups.map((g) => [g.voiceId, g.name]))
  const groups = new Map<number, { voiceId: number; name: string; rows: TableRowBuf[] }>()
  for (const row of rows.value) {
    let g = groups.get(row.voiceId)
    if (g === undefined) {
      g = { voiceId: row.voiceId, name: nameByVoice.get(row.voiceId) ?? `#${row.voiceId}`, rows: [] }
      groups.set(row.voiceId, g)
    }
    g.rows.push(row)
  }
  return [...groups.values()]
})
function toggleGroup(voiceId: number): void {
  const next = new Set(collapsed.value)
  if (next.has(voiceId)) next.delete(voiceId)
  else next.add(voiceId)
  collapsed.value = next
}
function rowValues(row: TableRowBuf): PointRowValues {
  return { baseFreq: Number(row.baseFreq) || 0, beatFreq: Number(row.beatFreq) || 0, volL: Number(row.volL) || 0, volR: Number(row.volR) || 0 }
}
function autosaveRow(row: TableRowBuf): void {
  if (props.snapshot.autosave) emit('action', { kind: 'apply-row', voiceId: row.voiceId, pointIndex: row.pointIndex, values: rowValues(row) })
}
function applyAllRows(): void {
  emit('action', { kind: 'apply-all-rows', rows: rows.value.map((r) => ({ voiceId: r.voiceId, pointIndex: r.pointIndex, values: rowValues(r) })) })
}
function removeChecked(): void {
  emit('action', { kind: 'remove-checked', refs: rows.value.filter((r) => r.checked).map((r) => ({ voiceId: r.voiceId, pointIndex: r.pointIndex })) })
}

// ---- Alt+Arrow big-step (GT10.22) --------------------------------------------------------------
// A window keydown carries the modifier reliably even while a QInput field is focused (the QInput
// @keydown didn't). Handled HERE so it works in both the main and the detached child window (PI-D8).
const altBigStep = ref(false)
function fieldStep(fine: string): string {
  return altBigStep.value ? '1' : fine
}
function onWindowKeyDown(event: KeyboardEvent): void {
  altBigStep.value = event.altKey
  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  const el = (document.activeElement as HTMLElement | null)?.closest('[data-step-field]') as HTMLElement | null
  if (el === null) return
  const field = el.getAttribute('data-step-field')
  if (field === null) return
  event.preventDefault()
  const dir: 1 | -1 = event.key === 'ArrowUp' ? 1 : -1
  const rowKey = el.getAttribute('data-step-row')
  if (rowKey !== null) {
    const row = rows.value.find((r) => `${r.voiceId}:${r.pointIndex}` === rowKey)
    if (row === undefined) return
    const rec = row as unknown as Record<string, number>
    rec[field] = ctrlStepValue(Number(rec[field]), field, dir)
    autosaveRow(row)
    return
  }
  const rec = form as unknown as Record<string, number>
  rec[field] = ctrlStepValue(Number(rec[field]), field, dir)
  autosaveForm()
}
function onWindowKeyUp(event: KeyboardEvent): void { altBigStep.value = event.altKey }
function resetAltBigStep(): void { altBigStep.value = false }
onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('keyup', onWindowKeyUp)
  window.addEventListener('blur', resetAltBigStep)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('keyup', onWindowKeyUp)
  window.removeEventListener('blur', resetAltBigStep)
})
</script>

<style scoped>
.point-inspector-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.point-inspector-panel__toolbar {
  display: flex;
  flex: 0 0 auto;
  padding: 2px 4px;
}

.point-inspector-panel__empty {
  flex: 1 1 auto;
  padding: 16px;
  text-align: center;
}

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

.point-inspector-panel__vol-row {
  display: flex;
  gap: 8px;
}
.point-inspector-panel__vol-row > * {
  flex: 1 1 0;
  min-width: 0;
}

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
