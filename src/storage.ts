/**
 * IndexedDB persistence. No backend, no network — the interval log lives on
 * this device only, which is why export is a first-class feature.
 */

import { createStore, get, set } from 'idb-keyval';
import type { Interval } from './ledger';
import type { TimerStatus } from './timerEngine';

const store = createStore('timedebt', 'state');

const INTERVALS_KEY = 'intervals';
const STATUS_KEY = 'timerStatus';

export async function loadIntervals(): Promise<Interval[]> {
  const raw = await get<Interval[]>(INTERVALS_KEY, store);
  return Array.isArray(raw) ? raw : [];
}

export async function saveIntervals(intervals: Interval[]): Promise<void> {
  await set(INTERVALS_KEY, intervals, store);
}

/**
 * Only the idle/paused distinction is persisted — "running" is always derived
 * from whether an interval is open, so the two can never disagree about time.
 */
export async function loadStatus(): Promise<TimerStatus> {
  const raw = await get<TimerStatus>(STATUS_KEY, store);
  return raw === 'paused' || raw === 'running' ? raw : 'idle';
}

export async function saveStatus(status: TimerStatus): Promise<void> {
  await set(STATUS_KEY, status, store);
}

/** UUID for a new interval, with a fallback for non-secure contexts. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
