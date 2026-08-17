import { useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG } from '../config';
import { downloadText, readTextFile } from '../download';
import { backupFilename, parseBackup, toCsv, toJson } from '../exporters';
import type { Interval, Ledger } from '../ledger';
import { newId } from '../storage';
import { sortIntervals } from '../timerEngine';
import {
  formatHm,
  fromKstInputValue,
  kstDayKey,
  kstWeekdayName,
  kstClock,
  toKstInputValue,
} from '../time';

interface Props {
  ledger: Ledger;
  intervals: Interval[];
  now: number;
  onSave: (interval: Interval) => void;
  onDelete: (id: string) => void;
  onReplaceAll: (intervals: Interval[]) => void;
}

interface Draft {
  id: string | null;
  start: string;
  end: string;
  note: string;
}

const emptyDraft = (now: number): Draft => ({
  id: null,
  start: toKstInputValue(now - 3_600_000),
  end: toKstInputValue(now),
  note: '',
});

export function EntriesView({
  ledger,
  intervals,
  now,
  onSave,
  onDelete,
  onReplaceAll,
}: Props): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(now));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => {
    const byDay = new Map<string, Interval[]>();
    for (const interval of sortIntervals(intervals)) {
      const key = kstDayKey(interval.start);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(interval);
      else byDay.set(key, [interval]);
    }
    return [...byDay.entries()];
  }, [intervals]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const start = fromKstInputValue(draft.start);
    const end = fromKstInputValue(draft.end);
    if (start === null) return setError('Enter a start time.');
    if (end === null) return setError('Enter an end time.');
    if (end <= start) return setError('The end must come after the start.');
    if (start > Date.now()) return setError('That start time is in the future.');
    setError(null);
    onSave({
      id: draft.id ?? newId(),
      start,
      end,
      heartbeatAt: end,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    });
    setDraft(emptyDraft(Date.now()));
    setNotice('Saved. Every balance from that date forward has been recomputed.');
  };

  const edit = (interval: Interval): void => {
    setError(null);
    setNotice(null);
    setDraft({
      id: interval.id,
      start: toKstInputValue(interval.start),
      end: toKstInputValue(interval.end ?? Date.now()),
      note: interval.note ?? '',
    });
  };

  const importBackup = async (file: File): Promise<void> => {
    try {
      const parsed = parseBackup(await readTextFile(file));
      const ok = window.confirm(
        `Replace the current log (${intervals.length} intervals) with ${parsed.length} from this backup? This cannot be undone.`,
      );
      if (!ok) return;
      onReplaceAll(parsed);
      setError(null);
      setNotice(`Restored ${parsed.length} intervals.`);
    } catch (cause) {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'Could not read that backup.');
    }
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Entries</h2>
        <div className="panel__nav">
          <button
            type="button"
            className="btn btn--small"
            onClick={() =>
              downloadText(
                backupFilename('json', ledger.todayKey),
                'application/json',
                toJson(intervals, DEFAULT_CONFIG, now),
              )
            }
          >
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() =>
              downloadText(backupFilename('csv', ledger.todayKey), 'text/csv', toCsv(intervals))
            }
          >
            Export CSV
          </button>
          <button type="button" className="btn btn--small" onClick={() => fileInput.current?.click()}>
            Restore JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importBackup(file);
            }}
          />
        </div>
      </header>

      <form className="entry-form" onSubmit={submit}>
        <h3 className="entry-form__title">{draft.id ? 'Edit interval' : 'Add an interval'}</h3>
        <div className="entry-form__grid">
          <label>
            <span>Start (KST)</span>
            <input
              type="datetime-local"
              value={draft.start}
              required
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label>
            <span>End (KST)</span>
            <input
              type="datetime-local"
              value={draft.end}
              required
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <label className="entry-form__note">
            <span>Note (optional)</span>
            <input
              type="text"
              value={draft.note}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>
        <div className="entry-form__actions">
          <button type="submit" className="btn btn--primary btn--small">
            {draft.id ? 'Save changes' : 'Add interval'}
          </button>
          {draft.id && (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                setDraft(emptyDraft(Date.now()));
                setError(null);
              }}
            >
              Cancel
            </button>
          )}
        </div>
        <p className="form-message" role="status">
          {error ? <span className="form-message--error">{error}</span> : notice}
        </p>
      </form>

      {grouped.length === 0 ? (
        <p className="panel__note">Nothing logged yet. Start the timer, or add an interval above.</p>
      ) : (
        grouped.map(([dayKey, dayIntervals]) => {
          const row = ledger.days.find((d) => d.date === dayKey);
          return (
            <div className="entry-day" key={dayKey}>
              <h3 className="entry-day__head">
                <span className="day-name">{kstWeekdayName(dayKey)}</span>
                <span className="day-date">{dayKey}</span>
                <span className="entry-day__total">{formatHm(row?.trackedSeconds ?? 0)}</span>
              </h3>
              <ul className="entry-list">
                {dayIntervals.map((interval) => (
                  <li className="entry" key={interval.id}>
                    <span className="entry__time">
                      {kstClock(interval.start)} –{' '}
                      {interval.end === null ? (
                        <em>running</em>
                      ) : (
                        kstClock(interval.end)
                      )}
                    </span>
                    <span className="entry__duration">
                      {formatHm(
                        Math.max(0, Math.floor(((interval.end ?? now) - interval.start) / 1000)),
                      )}
                    </span>
                    <span className="entry__note">{interval.note}</span>
                    <span className="entry__actions">
                      <button type="button" className="btn btn--ghost" onClick={() => edit(interval)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--danger"
                        onClick={() => {
                          if (window.confirm('Delete this interval?')) onDelete(interval.id);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
