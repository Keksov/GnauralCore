// SB1.1 — time-position formatting for the Tracks-editor status bar (status-bar plan, SB-D4/D5).
//
// The status bar shows the cursor position (editable) and the clip duration (read-only) in one of
// several formats the owner listed (req 2b). This module is the pure, Vue-free core: it maps a
// number of seconds to/from a display string for each format, and auto-picks a sensible default
// format from the clip duration. The Vue layer (SB2.2) owns the persisted per-file choice and the
// two-way binding to the playhead.
//
// The owner dropped "hh:mm:ss + samples" (2026-07-14) so no sample rate is involved — everything
// here is a plain seconds<->string transform. All formatting decomposes an INTEGER count of the
// format's smallest unit (1s / 1/100s / 1/1000s) so minute/second fields never roll over from
// floating-point error. Parsing is deliberately lenient (see parseTime).

/** The six position/duration display formats (owner req. 2b, minus the dropped samples format). */
export type TimeFormat = 'sec' | 'sec_ms' | 'hms' | 'dhms' | 'hms_cs' | 'hms_ms'

/** Canonical order — drives the format-picker list in the gear menu (SB2.2). */
export const TIME_FORMATS: readonly TimeFormat[] = [
  'sec', 'sec_ms', 'hms', 'dhms', 'hms_cs', 'hms_ms',
]

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 3600
const SEC_PER_DAY = 86400

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/**
 * Split `sec` into calendar fields using an INTEGER count of `unitsPerSec` sub-second units, so the
 * seconds field is exact and never rolls to 60 from FP drift. `withDays` keeps hours in [0,24) and
 * exposes a separate days field; otherwise hours accumulate (e.g. 30:00:00).
 */
function decompose(sec: number, unitsPerSec: number, withDays: boolean) {
  const perMin = SEC_PER_MIN * unitsPerSec
  const perHour = SEC_PER_HOUR * unitsPerSec
  const perDay = SEC_PER_DAY * unitsPerSec
  let u = Math.round(Math.max(0, sec) * unitsPerSec) // total units, >= 0

  const days = withDays ? Math.floor(u / perDay) : 0
  if (withDays) u -= days * perDay
  const hours = Math.floor(u / perHour)
  u -= hours * perHour
  const minutes = Math.floor(u / perMin)
  u -= minutes * perMin
  // `u` is now the units within the current minute: [0, 60*unitsPerSec).
  const wholeSeconds = Math.floor(u / unitsPerSec)
  const frac = u - wholeSeconds * unitsPerSec
  return { days, hours, minutes, wholeSeconds, frac }
}

/** Format a position/duration in seconds as a display string in the given format. */
export function formatTime(sec: number, fmt: TimeFormat): string {
  const s = Number.isFinite(sec) ? Math.max(0, sec) : 0
  switch (fmt) {
    case 'sec':
      return String(Math.round(s))
    case 'sec_ms':
      return s.toFixed(3)
    case 'hms': {
      const { hours, minutes, wholeSeconds } = decompose(s, 1, false)
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}`
    }
    case 'dhms': {
      const { days, hours, minutes, wholeSeconds } = decompose(s, 1, true)
      return `${days}:${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}`
    }
    case 'hms_cs': {
      const { hours, minutes, wholeSeconds, frac } = decompose(s, 100, false)
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}.${pad(frac, 2)}`
    }
    case 'hms_ms': {
      const { hours, minutes, wholeSeconds, frac } = decompose(s, 1000, false)
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}.${pad(frac, 3)}`
    }
  }
}

/**
 * Parse a user-entered string back to seconds for the given format. Lenient by design (req 2a — the
 * field is edited by hand): a decimal comma is accepted, and colon-formats read fewer groups than
 * their canonical shape (e.g. "1:30" -> 90s, "90" -> 90s) taking groups right-to-left as
 * seconds, minutes, hours, days. Returns NaN for empty/invalid input (the caller keeps the old
 * value); the caller clamps into range via clampSec.
 */
export function parseTime(str: string, fmt: TimeFormat): number {
  const s = str.trim().replace(',', '.')
  if (s === '') return NaN

  if (fmt === 'sec' || fmt === 'sec_ms') {
    const v = Number(s)
    return Number.isFinite(v) ? v : NaN
  }

  // Colon formats (hms / dhms / hms_cs / hms_ms) — parse right-to-left.
  const groups = s.split(':')
  if (groups.length > 4) return NaN
  const mult = [1, SEC_PER_MIN, SEC_PER_HOUR, SEC_PER_DAY]
  let total = 0
  for (let i = 0; i < groups.length; i++) {
    const v = Number(groups[groups.length - 1 - i])
    if (!Number.isFinite(v)) return NaN
    total += v * mult[i]
  }
  return total
}

/** Clamp a position into the valid [0, duration] range (SB-D6; duration<=0/NaN -> just floor at 0). */
export function clampSec(sec: number, durationSec: number): number {
  if (!Number.isFinite(sec)) return 0
  const lo = Math.max(0, sec)
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.min(lo, durationSec) : lo
}

/**
 * Auto-pick a default format from the clip duration (SB-D5, thresholds confirmed by owner
 * 2026-07-14): sub-minute -> seconds+millis; sub-hour -> hh:mm:ss+hundredths; sub-day -> hh:mm:ss;
 * a day or more -> dd:hh:mm:ss.
 */
export function autoPickFormat(durationSec: number): TimeFormat {
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  if (d < SEC_PER_MIN) return 'sec_ms'
  if (d < SEC_PER_HOUR) return 'hms_cs'
  if (d < SEC_PER_DAY) return 'hms'
  return 'dhms'
}
