import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import type { Interval } from './ledger';
import { BackupParseError, backupFilename, parseBackup, toCsv, toJson } from './exporters';

const T0 = Date.UTC(2026, 7, 5, 15, 0); // 2026-08-06 00:00 KST

const intervals: Interval[] = [
  { id: 'b', start: T0 + 3_600_000, end: T0 + 7_200_000, heartbeatAt: T0 + 7_200_000 },
  { id: 'a', start: T0, end: T0 + 1_800_000, heartbeatAt: T0 + 1_800_000, note: 'morning, "deep" work' },
  { id: 'c', start: T0 + 10_800_000, end: null, heartbeatAt: T0 + 10_800_000 },
];

describe('CSV export', () => {
  const csv = toCsv(intervals);
  const lines = csv.trimEnd().split('\r\n');

  it('writes a header and one row per interval, oldest first', () => {
    expect(lines[0]).toBe('id,start_kst,end_kst,start_epoch_ms,end_epoch_ms,duration_seconds,note');
    expect(lines).toHaveLength(4);
    expect(lines[1]?.startsWith('a,')).toBe(true);
    expect(lines[3]?.startsWith('c,')).toBe(true);
  });

  it('stamps KST times with an explicit offset', () => {
    expect(lines[1]).toContain('2026-08-06T00:00:00+09:00');
  });

  it('quotes and escapes notes containing commas and quotes', () => {
    expect(lines[1]).toContain('"morning, ""deep"" work"');
  });

  it('leaves the end and duration blank for a running interval', () => {
    expect(lines[3]).toBe(`c,2026-08-06T03:00:00+09:00,,${T0 + 10_800_000},,,`);
  });
});

describe('JSON backup', () => {
  it('round-trips through parseBackup', () => {
    const json = toJson(intervals, DEFAULT_CONFIG, T0);
    const parsed = parseBackup(json);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((i) => i.id)).toEqual(['a', 'b', 'c']); // sorted by start
    expect(parsed.find((i) => i.id === 'c')?.end).toBeNull();
    expect(parsed.find((i) => i.id === 'a')?.note).toBe('morning, "deep" work');
  });

  it('records the timezone and config so the numbers can be reinterpreted later', () => {
    const backup = JSON.parse(toJson(intervals, DEFAULT_CONFIG, T0));
    expect(backup.timezone).toBe('Asia/Seoul');
    expect(backup.config.weekdayTargetSeconds).toBe(28_800);
    expect(backup.exportedAt).toBe('2026-08-06T00:00:00+09:00');
  });

  it('rejects malformed backups instead of coercing them', () => {
    expect(() => parseBackup('nope')).toThrow(BackupParseError);
    expect(() => parseBackup('{}')).toThrow(/intervals/);
    expect(() => parseBackup('{"intervals":[{"start":1}]}')).toThrow(/no id/);
    expect(() => parseBackup('{"intervals":[{"id":"a"}]}')).toThrow(/valid start/);
    expect(() => parseBackup('{"intervals":[{"id":"a","start":1,"end":"soon"}]}')).toThrow(/invalid end/);
    expect(() =>
      parseBackup('{"intervals":[{"id":"a","start":1,"end":2},{"id":"a","start":3,"end":4}]}'),
    ).toThrow(/Duplicate/);
  });

  it('backfills a missing heartbeat from the end, then the start', () => {
    const [closed, open] = parseBackup(
      '{"intervals":[{"id":"a","start":1,"end":2},{"id":"b","start":5,"end":null}]}',
    );
    expect(closed?.heartbeatAt).toBe(2);
    expect(open?.heartbeatAt).toBe(5);
  });

  it('accepts an empty log', () => {
    expect(parseBackup('{"intervals":[]}')).toEqual([]);
  });
});

describe('filenames', () => {
  it('is dated and sortable', () => {
    expect(backupFilename('json', '2026-08-06')).toBe('timedebt-2026-08-06.json');
    expect(backupFilename('csv', '2026-08-06')).toBe('timedebt-2026-08-06.csv');
  });
});
