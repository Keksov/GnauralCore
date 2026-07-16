// project-store PR2.3 (PR-D13): per-file persistence of a shared spectrogram viewport (time +
// frequency windows) into a project section. Two independent surfaces use it with their own
// sections: AudioPage ('viewAudio') and TracksPanel ('viewTracks'). The area SELECTION is
// intentionally ephemeral and never persisted (plan PR2.3).
import { watch, type Ref } from 'vue'
import { readProjectSectionFor, writeProjectSectionFor } from './use-project'

interface TimeWindowLike {
  readonly startSec: number
  readonly endSec: number
}

interface FreqWindowLike {
  readonly lo: number
  readonly hi: number
}

export interface PersistedViewState {
  readonly time: TimeWindowLike | null
  readonly freq: FreqWindowLike | null
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function parseTimeWindow(value: unknown): TimeWindowLike | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { startSec?: unknown; endSec?: unknown }
  if (!isFiniteNumber(candidate.startSec) || !isFiniteNumber(candidate.endSec)) return null
  if (candidate.endSec <= candidate.startSec) return null
  return { startSec: candidate.startSec, endSec: candidate.endSec }
}

function parseFreqWindow(value: unknown): FreqWindowLike | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { lo?: unknown; hi?: unknown }
  if (!isFiniteNumber(candidate.lo) || !isFiniteNumber(candidate.hi)) return null
  if (candidate.hi <= candidate.lo) return null
  return { lo: candidate.lo, hi: candidate.hi }
}

/** Wire a surface's shared time/freq windows to a project section. Call during component setup,
 *  AFTER the surface's own "reset on file change" watch is registered: within one flush the order
 *  is then reset -> restorePending=true -> save-watch (skipped), so the null reset never clobbers
 *  the stored section before the async restore lands. */
export function bindProjectViewState(options: {
  readonly sectionName: string
  readonly filePath: () => string | null
  readonly view: Ref<TimeWindowLike | null>
  readonly freqView: Ref<FreqWindowLike | null>
}): void {
  let applying = false
  let restorePending = false
  let restoreReqId = 0

  watch(
    () => options.filePath(),
    (path) => {
      const reqId = ++restoreReqId
      restorePending = true
      if (path === null) {
        restorePending = false
        return
      }

      void readProjectSectionFor<PersistedViewState>(path, options.sectionName).then((stored) => {
        if (reqId !== restoreReqId || path !== options.filePath()) return
        restorePending = false
        const time = stored === null ? null : parseTimeWindow(stored.time)
        const freq = stored === null ? null : parseFreqWindow(stored.freq)
        if (time === null && freq === null) return
        applying = true
        try {
          if (time !== null) options.view.value = time
          if (freq !== null) options.freqView.value = freq
        } finally {
          applying = false
        }
      })
    },
  )

  watch([options.view, options.freqView], () => {
    if (applying || restorePending) return
    const path = options.filePath()
    if (path === null) return
    const payload: PersistedViewState = { time: options.view.value, freq: options.freqView.value }
    writeProjectSectionFor(path, options.sectionName, payload)
  })
}
