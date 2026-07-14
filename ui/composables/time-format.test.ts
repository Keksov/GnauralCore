import { describe, expect, test } from 'bun:test'

import {
  autoPickFormat,
  clampSec,
  formatTime,
  parseTime,
  TIME_FORMATS,
  type TimeFormat,
} from './time-format'

describe('formatTime', () => {
  // 1d 2h 3m 4.567s = 93784.567s
  const T = SEC(1, 2, 3, 4) + 0.567

  test('sec rounds to whole seconds', () => {
    expect(formatTime(3.4, 'sec')).toBe('3')
    expect(formatTime(3.6, 'sec')).toBe('4')
    expect(formatTime(3723, 'sec')).toBe('3723')
  })

  test('sec_ms shows three decimals', () => {
    expect(formatTime(3.4, 'sec_ms')).toBe('3.400')
    expect(formatTime(0, 'sec_ms')).toBe('0.000')
    expect(formatTime(93784.567, 'sec_ms')).toBe('93784.567')
  })

  test('hms accumulates hours past 24 (no day field)', () => {
    expect(formatTime(SEC(0, 1, 2, 3), 'hms')).toBe('01:02:03')
    expect(formatTime(SEC(1, 2, 3, 4), 'hms')).toBe('26:03:04') // 1 day folds into hours
    expect(formatTime(59, 'hms')).toBe('00:00:59')
  })

  test('dhms splits out days', () => {
    expect(formatTime(SEC(1, 2, 3, 4), 'dhms')).toBe('1:02:03:04')
    expect(formatTime(SEC(0, 5, 0, 0), 'dhms')).toBe('0:05:00:00')
  })

  test('hms_cs shows hundredths', () => {
    expect(formatTime(SEC(0, 1, 2, 3) + 0.45, 'hms_cs')).toBe('01:02:03.45')
    expect(formatTime(3.05, 'hms_cs')).toBe('00:00:03.05')
  })

  test('hms_ms shows milliseconds', () => {
    expect(formatTime(SEC(0, 1, 2, 3) + 0.456, 'hms_ms')).toBe('01:02:03.456')
    expect(formatTime(T, 'hms_ms')).toBe('26:03:04.567')
  })

  test('no rollover near a minute boundary', () => {
    // 59.999s must not render as :60 in any format.
    expect(formatTime(59.999, 'hms_cs')).toBe('00:01:00.00')
    expect(formatTime(59.999, 'hms_ms')).toBe('00:00:59.999')
    expect(formatTime(59.6, 'hms')).toBe('00:01:00')
  })

  test('negative / non-finite floors at zero', () => {
    expect(formatTime(-5, 'hms')).toBe('00:00:00')
    expect(formatTime(NaN, 'sec_ms')).toBe('0.000')
    expect(formatTime(Infinity, 'sec')).toBe('0')
  })
})

describe('parseTime', () => {
  test('plain seconds formats', () => {
    expect(parseTime('90', 'sec')).toBe(90)
    expect(parseTime('3.5', 'sec_ms')).toBe(3.5)
    expect(parseTime('3,5', 'sec_ms')).toBe(3.5) // decimal comma accepted
  })

  test('colon formats, right-to-left, lenient group count', () => {
    expect(parseTime('01:02:03', 'hms')).toBe(SEC(0, 1, 2, 3))
    expect(parseTime('1:30', 'hms')).toBe(90) // fewer groups than canonical
    expect(parseTime('90', 'hms')).toBe(90) // no colon at all
    expect(parseTime('1:02:03:04', 'dhms')).toBe(SEC(1, 2, 3, 4))
    expect(parseTime('01:02:03.45', 'hms_cs')).toBeCloseTo(SEC(0, 1, 2, 3) + 0.45, 6)
  })

  test('empty / invalid -> NaN', () => {
    expect(parseTime('', 'sec')).toBeNaN()
    expect(parseTime('   ', 'hms')).toBeNaN()
    expect(parseTime('abc', 'sec')).toBeNaN()
    expect(parseTime('1:2:3:4:5', 'dhms')).toBeNaN() // too many groups
  })
})

describe('round-trip format -> parse', () => {
  // Every format re-parses to (approximately) the original within its own resolution.
  const RES: Record<TimeFormat, number> = {
    sec: 0.5, sec_ms: 5e-4, hms: 0.5, dhms: 0.5, hms_cs: 5e-3, hms_ms: 5e-4,
  }
  const samples = [0, 0.123, 7.5, 59.999, 3661.25, 93784.567]
  for (const fmt of TIME_FORMATS) {
    test(fmt, () => {
      for (const s of samples) {
        const back = parseTime(formatTime(s, fmt), fmt)
        expect(Math.abs(back - s)).toBeLessThanOrEqual(RES[fmt])
      }
    })
  }
})

describe('clampSec', () => {
  test('clamps into [0, duration]', () => {
    expect(clampSec(-3, 100)).toBe(0)
    expect(clampSec(150, 100)).toBe(100)
    expect(clampSec(42, 100)).toBe(42)
  })
  test('non-finite / no duration', () => {
    expect(clampSec(NaN, 100)).toBe(0)
    expect(clampSec(50, 0)).toBe(50) // unknown duration -> only floor at 0
    expect(clampSec(-1, NaN)).toBe(0)
  })
})

describe('autoPickFormat (owner thresholds 2026-07-14)', () => {
  test('by duration', () => {
    expect(autoPickFormat(30)).toBe('sec_ms') // < 60s
    expect(autoPickFormat(59.9)).toBe('sec_ms')
    expect(autoPickFormat(60)).toBe('hms_cs') // < 1h
    expect(autoPickFormat(3599)).toBe('hms_cs')
    expect(autoPickFormat(3600)).toBe('hms') // < 24h
    expect(autoPickFormat(86399)).toBe('hms')
    expect(autoPickFormat(86400)).toBe('dhms') // >= 24h
  })
  test('degenerate durations', () => {
    expect(autoPickFormat(0)).toBe('sec_ms')
    expect(autoPickFormat(NaN)).toBe('sec_ms')
    expect(autoPickFormat(-5)).toBe('sec_ms')
  })
})

/** days/hours/minutes/seconds -> total seconds, for readable expectations. */
function SEC(d: number, h: number, m: number, s: number): number {
  return d * 86400 + h * 3600 + m * 60 + s
}
