import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayRange,
  formatHm,
  formatHms,
  formatSignedHm,
  fromKstInputValue,
  isWeekend,
  kstDayKey,
  kstDayStartMs,
  kstIso,
  kstWeekday,
  startOfKstWeek,
  toKstInputValue,
} from './time';

describe('KST day boundaries', () => {
  it('flips the day key at 15:00 UTC, not at UTC midnight', () => {
    expect(kstDayKey(Date.UTC(2026, 7, 5, 14, 59, 59, 999))).toBe('2026-08-05');
    expect(kstDayKey(Date.UTC(2026, 7, 5, 15, 0, 0, 0))).toBe('2026-08-06');
    // UTC midnight is 09:00 KST — still the same KST day that began 9h earlier.
    expect(kstDayKey(Date.UTC(2026, 7, 6, 0, 0, 0, 0))).toBe('2026-08-06');
  });

  it('round-trips a day key through its KST midnight', () => {
    expect(kstDayStartMs('2026-08-06')).toBe(Date.UTC(2026, 7, 5, 15, 0, 0, 0));
    expect(kstDayKey(kstDayStartMs('2026-08-06'))).toBe('2026-08-06');
    expect(kstDayKey(kstDayStartMs('2026-08-06') + 86_399_999)).toBe('2026-08-06');
    expect(kstDayKey(kstDayStartMs('2026-08-06') + 86_400_000)).toBe('2026-08-07');
  });

  it('reads weekdays in KST', () => {
    expect(kstWeekday('2026-08-06')).toBe(4); // Thursday
    expect(kstWeekday('2026-08-08')).toBe(6); // Saturday
    expect(isWeekend('2026-08-08')).toBe(true);
    expect(isWeekend('2026-08-09')).toBe(true);
    expect(isWeekend('2026-08-07')).toBe(false);
  });

  it('crosses month and year boundaries when adding days', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('builds inclusive ranges and empty ranges', () => {
    expect(dayRange('2026-08-05', '2026-08-08')).toEqual([
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
    ]);
    expect(dayRange('2026-08-08', '2026-08-05')).toEqual([]);
    expect(dayRange('2026-08-08', '2026-08-08')).toEqual(['2026-08-08']);
  });

  it('starts weeks on Monday, including from a Sunday', () => {
    expect(startOfKstWeek('2026-08-06')).toBe('2026-08-03'); // Thu -> Mon
    expect(startOfKstWeek('2026-08-03')).toBe('2026-08-03'); // Mon -> itself
    expect(startOfKstWeek('2026-08-09')).toBe('2026-08-03'); // Sun -> previous Mon
  });
});

describe('datetime-local conversion is KST, not host-local', () => {
  it('round-trips through KST regardless of the host timezone', () => {
    const ts = Date.UTC(2026, 7, 5, 15, 30); // 2026-08-06 00:30 KST
    expect(toKstInputValue(ts)).toBe('2026-08-06T00:30');
    expect(fromKstInputValue('2026-08-06T00:30')).toBe(ts);
  });

  it('accepts optional seconds and rejects junk', () => {
    expect(fromKstInputValue('2026-08-06T00:30:45')).toBe(Date.UTC(2026, 7, 5, 15, 30, 45));
    expect(fromKstInputValue('not a date')).toBeNull();
    expect(fromKstInputValue('')).toBeNull();
  });

  it('stamps exports with an explicit +09:00 offset', () => {
    expect(kstIso(Date.UTC(2026, 7, 5, 15, 0, 0))).toBe('2026-08-06T00:00:00+09:00');
  });
});

describe('duration formatting', () => {
  it('pads to HH:MM:SS and does not roll hours over', () => {
    expect(formatHms(0)).toBe('00:00:00');
    expect(formatHms(28_799)).toBe('07:59:59');
    expect(formatHms(28_800)).toBe('08:00:00');
    expect(formatHms(180_000)).toBe('50:00:00');
  });

  it('clamps negatives to zero so the hero can never render a minus sign', () => {
    expect(formatHms(-1)).toBe('00:00:00');
    expect(formatHm(-5)).toBe('0h 00m');
  });

  it('renders signed deltas with a true minus sign', () => {
    expect(formatSignedHm(5400)).toBe('+1h 30m');
    expect(formatSignedHm(-7200)).toBe('−2h 00m');
    expect(formatSignedHm(0)).toBe('0h 00m');
  });
});
