/**
 * Export and restore. Pure string in, pure string out — the DOM download step
 * lives in `download.ts` so this module stays testable.
 *
 * The interval log is the only source of truth, so it is the only thing worth
 * backing up: daily totals, debt and streaks are all derived from it.
 */

import type { Interval, LedgerConfig } from './ledger';
import { kstIso } from './time';

export const BACKUP_VERSION = 1;

export interface Backup {
  version: number;
  exportedAt: string;
  timezone: 'Asia/Seoul';
  config: LedgerConfig;
  intervals: Interval[];
}

export function toBackup(intervals: Interval[], config: LedgerConfig, now: number): Backup {
  return {
    version: BACKUP_VERSION,
    exportedAt: kstIso(now),
    timezone: 'Asia/Seoul',
    config,
    intervals: [...intervals].sort((a, b) => a.start - b.start),
  };
}

export function toJson(intervals: Interval[], config: LedgerConfig, now: number): string {
  return `${JSON.stringify(toBackup(intervals, config, now), null, 2)}\n`;
}

const CSV_HEADER = [
  'id',
  'start_kst',
  'end_kst',
  'start_epoch_ms',
  'end_epoch_ms',
  'duration_seconds',
  'note',
] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV of the raw interval log. Open intervals export with an empty end. */
export function toCsv(intervals: Interval[]): string {
  const rows = [...intervals]
    .sort((a, b) => a.start - b.start)
    .map((i) =>
      [
        i.id,
        kstIso(i.start),
        i.end === null ? '' : kstIso(i.end),
        i.start,
        i.end ?? '',
        i.end === null ? '' : Math.floor((i.end - i.start) / 1000),
        i.note ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  return [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

export class BackupParseError extends Error {}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parse a previously exported JSON backup. Anything that is not a well-formed
 * interval is rejected outright rather than silently coerced — a backup that
 * restores subtly wrong hours is worse than one that refuses to load.
 */
export function parseBackup(text: string): Interval[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupParseError('That file is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) {
    throw new BackupParseError('That file is not a Time Debt backup.');
  }
  const raw = (data as { intervals?: unknown }).intervals;
  if (!Array.isArray(raw)) {
    throw new BackupParseError('That file has no "intervals" list.');
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BackupParseError(`Interval ${index + 1} is not an object.`);
    }
    const { id, start, end, heartbeatAt, note } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') {
      throw new BackupParseError(`Interval ${index + 1} has no id.`);
    }
    if (seen.has(id)) throw new BackupParseError(`Duplicate interval id "${id}".`);
    seen.add(id);
    if (!isFiniteNumber(start)) {
      throw new BackupParseError(`Interval "${id}" has no valid start.`);
    }
    if (end !== null && !isFiniteNumber(end)) {
      throw new BackupParseError(`Interval "${id}" has an invalid end.`);
    }
    return {
      id,
      start,
      end: end === null ? null : (end as number),
      heartbeatAt: isFiniteNumber(heartbeatAt) ? heartbeatAt : (end as number | null) ?? start,
      ...(typeof note === 'string' && note !== '' ? { note } : {}),
    };
  });
}

/** `timedebt-2026-08-06.json` — sortable, and obvious a year later. */
export function backupFilename(extension: 'json' | 'csv', dayKey: string): string {
  return `timedebt-${dayKey}.${extension}`;
}
