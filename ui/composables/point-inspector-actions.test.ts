import { describe, expect, test } from 'bun:test'

import { applyPointInspectorAction, type PointInspectorApi } from './point-inspector-actions'
import type { PointInspectorAction } from './point-inspector-model'

// A recording double: every api method pushes `[method, ...args]` onto `calls`, so a test can assert
// exactly which authoritative call an action produced.
function makeApi(): { api: PointInspectorApi; calls: unknown[][] } {
  const calls: unknown[][] = []
  const rec = (name: string) => (...args: unknown[]): void => { calls.push([name, ...args]) }
  const api: PointInspectorApi = {
    commitForm: rec('commitForm'),
    setAutosave: rec('setAutosave'),
    deleteCurrentPoint: rec('deleteCurrentPoint'),
    addPointRight: rec('addPointRight'),
    undo: rec('undo'),
    redo: rec('redo'),
    commitRow: rec('commitRow'),
    commitAllRows: rec('commitAllRows'),
    removeChecked: rec('removeChecked'),
  }
  return { api, calls }
}

describe('applyPointInspectorAction (PI3.1)', () => {
  const form = { timeSec: 1, baseFreq: 200, beatFreq: 8, volL: 0.5, volR: 0.5 }
  const rowVals = { baseFreq: 100, beatFreq: 4, volL: 1, volR: 1 }

  const cases: ReadonlyArray<readonly [PointInspectorAction, unknown[]]> = [
    [{ kind: 'apply', values: form }, ['commitForm', form]],
    [{ kind: 'set-autosave', on: true }, ['setAutosave', true]],
    [{ kind: 'delete-point' }, ['deleteCurrentPoint']],
    [{ kind: 'add-point-right' }, ['addPointRight']],
    [{ kind: 'undo' }, ['undo']],
    [{ kind: 'redo' }, ['redo']],
    [{ kind: 'apply-row', voiceId: 3, pointIndex: 2, values: rowVals }, ['commitRow', 3, 2, rowVals]],
    [{ kind: 'apply-all-rows', rows: [{ voiceId: 3, pointIndex: 2, values: rowVals }] }, ['commitAllRows', [{ voiceId: 3, pointIndex: 2, values: rowVals }]]],
    [{ kind: 'remove-checked', refs: [{ voiceId: 3, pointIndex: 2 }] }, ['removeChecked', [{ voiceId: 3, pointIndex: 2 }]]],
  ]

  for (const [action, expected] of cases) {
    test(`${action.kind} -> ${String(expected[0])}`, () => {
      const { api, calls } = makeApi()
      applyPointInspectorAction(action, api)
      expect(calls).toEqual([expected])
    })
  }
})
