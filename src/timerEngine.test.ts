import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { buildLedger, type Interval } from './ledger';
import {
  applyTimerAction,
  discardInterval,
  openInterval,
  reconcileOnLoad,
  sortIntervals,
  upsertInterval,
  type TimerState,
} from './timerEngine';

const T0 = Date.UTC(2026, 7, 6, 0, 0, 0); // 09:00 KST Thursday
const min = (n: number): number => n * 60_000;

const idle: TimerState = { intervals: [], status: 'idle' };

describe('timer transitions', () => {
  it('walks idle → running → paused → running → idle', () => {
    let state = applyTimerAction(idle, { type: 'start', now: T0, id: 'a' });
    expect(state.status).toBe('running');
    expect(state.intervals).toHaveLength(1);
    expect(state.intervals[0]?.end).toBeNull();

    state = applyTimerAction(state, { type: 'pause', now: T0 + min(30) });
    expect(state.status).toBe('paused');
    expect(state.intervals[0]?.end).toBe(T0 + min(30));

    state = applyTimerAction(state, { type: 'resume', now: T0 + min(45), id: 'b' });
    expect(state.status).toBe('running');
    expect(state.intervals).toHaveLength(2);
    expect(state.intervals[1]?.start).toBe(T0 + min(45));

    state = applyTimerAction(state, { type: 'stop', now: T0 + min(75) });
    expect(state.status).toBe('idle');
    expect(state.intervals.every((i) => i.end !== null)).toBe(true);
  });

  it('never leaves more than one interval open', () => {
    let state = applyTimerAction(idle, { type: 'start', now: T0, id: 'a' });
    state = applyTimerAction(state, { type: 'start', now: T0 + min(5), id: 'b' });
    expect(state.intervals).toHaveLength(1);
    expect(state.intervals.filter((i) => i.end === null)).toHaveLength(1);
  });

  it('does not count the paused gap', () => {
    let state = applyTimerAction(idle, { type: 'start', now: T0, id: 'a' });
    state = applyTimerAction(state, { type: 'pause', now: T0 + min(30) });
    state = applyTimerAction(state, { type: 'resume', now: T0 + min(90), id: 'b' });
    const ledger = buildLedger(state.intervals, T0 + min(120), DEFAULT_CONFIG);
    expect(ledger.today.trackedSeconds).toBe(60 * 60); // 30min + 30min, not 120min
  });

  it('stamps heartbeats only on the open interval', () => {
    let state = applyTimerAction(idle, { type: 'start', now: T0, id: 'a' });
    state = applyTimerAction(state, { type: 'pause', now: T0 + min(10) });
    state = applyTimerAction(state, { type: 'resume', now: T0 + min(20), id: 'b' });
    state = applyTimerAction(state, { type: 'heartbeat', now: T0 + min(21) });
    expect(state.intervals[0]?.heartbeatAt).toBe(T0 + min(10));
    expect(state.intervals[1]?.heartbeatAt).toBe(T0 + min(21));
  });

  it('ignores a heartbeat when nothing is running', () => {
    const state = applyTimerAction(idle, { type: 'heartbeat', now: T0 });
    expect(state).toBe(idle);
  });

  it('is a no-op to pause or stop from idle', () => {
    expect(applyTimerAction(idle, { type: 'stop', now: T0 }).intervals).toEqual([]);
    expect(applyTimerAction(idle, { type: 'pause', now: T0 }).status).toBe('paused');
  });
});

describe('crash recovery', () => {
  const running = (heartbeatOffsetMs: number): Interval[] => [
    { id: 'crashed', start: T0, end: null, heartbeatAt: T0 + heartbeatOffsetMs },
  ];

  it('keeps running when the heartbeat is fresh — a reload is not a crash', () => {
    const { state, recovery } = reconcileOnLoad(running(min(60)), 'running', T0 + min(60) + 5_000, DEFAULT_CONFIG);
    expect(recovery).toBeNull();
    expect(state.status).toBe('running');
    expect(openInterval(state.intervals)?.id).toBe('crashed');
  });

  it('closes the interval at the last heartbeat and prompts when it is stale', () => {
    const now = T0 + min(300); // five hours after start
    const { state, recovery } = reconcileOnLoad(running(min(60)), 'running', now, DEFAULT_CONFIG);
    expect(state.status).toBe('idle');
    expect(state.intervals[0]?.end).toBe(T0 + min(60));
    expect(recovery).not.toBeNull();
    expect(recovery?.heartbeatAt).toBe(T0 + min(60));
    expect(recovery?.gapSeconds).toBe(240 * 60);
    expect(recovery?.discarded).toBe(false);

    // The four unaccounted hours are not counted.
    const ledger = buildLedger(state.intervals, now, DEFAULT_CONFIG);
    expect(ledger.today.trackedSeconds).toBe(60 * 60);
  });

  it('drops a session that died before its first heartbeat', () => {
    const { state, recovery } = reconcileOnLoad(running(0), 'running', T0 + min(300), DEFAULT_CONFIG);
    expect(state.intervals).toEqual([]);
    expect(recovery?.discarded).toBe(true);
  });

  it('treats a heartbeat from the future as now rather than trusting the skew', () => {
    const { state, recovery } = reconcileOnLoad(running(min(600)), 'running', T0 + min(60), DEFAULT_CONFIG);
    expect(recovery).toBeNull();
    expect(state.status).toBe('running');
  });

  it('never reports running when no interval is open', () => {
    const closed: Interval[] = [{ id: 'x', start: T0, end: T0 + min(10), heartbeatAt: T0 + min(10) }];
    expect(reconcileOnLoad(closed, 'running', T0 + min(20), DEFAULT_CONFIG).state.status).toBe('idle');
    expect(reconcileOnLoad(closed, 'paused', T0 + min(20), DEFAULT_CONFIG).state.status).toBe('paused');
  });
});

describe('interval list edits', () => {
  const a: Interval = { id: 'a', start: T0, end: T0 + min(10), heartbeatAt: T0 + min(10) };
  const b: Interval = { id: 'b', start: T0 + min(20), end: T0 + min(30), heartbeatAt: T0 + min(30) };

  it('adds, replaces and deletes by id', () => {
    expect(upsertInterval([a], b)).toHaveLength(2);
    const edited = upsertInterval([a, b], { ...a, note: 'deep work' });
    expect(edited).toHaveLength(2);
    expect(edited.find((i) => i.id === 'a')?.note).toBe('deep work');
    expect(discardInterval([a, b], 'a')).toEqual([b]);
  });

  it('sorts newest first without mutating the input', () => {
    const input = [a, b];
    expect(sortIntervals(input).map((i) => i.id)).toEqual(['b', 'a']);
    expect(input.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
