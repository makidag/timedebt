import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import {
  buildLedger,
  computeStreak,
  normalizeIntervals,
  weekSlice,
  type DayEntry,
  type Interval,
  type Ledger,
} from './ledger';
import { fromKstInputValue, type DayKey } from './time';

// 2026-08-03 Mon … 2026-08-07 Fri, 2026-08-08 Sat, 2026-08-09 Sun.
const kst = (wallClock: string): number => {
  const ms = fromKstInputValue(wallClock);
  if (ms === null) throw new Error(`bad KST literal: ${wallClock}`);
  return ms;
};

const h = (hours: number): number => hours * 3600;

let seq = 0;
beforeEach(() => {
  seq = 0;
});

const iv = (start: string, end: string | null): Interval => {
  seq += 1;
  const startMs = kst(start);
  const endMs = end === null ? null : kst(end);
  return { id: `iv${seq}`, start: startMs, end: endMs, heartbeatAt: endMs ?? startMs };
};

const build = (intervals: Interval[], now: string): Ledger =>
  buildLedger(intervals, kst(now), DEFAULT_CONFIG);

const day = (ledger: Ledger, date: DayKey): DayEntry => {
  const found = ledger.days.find((d) => d.date === date);
  if (!found) throw new Error(`no ledger row for ${date}`);
  return found;
};

describe('daily targets', () => {
  it('requires 8h Monday through Friday and 0 on the weekend', () => {
    const ledger = build([iv('2026-08-03T09:00', '2026-08-03T10:00')], '2026-08-10T09:00');
    expect(day(ledger, '2026-08-03').targetSeconds).toBe(28_800); // Mon
    expect(day(ledger, '2026-08-07').targetSeconds).toBe(28_800); // Fri
    expect(day(ledger, '2026-08-08').targetSeconds).toBe(0); // Sat
    expect(day(ledger, '2026-08-09').targetSeconds).toBe(0); // Sun
  });
});

describe('productive is all-or-nothing', () => {
  it('does not count 7h59m59s as productive, and counts exactly 8h', () => {
    const short = build([iv('2026-08-03T09:00:00', '2026-08-03T16:59:59')], '2026-08-04T09:00');
    expect(day(short, '2026-08-03').trackedSeconds).toBe(28_799);
    expect(day(short, '2026-08-03').met).toBe(false);

    const exact = build([iv('2026-08-03T09:00:00', '2026-08-03T17:00:00')], '2026-08-04T09:00');
    expect(day(exact, '2026-08-03').trackedSeconds).toBe(28_800);
    expect(day(exact, '2026-08-03').met).toBe(true);
  });

  it('gives no partial credit toward the flag, only toward the balance', () => {
    const ledger = build([iv('2026-08-03T09:00', '2026-08-03T16:00')], '2026-08-04T09:00');
    expect(day(ledger, '2026-08-03').met).toBe(false);
    expect(day(ledger, '2026-08-03').deltaSeconds).toBe(h(1)); // 7h worked, 1h owed
  });
});

describe('debt is a net balance', () => {
  // The worked example from the spec.
  it('5h Thursday leaves 3h of debt; 10h Friday reduces it to 1h', () => {
    const thursdayOnly = build([iv('2026-08-06T09:00', '2026-08-06T14:00')], '2026-08-07T09:00');
    expect(thursdayOnly.carriedBalanceSeconds).toBe(h(3));
    expect(thursdayOnly.debtSeconds).toBe(h(3));

    const both = build(
      [iv('2026-08-06T09:00', '2026-08-06T14:00'), iv('2026-08-07T08:00', '2026-08-07T18:00')],
      '2026-08-08T09:00',
    );
    expect(both.carriedBalanceSeconds).toBe(h(1));
    expect(both.debtSeconds).toBe(h(1));
    expect(both.creditSeconds).toBe(0);
  });

  it('accrues a full 8h of debt for untouched workdays in the middle of a range', () => {
    // Worked Mon, nothing Tue/Wed/Thu, worked Fri. now = Saturday.
    const ledger = build(
      [iv('2026-08-03T09:00', '2026-08-03T17:00'), iv('2026-08-07T09:00', '2026-08-07T17:00')],
      '2026-08-08T09:00',
    );
    expect(ledger.days.map((d) => d.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
    ]);
    expect(day(ledger, '2026-08-04').trackedSeconds).toBe(0);
    expect(day(ledger, '2026-08-04').deltaSeconds).toBe(h(8));
    // Three untouched weekdays = 24h of debt; Mon and Fri were met.
    expect(ledger.carriedBalanceSeconds).toBe(h(24));
  });

  it('banks credit as a negative balance when a weekday runs long', () => {
    const ledger = build([iv('2026-08-03T08:00', '2026-08-03T18:00')], '2026-08-04T09:00');
    expect(ledger.carriedBalanceSeconds).toBe(h(-2));
    expect(ledger.debtSeconds).toBe(0);
    expect(ledger.creditSeconds).toBe(h(2));
  });
});

describe('the credit cap', () => {
  it('holds after an unusually long weekend', () => {
    // 12h Saturday + 12h Sunday = 24h of credit, capped at 16h.
    const ledger = build(
      [iv('2026-08-08T08:00', '2026-08-08T20:00'), iv('2026-08-09T08:00', '2026-08-09T20:00')],
      '2026-08-10T09:00',
    );
    expect(ledger.carriedBalanceSeconds).toBe(-DEFAULT_CONFIG.maxCreditSeconds);
    expect(ledger.creditSeconds).toBe(57_600);
  });

  it('clamps day by day, so a heroic weekend cannot buy a slack week', () => {
    const heroicWeekend = [
      iv('2026-08-08T08:00', '2026-08-08T20:00'),
      iv('2026-08-09T08:00', '2026-08-09T20:00'),
    ];
    // Monday untouched: the cap already discarded the excess, so Monday's 8h
    // lands on a −16h balance, not on the uncapped −24h.
    const ledger = build(heroicWeekend, '2026-08-11T09:00');
    expect(ledger.carriedBalanceSeconds).toBe(h(-8));
  });

  it('does not cap debt', () => {
    const ledger = build([], '2026-08-10T09:00');
    expect(ledger.carriedBalanceSeconds).toBe(0); // no history, no debt
    const withHistory = build([iv('2026-07-27T09:00', '2026-07-27T09:01')], '2026-08-10T09:00');
    expect(withHistory.carriedBalanceSeconds).toBeGreaterThan(DEFAULT_CONFIG.maxCreditSeconds);
  });
});

describe('today does not accrue debt until it ends', () => {
  it('shows only carried-in debt at 09:00 on an untouched workday', () => {
    // 5h on Thursday leaves 3h. Friday 09:00, nothing tracked yet.
    const ledger = build([iv('2026-08-06T09:00', '2026-08-06T14:00')], '2026-08-07T09:00');
    expect(ledger.today.trackedSeconds).toBe(0);
    expect(ledger.debtSeconds).toBe(h(3)); // not 3h + 8h
    expect(ledger.carriedBalanceSeconds).toBe(h(3));
  });

  it('projects what the balance becomes if the day ended now', () => {
    const ledger = build([iv('2026-08-06T09:00', '2026-08-06T14:00')], '2026-08-07T09:00');
    expect(ledger.projectedBalanceSeconds).toBe(h(11)); // 3h carried + 8h unworked
  });

  it("lands today's shortfall on the balance once KST midnight passes", () => {
    const intervals = [iv('2026-08-06T09:00', '2026-08-06T14:00')];
    const duringThursday = build(intervals, '2026-08-06T23:59:59');
    expect(duringThursday.carriedBalanceSeconds).toBe(0);
    expect(duringThursday.debtSeconds).toBe(0);

    const afterMidnight = build(intervals, '2026-08-07T00:00:00');
    expect(afterMidnight.carriedBalanceSeconds).toBe(h(3));
    expect(afterMidnight.debtSeconds).toBe(h(3));
  });
});

describe("today's hours pay old debt only after today's own target is met", () => {
  it('leaves carried debt untouched while today is still short of 8h', () => {
    // 3h carried in from Thursday, 7h done on Friday.
    const ledger = build(
      [iv('2026-08-06T09:00', '2026-08-06T14:00'), iv('2026-08-07T09:00', '2026-08-07T16:00')],
      '2026-08-07T16:00',
    );
    expect(ledger.today.trackedSeconds).toBe(h(7));
    expect(ledger.surplusSeconds).toBe(0);
    expect(ledger.debtSeconds).toBe(h(3));
  });

  it('pays old debt with the surplus once today crosses 8h', () => {
    const ledger = build(
      [iv('2026-08-06T09:00', '2026-08-06T14:00'), iv('2026-08-07T09:00', '2026-08-07T19:00')],
      '2026-08-07T19:00',
    );
    expect(ledger.today.trackedSeconds).toBe(h(10));
    expect(ledger.surplusSeconds).toBe(h(2));
    expect(ledger.debtSeconds).toBe(h(1)); // 3h carried − 2h surplus
  });

  it('reduces weekend debt from the first tracked second', () => {
    const carried = [
      iv('2026-08-06T09:00', '2026-08-06T14:00'), // Thu, 5h → 3h of debt
      iv('2026-08-07T09:00', '2026-08-07T17:00'), // Fri, met
    ];
    const atRest = build(carried, '2026-08-08T09:00:00');
    expect(atRest.debtSeconds).toBe(h(3));

    const oneSecond = build([...carried, iv('2026-08-08T09:00:00', '2026-08-08T09:00:01')], '2026-08-08T09:00:01');
    expect(oneSecond.today.targetSeconds).toBe(0);
    expect(oneSecond.surplusSeconds).toBe(1);
    expect(oneSecond.debtSeconds).toBe(h(3) - 1);
  });

  it('never renders a negative debt figure, showing banked credit instead', () => {
    const ledger = build(
      [iv('2026-08-03T08:00', '2026-08-03T18:00'), iv('2026-08-04T08:00', '2026-08-04T19:00')],
      '2026-08-04T19:00',
    );
    // Monday banked 2h; today is Tuesday with a 3h surplus.
    expect(ledger.carriedBalanceSeconds).toBe(h(-2));
    expect(ledger.surplusSeconds).toBe(h(3));
    expect(ledger.debtSeconds).toBe(0);
    expect(ledger.creditSeconds).toBe(h(5));
    expect(ledger.displayedBalanceSeconds).toBe(h(-5));
  });
});

describe('interval normalization', () => {
  it('splits an interval spanning KST midnight across two days', () => {
    const ledger = build([iv('2026-08-06T22:00', '2026-08-07T03:00')], '2026-08-08T09:00');
    expect(day(ledger, '2026-08-06').trackedSeconds).toBe(h(2));
    expect(day(ledger, '2026-08-07').trackedSeconds).toBe(h(3));
  });

  it('buckets by KST, not UTC: 00:30 KST belongs to the new day', () => {
    // 2026-08-05 15:30 UTC == 2026-08-06 00:30 KST.
    const interval: Interval = {
      id: 'utc',
      start: Date.UTC(2026, 7, 5, 15, 30),
      end: Date.UTC(2026, 7, 5, 16, 30),
      heartbeatAt: Date.UTC(2026, 7, 5, 16, 30),
    };
    const ledger = buildLedger([interval], kst('2026-08-08T09:00'), DEFAULT_CONFIG);
    expect(day(ledger, '2026-08-06').trackedSeconds).toBe(h(1));
    expect(ledger.days.some((d) => d.date === '2026-08-05')).toBe(false);
  });

  it('merges overlapping intervals rather than summing them', () => {
    const ledger = build(
      [iv('2026-08-03T09:00', '2026-08-03T12:00'), iv('2026-08-03T11:00', '2026-08-03T14:00')],
      '2026-08-04T09:00',
    );
    expect(day(ledger, '2026-08-03').trackedSeconds).toBe(h(5)); // 09–14, not 6h
    expect(ledger.anomalies.map((a) => a.kind)).toContain('overlap-merged');
  });

  it('merges a fully contained interval', () => {
    const ledger = build(
      [iv('2026-08-03T09:00', '2026-08-03T17:00'), iv('2026-08-03T10:00', '2026-08-03T11:00')],
      '2026-08-04T09:00',
    );
    expect(day(ledger, '2026-08-03').trackedSeconds).toBe(h(8));
  });

  it('joins abutting intervals without flagging an overlap', () => {
    const ledger = build(
      [iv('2026-08-03T09:00', '2026-08-03T12:00'), iv('2026-08-03T12:00', '2026-08-03T14:00')],
      '2026-08-04T09:00',
    );
    expect(day(ledger, '2026-08-03').trackedSeconds).toBe(h(5));
    expect(ledger.anomalies).toEqual([]);
  });

  it('measures a running interval against now and never past it', () => {
    const ledger = build([iv('2026-08-06T09:00', null)], '2026-08-06T11:30');
    expect(ledger.today.trackedSeconds).toBe(h(2.5));
    expect(ledger.isRunning).toBe(true);
    expect(ledger.runningSince).toBe(kst('2026-08-06T09:00'));
    expect(ledger.normalized.every((n) => n.end <= kst('2026-08-06T11:30'))).toBe(true);
  });

  it('clamps an end that sits in the future and flags it', () => {
    const ledger = build([iv('2026-08-06T09:00', '2026-08-06T23:00')], '2026-08-06T11:00');
    expect(ledger.today.trackedSeconds).toBe(h(2));
    expect(ledger.anomalies.map((a) => a.kind)).toContain('future-end-clamped');
  });

  it('discards an interval that ends before it starts', () => {
    const ledger = build([iv('2026-08-06T12:00', '2026-08-06T09:00')], '2026-08-06T13:00');
    expect(ledger.today.trackedSeconds).toBe(0);
    expect(ledger.anomalies.map((a) => a.kind)).toEqual(['negative-duration']);
  });

  it('does not count an interval that starts in the future', () => {
    const ledger = build([iv('2026-08-07T09:00', '2026-08-07T17:00')], '2026-08-06T13:00');
    expect(ledger.days.every((d) => d.trackedSeconds === 0)).toBe(true);
    expect(ledger.anomalies.map((a) => a.kind)).toContain('future-start');
  });

  it('truncates an abandoned session at the 12h cap and flags it', () => {
    const ledger = build([iv('2026-08-06T08:00', null)], '2026-08-07T09:00');
    // Open since 08:00 Thursday, now 09:00 Friday: 25h of wall clock, 12h counted.
    expect(day(ledger, '2026-08-06').trackedSeconds).toBe(h(12));
    expect(day(ledger, '2026-08-07').trackedSeconds).toBe(0);
    const truncated = ledger.anomalies.find((a) => a.kind === 'truncated');
    expect(truncated?.intervalIds).toEqual(['iv1']);
  });

  it('keeps normalization pure — the input array is not mutated', () => {
    const input = [iv('2026-08-03T09:00', '2026-08-03T12:00'), iv('2026-08-03T11:00', null)];
    const snapshot = structuredClone(input);
    normalizeIntervals(input, kst('2026-08-03T14:00'), DEFAULT_CONFIG);
    expect(input).toEqual(snapshot);
  });
});

describe('streaks', () => {
  const streakOf = (intervals: Interval[], now: string): number => build(intervals, now).currentStreakDays;

  it('counts consecutive met workdays walking backwards', () => {
    expect(
      streakOf(
        [
          iv('2026-08-03T09:00', '2026-08-03T17:00'),
          iv('2026-08-04T09:00', '2026-08-04T17:00'),
          iv('2026-08-05T09:00', '2026-08-05T17:00'),
        ],
        '2026-08-06T09:00',
      ),
    ).toBe(3);
  });

  it('skips the weekend without breaking the run', () => {
    // Fri met, weekend empty, Mon met. now = Tuesday morning.
    expect(
      streakOf(
        [iv('2026-08-07T09:00', '2026-08-07T17:00'), iv('2026-08-10T09:00', '2026-08-10T17:00')],
        '2026-08-11T09:00',
      ),
    ).toBe(2);
  });

  it('skips an unfinished today rather than reading it as a broken streak', () => {
    expect(
      streakOf(
        [
          iv('2026-08-05T09:00', '2026-08-05T17:00'),
          iv('2026-08-06T09:00', '2026-08-06T10:00'), // one hour in
        ],
        '2026-08-06T10:00',
      ),
    ).toBe(1);
  });

  it('counts today once it has met its own target', () => {
    expect(
      streakOf(
        [
          iv('2026-08-05T09:00', '2026-08-05T17:00'),
          iv('2026-08-06T08:00', '2026-08-06T16:00'),
        ],
        '2026-08-06T16:00',
      ),
    ).toBe(2);
  });

  it('breaks on a missed workday', () => {
    // Mon and Tue met, Wed missed, Thu met. now = Friday.
    expect(
      streakOf(
        [
          iv('2026-08-03T09:00', '2026-08-03T17:00'),
          iv('2026-08-04T09:00', '2026-08-04T17:00'),
          iv('2026-08-06T09:00', '2026-08-06T17:00'),
        ],
        '2026-08-07T09:00',
      ),
    ).toBe(1);
  });

  it('breaks on a workday that fell one second short', () => {
    expect(
      streakOf(
        [
          iv('2026-08-05T09:00:00', '2026-08-05T17:00:00'),
          iv('2026-08-06T09:00:00', '2026-08-06T16:59:59'),
        ],
        '2026-08-07T09:00',
      ),
    ).toBe(0);
  });

  it('is zero with no history at all', () => {
    expect(streakOf([], '2026-08-06T09:00')).toBe(0);
  });

  it('survives a run of weekend-only rows at the end', () => {
    const rows: DayEntry[] = [
      { date: '2026-08-07', weekday: 5, targetSeconds: 28_800, trackedSeconds: 28_800, isRequired: true, met: true, isToday: false, isFinalized: true, deltaSeconds: 0, balanceAfterSeconds: 0 },
      { date: '2026-08-08', weekday: 6, targetSeconds: 0, trackedSeconds: 0, isRequired: false, met: true, isToday: false, isFinalized: true, deltaSeconds: 0, balanceAfterSeconds: 0 },
      { date: '2026-08-09', weekday: 0, targetSeconds: 0, trackedSeconds: 0, isRequired: false, met: true, isToday: true, isFinalized: false, deltaSeconds: 0, balanceAfterSeconds: 0 },
    ];
    expect(computeStreak(rows)).toBe(1);
  });
});

describe('editing a past day recomputes every balance after it', () => {
  // Mon and Wed are full days; Tuesday is the row being edited.
  const withTuesday = (tuesdayEnd: string): Interval[] => [
    { ...iv('2026-08-03T09:00', '2026-08-03T17:00'), id: 'mon' },
    { ...iv('2026-08-04T09:00', tuesdayEnd), id: 'tue' },
    { ...iv('2026-08-05T09:00', '2026-08-05T17:00'), id: 'wed' },
  ];

  it('shifts the running balance of every later day', () => {
    const before = build(withTuesday('2026-08-04T13:00'), '2026-08-06T09:00'); // Tue 4h
    expect(day(before, '2026-08-04').balanceAfterSeconds).toBe(h(4));
    expect(day(before, '2026-08-05').balanceAfterSeconds).toBe(h(4));
    expect(before.carriedBalanceSeconds).toBe(h(4));

    const after = build(withTuesday('2026-08-04T17:00'), '2026-08-06T09:00'); // Tue 8h
    expect(day(after, '2026-08-04').balanceAfterSeconds).toBe(0);
    expect(day(after, '2026-08-05').balanceAfterSeconds).toBe(0);
    expect(after.carriedBalanceSeconds).toBe(0);
    expect(after.currentStreakDays).toBe(3);
  });

  it('recomputes the streak when a past day is deleted', () => {
    const complete = build(withTuesday('2026-08-04T17:00'), '2026-08-06T09:00');
    expect(complete.currentStreakDays).toBe(3);

    const deleted = withTuesday('2026-08-04T17:00').filter((i) => i.id !== 'tue');
    expect(build(deleted, '2026-08-06T09:00').currentStreakDays).toBe(1);
  });
});

describe('ledger shape', () => {
  it('returns a single today row when there is no history', () => {
    const ledger = build([], '2026-08-06T09:00');
    expect(ledger.days).toHaveLength(1);
    expect(ledger.today.date).toBe('2026-08-06');
    expect(ledger.today.trackedSeconds).toBe(0);
    expect(ledger.debtSeconds).toBe(0);
    expect(ledger.creditSeconds).toBe(0);
    expect(ledger.isRunning).toBe(false);
    expect(ledger.runningSince).toBeNull();
  });

  it('marks exactly one row as today, and everything before it as finalized', () => {
    const ledger = build([iv('2026-08-03T09:00', '2026-08-03T17:00')], '2026-08-06T09:00');
    expect(ledger.days.filter((d) => d.isToday)).toHaveLength(1);
    expect(ledger.days.filter((d) => d.isFinalized)).toHaveLength(3);
  });

  it('fills a week slice with zeroed rows outside the tracked range', () => {
    const ledger = build([iv('2026-08-05T09:00', '2026-08-05T17:00')], '2026-08-06T09:00');
    const week = weekSlice(ledger, '2026-08-03');
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
    expect(week[6]?.targetSeconds).toBe(0); // Sunday
    expect(week[2]?.trackedSeconds).toBe(h(8));
  });
});
