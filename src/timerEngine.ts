/**
 * Timer state transitions, as pure functions.
 *
 * The engine never reads the clock and never accumulates elapsed time. Every
 * transition takes `now` and (where a new interval is opened) an id, so the
 * whole state machine is deterministic under test. Elapsed time is always
 * derived from the interval timestamps by the ledger.
 */

import type { Interval, LedgerConfig } from './ledger';

export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerState {
  intervals: Interval[];
  status: TimerStatus;
}

export type TimerAction =
  | { type: 'start'; now: number; id: string }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number; id: string }
  | { type: 'stop'; now: number }
  | { type: 'heartbeat'; now: number };

/** What the crash-recovery prompt needs to explain itself. */
export interface Recovery {
  intervalId: string;
  startedAt: number;
  /** Last confirmed moment the app was alive. */
  heartbeatAt: number;
  /** Seconds between the last heartbeat and this load — the unaccounted gap. */
  gapSeconds: number;
  /** True when the session died before its first heartbeat and was dropped. */
  discarded: boolean;
}

export function openInterval(intervals: Interval[]): Interval | null {
  return intervals.find((i) => i.end === null) ?? null;
}

/** Close every open interval at `at`. Invariant: at most one may be open, but be total. */
function closeOpen(intervals: Interval[], at: number): Interval[] {
  return intervals.map((i) =>
    i.end === null ? { ...i, end: Math.max(i.start, at), heartbeatAt: Math.max(i.heartbeatAt, at) } : i,
  );
}

export function applyTimerAction(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'start':
    case 'resume': {
      if (openInterval(state.intervals)) return { ...state, status: 'running' };
      const fresh: Interval = {
        id: action.id,
        start: action.now,
        end: null,
        heartbeatAt: action.now,
      };
      return { intervals: [...state.intervals, fresh], status: 'running' };
    }
    case 'pause': {
      if (!openInterval(state.intervals)) return { ...state, status: 'paused' };
      return { intervals: closeOpen(state.intervals, action.now), status: 'paused' };
    }
    case 'stop': {
      return { intervals: closeOpen(state.intervals, action.now), status: 'idle' };
    }
    case 'heartbeat': {
      if (!openInterval(state.intervals)) return state;
      return {
        ...state,
        intervals: state.intervals.map((i) =>
          i.end === null ? { ...i, heartbeatAt: action.now } : i,
        ),
      };
    }
  }
}

/**
 * Reconcile persisted state on load.
 *
 * A fresh heartbeat means the tab simply reloaded — keep running. A heartbeat
 * older than the stale threshold means the app died, and the gap between then
 * and now is unaccounted for: close the interval at the last heartbeat rather
 * than silently counting the gap, and hand back a prompt.
 */
export function reconcileOnLoad(
  intervals: Interval[],
  persistedStatus: TimerStatus,
  now: number,
  config: LedgerConfig,
): { state: TimerState; recovery: Recovery | null } {
  const open = openInterval(intervals);
  if (!open) {
    // Nothing running: honour the persisted pause, but never claim to be running.
    const status: TimerStatus = persistedStatus === 'running' ? 'idle' : persistedStatus;
    return { state: { intervals, status }, recovery: null };
  }

  const heartbeatAt = Math.min(open.heartbeatAt, now);
  const gapMs = now - heartbeatAt;
  if (gapMs <= config.staleHeartbeatSeconds * 1000) {
    return { state: { intervals, status: 'running' }, recovery: null };
  }

  const closedAt = Math.max(open.start, heartbeatAt);
  const discarded = closedAt <= open.start;
  const recovery: Recovery = {
    intervalId: open.id,
    startedAt: open.start,
    heartbeatAt: closedAt,
    gapSeconds: Math.floor(gapMs / 1000),
    discarded,
  };
  const repaired = discarded
    ? intervals.filter((i) => i.id !== open.id)
    : intervals.map((i) =>
        i.id === open.id ? { ...i, end: closedAt, heartbeatAt: closedAt } : i,
      );

  return { state: { intervals: repaired, status: 'idle' }, recovery };
}

/** Remove a recovered interval outright ("that time wasn't work"). */
export function discardInterval(intervals: Interval[], id: string): Interval[] {
  return intervals.filter((i) => i.id !== id);
}

export function upsertInterval(intervals: Interval[], next: Interval): Interval[] {
  const exists = intervals.some((i) => i.id === next.id);
  return exists ? intervals.map((i) => (i.id === next.id ? next : i)) : [...intervals, next];
}

/** Newest first — how the manual-entry list reads. */
export function sortIntervals(intervals: Interval[]): Interval[] {
  return [...intervals].sort((a, b) => b.start - a.start);
}
