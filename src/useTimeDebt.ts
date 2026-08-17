/**
 * The one place in the app allowed to read the clock.
 *
 * Everything below this hook takes `now` as data. The repaint interval exists
 * only to move `now` forward so React re-renders — it is never the source of
 * truth for elapsed time. Background tabs get throttled to roughly one tick a
 * minute (or suspended outright), so any counter incremented by the callback
 * would quietly lose hours; recomputing from timestamps cannot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG, HEARTBEAT_INTERVAL_MS } from './config';
import { buildLedger, type Interval, type Ledger } from './ledger';
import { loadIntervals, loadStatus, newId, saveIntervals, saveStatus } from './storage';
import {
  applyTimerAction,
  discardInterval,
  reconcileOnLoad,
  upsertInterval,
  type Recovery,
  type TimerAction,
  type TimerStatus,
} from './timerEngine';

/** Fast enough to look live; the day-rollover check does not need a second hand. */
const TICK_RUNNING_MS = 1000;
const TICK_RESTING_MS = 30_000;

export interface TimeDebtStore {
  loaded: boolean;
  now: number;
  intervals: Interval[];
  status: TimerStatus;
  ledger: Ledger;
  recovery: Recovery | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  saveInterval: (interval: Interval) => void;
  deleteInterval: (id: string) => void;
  replaceAll: (intervals: Interval[]) => void;
  acknowledgeRecovery: () => void;
  discardRecovered: () => void;
}

export function useTimeDebt(): TimeDebtStore {
  const [intervals, setIntervals] = useState<Interval[]>([]);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isRunning = status === 'running';

  // Load and reconcile once. A stale heartbeat means the app died rather than
  // paused, so the unaccounted gap is closed off instead of counted.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, storedStatus] = await Promise.all([loadIntervals(), loadStatus()]);
      const result = reconcileOnLoad(stored, storedStatus, Date.now(), DEFAULT_CONFIG);
      if (cancelled) return;
      setIntervals(result.state.intervals);
      setStatus(result.state.status);
      setRecovery(result.recovery);
      setNow(Date.now());
      setLoaded(true);
      if (result.recovery) {
        await saveIntervals(result.state.intervals);
        await saveStatus(result.state.status);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: Interval[], nextStatus: TimerStatus) => {
    setIntervals(next);
    setStatus(nextStatus);
    void saveIntervals(next);
    void saveStatus(nextStatus);
  }, []);

  const statusRef = useRef(status);
  const intervalsRef = useRef(intervals);
  statusRef.current = status;
  intervalsRef.current = intervals;

  const dispatch = useCallback(
    (action: TimerAction) => {
      const next = applyTimerAction(
        { intervals: intervalsRef.current, status: statusRef.current },
        action,
      );
      setNow(action.now);
      persist(next.intervals, next.status);
    },
    [persist],
  );

  // Repaint pulse. Values are always recomputed from timestamps, so a missed or
  // late tick costs nothing but a stale pixel.
  useEffect(() => {
    const period = isRunning ? TICK_RUNNING_MS : TICK_RESTING_MS;
    const id = window.setInterval(() => setNow(Date.now()), period);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // Coming back to a hidden tab: recompute from the clock, never resume a counter.
  useEffect(() => {
    const resync = (): void => setNow(Date.now());
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
    };
  }, []);

  // Heartbeat, so a crash can be distinguished from a clean stop.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => {
      dispatch({ type: 'heartbeat', now: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isRunning, dispatch]);

  const start = useCallback(
    () => dispatch({ type: 'start', now: Date.now(), id: newId() }),
    [dispatch],
  );
  const resume = useCallback(
    () => dispatch({ type: 'resume', now: Date.now(), id: newId() }),
    [dispatch],
  );
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), [dispatch]);
  const stop = useCallback(() => dispatch({ type: 'stop', now: Date.now() }), [dispatch]);

  const saveInterval = useCallback(
    (interval: Interval) => {
      persist(upsertInterval(intervalsRef.current, interval), statusRef.current);
      setNow(Date.now());
    },
    [persist],
  );

  const removeInterval = useCallback(
    (id: string) => {
      persist(discardInterval(intervalsRef.current, id), statusRef.current);
      setNow(Date.now());
    },
    [persist],
  );

  const replaceAll = useCallback(
    (next: Interval[]) => {
      persist(next, 'idle');
      setNow(Date.now());
    },
    [persist],
  );

  const acknowledgeRecovery = useCallback(() => setRecovery(null), []);
  const discardRecovered = useCallback(() => {
    if (recovery) removeInterval(recovery.intervalId);
    setRecovery(null);
  }, [recovery, removeInterval]);

  const ledger = useMemo(
    () => buildLedger(intervals, now, DEFAULT_CONFIG),
    [intervals, now],
  );

  return {
    loaded,
    now,
    intervals,
    status,
    ledger,
    recovery,
    start,
    pause,
    resume,
    stop,
    saveInterval,
    deleteInterval: removeInterval,
    replaceAll,
    acknowledgeRecovery,
    discardRecovered,
  };
}
