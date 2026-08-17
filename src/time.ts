/**
 * KST (Asia/Seoul) calendar math.
 *
 * Korea has been on a fixed UTC+9 with no DST since 1988, so day boundaries can
 * be computed by shifting the epoch and reading UTC fields — no Intl, no tz
 * database, no host-timezone dependency. Every function here is pure and every
 * "now" is passed in by the caller.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A KST calendar date as `YYYY-MM-DD`. */
export type DayKey = string;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The KST calendar date that an epoch-ms instant falls in. */
export function kstDayKey(ts: number): DayKey {
  const d = new Date(ts + KST_OFFSET_MS);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Epoch ms of KST midnight opening the given KST date. */
export function kstDayStartMs(day: DayKey): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
}

/** Epoch ms of KST midnight closing the given KST date (exclusive). */
export function kstDayEndMs(day: DayKey): number {
  return kstDayStartMs(day) + MS_PER_DAY;
}

/** Day of week in KST. 0 = Sunday … 6 = Saturday. */
export function kstWeekday(day: DayKey): number {
  return new Date(kstDayStartMs(day) + KST_OFFSET_MS).getUTCDay();
}

export function isWeekend(day: DayKey): boolean {
  const w = kstWeekday(day);
  return w === 0 || w === 6;
}

/** Shift a KST date by whole days. */
export function addDays(day: DayKey, delta: number): DayKey {
  return kstDayKey(kstDayStartMs(day) + delta * MS_PER_DAY);
}

/** Inclusive list of KST dates from `from` to `to`. Empty when `to` precedes `from`. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  if (to < from) return out;
  let cursor = from;
  // Guard against a pathological range blowing up the loop (~27 years).
  for (let i = 0; i < 10_000 && cursor <= to; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Monday of the KST week containing `day` (weeks run Monday → Sunday). */
export function startOfKstWeek(day: DayKey): DayKey {
  const w = kstWeekday(day);
  const backToMonday = w === 0 ? 6 : w - 1;
  return addDays(day, -backToMonday);
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function kstWeekdayName(day: DayKey): string {
  return WEEKDAY_NAMES[kstWeekday(day)] as string;
}

/** Wall-clock `HH:MM` in KST for an epoch-ms instant. */
export function kstClock(ts: number): string {
  const d = new Date(ts + KST_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Full KST timestamp, e.g. `2026-08-06 14:03:07`. */
export function kstTimestamp(ts: number): string {
  const d = new Date(ts + KST_OFFSET_MS);
  return `${kstDayKey(ts)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** ISO-8601 with the explicit +09:00 offset, for exports. */
export function kstIso(ts: number): string {
  const d = new Date(ts + KST_OFFSET_MS);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  );
}

/**
 * `YYYY-MM-DDTHH:MM` for `<input type="datetime-local">`, expressed in KST.
 * The input element is otherwise interpreted in the *browser's* timezone, so
 * both directions of this conversion must go through KST explicitly.
 */
export function toKstInputValue(ts: number): string {
  const d = new Date(ts + KST_OFFSET_MS);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Parse a `datetime-local` value as KST. Returns null when unparseable. */
export function fromKstInputValue(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m as unknown as string[];
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) -
    KST_OFFSET_MS
  );
}

/** Seconds → `HH:MM:SS`, hours uncapped (49:00:00 is valid). Negatives clamp to zero. */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

/** Seconds → compact `8h 00m`, for tables where seconds are noise. */
export function formatHm(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** Signed compact duration, e.g. `+1h 30m` / `−2h 00m` (true minus sign). */
export function formatSignedHm(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s === 0) return '0h 00m';
  return `${s > 0 ? '+' : '−'}${formatHm(Math.abs(s))}`;
}
