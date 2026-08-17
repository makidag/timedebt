import type { LedgerConfig } from './ledger';

export const HOUR_SECONDS = 3600;

export const DEFAULT_CONFIG: LedgerConfig = {
  /** Mon–Fri owe a full 8 hours. */
  weekdayTargetSeconds: 8 * HOUR_SECONDS, // 28_800
  /** Sat/Sun owe nothing, so every tracked second is surplus. */
  weekendTargetSeconds: 0,
  /** Banked credit is capped at 16h: one heroic weekend cannot buy a slack week. */
  maxCreditSeconds: 16 * HOUR_SECONDS, // 57_600
  /** A single interval longer than this is an abandoned session, not work. */
  maxIntervalSeconds: 12 * HOUR_SECONDS, // 43_200
  /** Heartbeats older than this mean the app died rather than paused. */
  staleHeartbeatSeconds: 120,
};

/** How often a running timer stamps `heartbeatAt`. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
