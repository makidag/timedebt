import type { DayEntry } from '../ledger';
import { formatHm } from '../time';

interface Props {
  day: DayEntry;
}

/**
 * Eight ruled cells, one per hour owed — the columns of a ledger page filling
 * in left to right. On a weekend there is nothing to rule, so it says so.
 */
export function ProgressRail({ day }: Props): JSX.Element {
  if (!day.isRequired) {
    return (
      <div className="rail rail--free">
        <span className="rail__free-label">No target today · every hour is credit</span>
      </div>
    );
  }

  const hours = Math.round(day.targetSeconds / 3600);
  const filledHours = day.trackedSeconds / 3600;
  const pct = Math.min(100, (day.trackedSeconds / day.targetSeconds) * 100);

  return (
    <div
      className={`rail${day.met ? ' rail--met' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={day.targetSeconds}
      aria-valuenow={Math.min(day.trackedSeconds, day.targetSeconds)}
      aria-valuetext={`${formatHm(day.trackedSeconds)} of ${formatHm(day.targetSeconds)}`}
    >
      {Array.from({ length: hours }, (_, i) => {
        const fill = Math.max(0, Math.min(1, filledHours - i));
        return (
          <span className="rail__cell" key={i}>
            <span className="rail__fill" style={{ transform: `scaleX(${fill})` }} />
          </span>
        );
      })}
      <span className="rail__pct">{Math.floor(pct)}%</span>
    </div>
  );
}
