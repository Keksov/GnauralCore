// gtrack-editor undo/point-edit performance diagnostics (owner 2026-07-22): large schedules (e.g.
// ForestMeditation) feel noticeably slower on point add/remove/select than small ones (wakeup).
// This brackets every stage of the edit -> undo-journal -> server pipeline with performance.now()
// timers so a concrete repro's console output shows exactly where the time goes. Pure
// instrumentation: no behavior change.
//
// THE master switch for the whole client-side apparatus — flip it to true to profile again. It also
// gates Vue's own component profiling (MindWaveCore/ui/src/boot/module-plugins.ts sets
// `app.config.performance = PERF_LOG_ENABLED`), which is deliberately NOT free: Vue marks and
// measures every component instance on every lifecycle phase (~200 calls per edit here). See
// AGENTS.md, «Perf diagnostics».
//
// OFF since 2026-07-23: the investigation it was written for is closed (its findings are in the
// code comments below and in MindWaveCore/docs/undo-journal-row-actions/), and leaving it on costs
// real time in daily use.
export const PERF_LOG_ENABLED = false

// 2026-07-22: signature()/commitEdit/exportUndoJournal/refreshEditState's own sub-stages are now
// CONFIRMED flat and fast (sub-5ms) across two full repros on a 700+-point, 50+-step file — logging
// them every single edit is 15-20 console.info calls/edit that no longer earn their keep and are
// themselves a candidate cause of the console-volume-vs-DevTools-overhead confound we're actively
// ruling out. Split into its own gate, defaulted OFF, so it can be flipped back on around a specific
// suspect stage without paying for it everywhere. perfLog (outer operation totals, network, longtask,
// event-loop-lag) stays on PERF_LOG_ENABLED alone.
export const PERF_LOG_VERBOSE = false

const TAG = '[gtrack-perf]'

export function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** Logs `label: N.Nms key=value ...`. Call with the value perfNow() returned at the stage's start. */
export function perfLog(label: string, startMs: number, extra?: Readonly<Record<string, number | string>>): number {
  const ms = perfNow() - startMs
  if (PERF_LOG_ENABLED) {
    const ctx = extra === undefined ? '' : ` ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ')}`
    console.info(`${TAG} ${label}: ${ms.toFixed(1)}ms${ctx}`)
  }
  return ms
}

/** Same as perfLog but gated by PERF_LOG_VERBOSE — for the high-frequency internal sub-stages
 *  (signature/commitEdit/exportUndoJournal breakdowns) already confirmed fast, kept available to
 *  re-enable around one suspect without reverting to full per-edit noise. */
export function perfLogVerbose(label: string, startMs: number, extra?: Readonly<Record<string, number | string>>): number {
  const ms = perfNow() - startMs
  if (PERF_LOG_ENABLED && PERF_LOG_VERBOSE) {
    const ctx = extra === undefined ? '' : ` ${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ')}`
    console.info(`${TAG} ${label}: ${ms.toFixed(1)}ms${ctx}`)
  }
  return ms
}

/** Cheap O(voices) size probe — point counts are already-stored array lengths, no point-array walk. */
export function scheduleSize(
  schedule: { voices: readonly { points: readonly unknown[] }[] } | null | undefined,
): { voices: number; points: number } {
  if (schedule === null || schedule === undefined) return { voices: 0, points: 0 }
  let points = 0
  for (const v of schedule.voices) points += v.points.length
  return { voices: schedule.voices.length, points }
}

// 2026-07-22: draw() itself stays flat (0.1-1.5ms, voices=1, never grows) and diagnostics/lintSchedule
// are ruled out (diagnostics=0 all session) — yet <TracksPanel> patch keeps climbing with cumulative
// EDIT COUNT, not with current data size. That shape (fast at first, degrades only as the session goes
// on) is the signature of something accumulating that never gets cleaned up. If GTrackView instances
// were being recreated without the old one's onBeforeUnmount actually firing (or firing but leaving a
// dangling rAF/observer some other way), the live count would climb by ~1 per edit forever. This is a
// module-level (not per-instance) counter — genuinely shared across every mounted component — logging
// the CURRENT total live count on every change, so growth across the session is directly visible.
const liveInstanceCounts = new Map<string, number>()
export function trackMount(label: string): void {
  if (!PERF_LOG_ENABLED) return
  const next = (liveInstanceCounts.get(label) ?? 0) + 1
  liveInstanceCounts.set(label, next)
  console.info(`${TAG} mount ${label}: live=${next}`)
}
export function trackUnmount(label: string): void {
  if (!PERF_LOG_ENABLED) return
  const next = (liveInstanceCounts.get(label) ?? 0) - 1
  liveInstanceCounts.set(label, next)
  console.info(`${TAG} unmount ${label}: live=${next}`)
}

/** A backgrounded/unfocused tab throttles rAF (and, more mildly, timers/microtasks) almost to a
 *  halt — a huge nextTick/paint number is routinely just "the tab wasn't in front", not real
 *  render cost. Attach this to any perfLog whose stage crosses a rAF/microtask boundary so that
 *  confound is visible in the log itself instead of being guessed at afterwards. */
export function visibilityInfo(): { hidden: number | string; focused: number | string } {
  if (typeof document === 'undefined') return { hidden: 'n/a', focused: 'n/a' }
  return {
    hidden: document.hidden ? 1 : 0,
    focused: typeof document.hasFocus === 'function' ? (document.hasFocus() ? 1 : 0) : 'n/a',
  }
}

// A big gap between a client fetch() and the server's own handler timer (seen 2026-07-22: 300-700ms
// client vs single-digit ms server, for the SAME request) means the main thread was busy with
// something else entirely BEFORE our code even got to run — a composable-level timer can't see that,
// it only brackets its own body. The Long Tasks API reports any >50ms main-thread task regardless of
// which subsystem caused it, so it catches this directly instead of leaving it to be inferred from
// side effects (nextTick/paint delay, fetch delay). Self-starting: importing this module is enough.
if (PERF_LOG_ENABLED && typeof PerformanceObserver !== 'undefined') {
  try {
    const supported = (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')
    if (supported) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const attribution = (entry as unknown as { attribution?: readonly { name?: string; containerType?: string }[] }).attribution
          const culprit = attribution?.[0]
          const ctx = culprit === undefined ? '' : ` name=${culprit.name ?? '?'} container=${culprit.containerType ?? '?'}`
          console.info(`${TAG} longtask: ${entry.duration.toFixed(1)}ms startedAt=${entry.startTime.toFixed(0)}${ctx}`)
        }
      })
      observer.observe({ type: 'longtask', buffered: true })
    }
  } catch {
    // Long Tasks API unsupported/unavailable in this WebView2 build — diagnostics must never throw.
  }
}

// 2026-07-22: longtask confirmed the block is real and client-side (server event-loop-lag probe
// stayed silent throughout, tab stayed focused, and cutting our OWN console volume ~4x didn't move
// the numbers) — but "name=unknown container=window" doesn't say WHICH component. Vue 3, with
// app.config.performance = true (set in ui/src/boot/module-plugins.ts), emits a performance.measure
// per component per lifecycle phase named "<ComponentName> mount/patch/render" — exactly the
// attribution longtask couldn't give us. Observing 'measure' surfaces those automatically instead of
// needing the owner to open and read the DevTools Performance panel by hand.
if (PERF_LOG_ENABLED && typeof PerformanceObserver !== 'undefined') {
  try {
    const supported = (PerformanceObserver.supportedEntryTypes ?? []).includes('measure')
    if (supported) {
      const MEASURE_THRESHOLD_MS = 10
      // undo-log-perf investigation (2026-07-23): the 10ms threshold hides individual <QItem>
      // mount/patch entries (each is well under it), so the log can't say how MANY rows actually
      // got touched per edit — only the aggregate <QList> patch total. Tally every QItem entry
      // (any duration) between one <QList> patch and the next and print the count + summed cost
      // alongside it: that distinguishes "virtual-scroll is rendering way more than the visible
      // window" (count keeps climbing) from "the same handful of rows just each got slower".
      let qitemCount = 0
      let qitemTotalMs = 0
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // 2026-07-23: Vue's measure names carry the angle brackets ("<QItem> patch"), so the
          // first version of this tally matched nothing and silently never reported. Confirmed
          // against the owner's log, where the per-QItem lines print but no qitems= ever appeared.
          if (entry.name === '<QItem> mount' || entry.name === '<QItem> patch') {
            qitemCount += 1
            qitemTotalMs += entry.duration
            continue
          }
          if (entry.duration < MEASURE_THRESHOLD_MS) continue
          if (entry.name === '<QList> patch') {
            console.info(
              `${TAG} vue-measure ${entry.name}: ${entry.duration.toFixed(1)}ms startedAt=${entry.startTime.toFixed(0)} `
              + `qitems=${qitemCount} qitemsTotal=${qitemTotalMs.toFixed(1)}ms`,
            )
            qitemCount = 0
            qitemTotalMs = 0
            continue
          }
          console.info(`${TAG} vue-measure ${entry.name}: ${entry.duration.toFixed(1)}ms startedAt=${entry.startTime.toFixed(0)}`)
        }
        // 2026-07-23: Vue's endMeasure clears its own MARKS but never the MEASURES, so the
        // user-timing buffer grows without bound — hundreds of entries per edit, tens of
        // thousands within a session — and performance.measure() itself gets slower as it fills.
        // That is a strong suspect for the uniform, cumulative slowdown seen across UNRELATED
        // component trees (<QList> and <TracksPanel> both ~5-6x slower over one session while
        // their own item counts stayed flat). We have already consumed these entries here, so
        // dropping them costs nothing and keeps the buffer bounded.
        try {
          performance.clearMeasures()
        } catch {
          // not fatal — diagnostics must never throw into the app.
        }
      })
      observer.observe({ type: 'measure', buffered: true })
    }
  } catch {
    // performance.measure observation unsupported/unavailable — diagnostics must never throw.
  }
}
