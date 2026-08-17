/**
 * The calculation core.
 *
 * Every value the app displays — today's seconds, the debt balance, the streak —
 * is derived here from the raw interval log. Nothing is cached, nothing is
 * incremented. `now` is always injected, never read from the clock, so the whole
 * module is deterministic under test.
 */

import {
  addDays,
  dayRange,
  isWeekend,
  kstDayEndMs,
  kstDayKey,
  kstWeekday,
  type DayKey,
} from './time';

export interface Interval {
  id: string;
  /** epoch ms, UTC */
  start: number;
  /** epoch ms, UTC; null means running */
  end: number | null;
  /** epoch ms, refreshed every 30s while running */
  heartbeatAt: number;
  note?: string;
}

export interface LedgerConfig {
  weekdayTargetSeconds: number;
  weekendTargetSeconds: number;
  maxCreditSeconds: number;
  maxIntervalSeconds: number;
  staleHeartbeatSeconds: number;
}

export type AnomalyKind =
  | 'truncated'
  | 'negative-duration'
  | 'future-start'
  | 'future-end-clamped'
  | 'overlap-merged';

export interface Anomaly {
  kind: AnomalyKind;
  /** Ids of the raw intervals involved. */
  intervalIds: string[];
  message: string;
}

/** An interval after cleanup: always closed, always positive length, never overlapping another. */
export interface NormalizedInterval {
  start: number;
  end: number;
  /** Raw interval ids folded into this one (>1 after an overlap merge). */
  sourceIds: string[];
  /** True when this slice is the still-running interval, closed against `now`. */
  running: boolean;
}

export interface DayEntry {
  date: DayKey;
  /** 0 = Sunday … 6 = Saturday, in KST. */
  weekday: number;
  targetSeconds: number;
  trackedSeconds: number;
  /** A day with a non-zero target. */
  isRequired: boolean;
  /** All-or-nothing: tracked >= target. No partial credit. */
  met: boolean;
  isToday: boolean;
  /** Strictly before today in KST — only finalized days move the balance. */
  isFinalized: boolean;
  /** target − tracked. Meaningful only once the day is finalized. */
  deltaSeconds: number;
  /** Running (credit-capped) balance through the end of this day. */
  balanceAfterSeconds: number;
}

export interface Ledger {
  config: LedgerConfig;
  now: number;
  todayKey: DayKey;
  /** One entry per KST date from first activity through today, gaps included. */
  days: DayEntry[];
  today: DayEntry;
  /** Balance from all finalized days. Positive = debt, negative = banked credit. */
  carriedBalanceSeconds: number;
  /** max(0, todayTracked − todayTarget): hours that may go toward old debt. */
  surplusSeconds: number;
  /** carriedBalance − surplus, credit-capped. What the split display shows. */
  displayedBalanceSeconds: number;
  /** max(0, displayedBalance) — never negative, so the UI never shows −debt. */
  debtSeconds: number;
  /** max(0, −displayedBalance). */
  creditSeconds: number;
  /** The balance if the timer stopped now and the day ended here. */
  projectedBalanceSeconds: number;
  currentStreakDays: number;
  anomalies: Anomaly[];
  /** True while an interval is open. */
  isRunning: boolean;
  runningSince: number | null;
  normalized: NormalizedInterval[];
}

export function targetSecondsFor(day: DayKey, config: LedgerConfig): number {
  return isWeekend(day) ? config.weekendTargetSeconds : config.weekdayTargetSeconds;
}

/** Credit is capped; debt is not. */
export function clampCredit(balanceSeconds: number, config: LedgerConfig): number {
  return Math.max(balanceSeconds, -config.maxCreditSeconds);
}

/**
 * Clean the raw log before any aggregation.
 *
 * In order: close open intervals against `now`, discard intervals that end
 * before they start, clamp ends that sit in the future, truncate anything
 * longer than the 12h cap, then sort and merge overlaps so no second is counted
 * twice.
 */
export function normalizeIntervals(
  intervals: Interval[],
  now: number,
  config: LedgerConfig,
): { normalized: NormalizedInterval[]; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const maxMs = config.maxIntervalSeconds * 1000;
  const staged: NormalizedInterval[] = [];

  for (const raw of intervals) {
    const running = raw.end === null;
    const start = raw.start;
    let end = raw.end ?? now;

    if (end < start) {
      anomalies.push({
        kind: 'negative-duration',
        intervalIds: [raw.id],
        message: 'Interval ends before it starts; discarded.',
      });
      continue;
    }

    if (end > now) {
      end = now;
      anomalies.push({
        kind: 'future-end-clamped',
        intervalIds: [raw.id],
        message: 'Interval ended in the future; clamped to now.',
      });
    }

    if (start > now) {
      // Only reachable through manual entry. Clamping the end has already made
      // this interval inverted, so there is nothing left to count.
      anomalies.push({
        kind: 'future-start',
        intervalIds: [raw.id],
        message: 'Interval starts in the future; not counted yet.',
      });
      continue;
    }

    if (end - start > maxMs) {
      end = start + maxMs;
      anomalies.push({
        kind: 'truncated',
        intervalIds: [raw.id],
        message: `Session longer than ${config.maxIntervalSeconds / 3600}h; truncated.`,
      });
    }

    if (end <= start) continue; // zero-length, nothing to count
    staged.push({ start, end, sourceIds: [raw.id], running });
  }

  staged.sort((a, b) => a.start - b.start || a.end - b.end);

  const normalized: NormalizedInterval[] = [];
  for (const next of staged) {
    const current = normalized[normalized.length - 1];
    if (current && next.start <= current.end) {
      if (next.start < current.end) {
        anomalies.push({
          kind: 'overlap-merged',
          intervalIds: [...current.sourceIds, ...next.sourceIds],
          message: 'Overlapping intervals merged; the shared time is counted once.',
        });
      }
      current.end = Math.max(current.end, next.end);
      current.sourceIds.push(...next.sourceIds);
      current.running = current.running || next.running;
    } else {
      normalized.push({ ...next, sourceIds: [...next.sourceIds] });
    }
  }

  return { normalized, anomalies };
}

/** Tracked milliseconds per KST date, splitting any interval that crosses midnight. */
export function bucketByKstDay(normalized: NormalizedInterval[]): Map<DayKey, number> {
  const totals = new Map<DayKey, number>();
  for (const interval of normalized) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const key = kstDayKey(cursor);
      const sliceEnd = Math.min(interval.end, kstDayEndMs(key));
      totals.set(key, (totals.get(key) ?? 0) + (sliceEnd - cursor));
      cursor = sliceEnd;
    }
  }
  return totals;
}

/**
 * Consecutive required days meeting target, walking backwards from today.
 * Weekends are skipped without breaking the run; an unfinished today is skipped
 * too, so a morning that has not reached 8h yet does not read as a broken streak.
 */
export function computeStreak(days: DayEntry[]): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const day = days[i] as DayEntry;
    if (!day.isRequired) continue; // weekend: skipped, run survives
    if (day.met) {
      streak += 1;
      continue;
    }
    if (day.isToday) continue; // still in progress, not yet a failure
    break;
  }
  return streak;
}

export function buildLedger(intervals: Interval[], now: number, config: LedgerConfig): Ledger {
  const { normalized, anomalies } = normalizeIntervals(intervals, now, config);
  const totalsMs = bucketByKstDay(normalized);
  const todayKey = kstDayKey(now);

  let firstKey = todayKey;
  for (const key of totalsMs.keys()) {
    if (key < firstKey) firstKey = key;
  }
  // Normalization clamps every end to `now`, so no bucket can land past today.
  const days: DayEntry[] = [];
  let balance = 0;
  for (const date of dayRange(firstKey, todayKey)) {
    const targetSeconds = targetSecondsFor(date, config);
    const trackedSeconds = Math.floor((totalsMs.get(date) ?? 0) / 1000);
    const isToday = date === todayKey;
    const isFinalized = date < todayKey;
    if (isFinalized) {
      balance = clampCredit(balance + (targetSeconds - trackedSeconds), config);
    }
    days.push({
      date,
      weekday: kstWeekday(date),
      targetSeconds,
      trackedSeconds,
      isRequired: targetSeconds > 0,
      met: trackedSeconds >= targetSeconds,
      isToday,
      isFinalized,
      deltaSeconds: targetSeconds - trackedSeconds,
      balanceAfterSeconds: balance,
    });
  }

  const today =
    days.find((d) => d.isToday) ??
    // Only reachable if the range logic ever drops today; keep the shape total.
    ({
      date: todayKey,
      weekday: kstWeekday(todayKey),
      targetSeconds: targetSecondsFor(todayKey, config),
      trackedSeconds: 0,
      isRequired: targetSecondsFor(todayKey, config) > 0,
      met: targetSecondsFor(todayKey, config) === 0,
      isToday: true,
      isFinalized: false,
      deltaSeconds: targetSecondsFor(todayKey, config),
      balanceAfterSeconds: balance,
    } satisfies DayEntry);

  const carriedBalanceSeconds = balance;
  // You cannot pay old debt with hours you still owe to today.
  const surplusSeconds = Math.max(0, today.trackedSeconds - today.targetSeconds);
  const displayedBalanceSeconds = clampCredit(carriedBalanceSeconds - surplusSeconds, config);
  const projectedBalanceSeconds = clampCredit(
    carriedBalanceSeconds + (today.targetSeconds - today.trackedSeconds),
    config,
  );

  const open = intervals.find((i) => i.end === null) ?? null;

  return {
    config,
    now,
    todayKey,
    days,
    today,
    carriedBalanceSeconds,
    surplusSeconds,
    displayedBalanceSeconds,
    debtSeconds: Math.max(0, displayedBalanceSeconds),
    creditSeconds: Math.max(0, -displayedBalanceSeconds),
    projectedBalanceSeconds,
    currentStreakDays: computeStreak(days),
    anomalies,
    isRunning: open !== null,
    runningSince: open ? open.start : null,
    normalized,
  };
}

/** The days of one KST week (Monday → Sunday) as ledger rows, for the week view. */
export function weekSlice(ledger: Ledger, mondayKey: DayKey): DayEntry[] {
  const byDate = new Map(ledger.days.map((d) => [d.date, d]));
  const out: DayEntry[] = [];
  let cursor = mondayKey;
  for (let i = 0; i < 7; i += 1) {
    const existing = byDate.get(cursor);
    if (existing) {
      out.push(existing);
    } else {
      const targetSeconds = targetSecondsFor(cursor, ledger.config);
      out.push({
        date: cursor,
        weekday: kstWeekday(cursor),
        targetSeconds,
        trackedSeconds: 0,
        isRequired: targetSeconds > 0,
        met: targetSeconds === 0,
        isToday: cursor === ledger.todayKey,
        isFinalized: cursor < ledger.todayKey,
        deltaSeconds: targetSeconds,
        // Outside the tracked range there is no meaningful running balance.
        balanceAfterSeconds: cursor < ledger.todayKey ? 0 : ledger.carriedBalanceSeconds,
      });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}
