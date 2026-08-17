import { useState } from 'react';
import { weekSlice, type Ledger } from '../ledger';
import {
  addDays,
  formatHm,
  formatSignedHm,
  kstWeekdayName,
  startOfKstWeek,
  type DayKey,
} from '../time';

interface Props {
  ledger: Ledger;
}

export function WeekView({ ledger }: Props): JSX.Element {
  const [monday, setMonday] = useState<DayKey>(() => startOfKstWeek(ledger.todayKey));
  const rows = weekSlice(ledger, monday);
  const thisWeek = startOfKstWeek(ledger.todayKey);
  const worked = rows.reduce((sum, d) => sum + d.trackedSeconds, 0);
  const owed = rows.reduce((sum, d) => sum + d.targetSeconds, 0);
  // Only closed days have settled, so the week's Δ ignores today and anything after it.
  const settled = rows
    .filter((d) => d.isFinalized)
    .reduce((sum, d) => sum + d.deltaSeconds, 0);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Week of {monday}</h2>
        <div className="panel__nav">
          <button type="button" className="btn btn--small" onClick={() => setMonday(addDays(monday, -7))}>
            ← Earlier
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setMonday(thisWeek)}
            disabled={monday === thisWeek}
          >
            This week
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setMonday(addDays(monday, 7))}
            disabled={monday >= thisWeek}
          >
            Later →
          </button>
        </div>
      </header>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">Worked</th>
              <th scope="col" className="num">Target</th>
              <th scope="col">Met</th>
              <th scope="col" className="num">Δ</th>
              <th scope="col" className="num">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const future = !d.isFinalized && !d.isToday;
              return (
                <tr
                  key={d.date}
                  className={`${d.isToday ? 'row--today' : ''} ${d.isRequired ? '' : 'row--free'}`}
                >
                  <th scope="row">
                    <span className="day-name">{kstWeekdayName(d.date)}</span>
                    <span className="day-date">{d.date}</span>
                    {d.isToday && <span className="chip">today</span>}
                  </th>
                  <td className="num">{formatHm(d.trackedSeconds)}</td>
                  <td className="num">{d.isRequired ? formatHm(d.targetSeconds) : '—'}</td>
                  <td>
                    {!d.isRequired ? (
                      <span className="muted">no target</span>
                    ) : d.met ? (
                      <span className="tag tag--met">met</span>
                    ) : d.isToday ? (
                      <span className="tag">in progress</span>
                    ) : future ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className="tag tag--missed">short</span>
                    )}
                  </td>
                  <td className="num">
                    {d.isFinalized ? formatSignedHm(d.deltaSeconds) : <span className="muted">—</span>}
                  </td>
                  <td className="num">
                    {d.isFinalized ? (
                      <BalanceCell seconds={d.balanceAfterSeconds} />
                    ) : d.isToday ? (
                      <BalanceCell seconds={ledger.displayedBalanceSeconds} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Week total</th>
              <td className="num">{formatHm(worked)}</td>
              <td className="num">{formatHm(owed)}</td>
              <td className="muted">settled</td>
              <td className="num">{formatSignedHm(settled)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="panel__note">
        Saturday and Sunday carry no target, so any weekend hours show as a negative delta and pay
        down the balance. The balance column is the running total after that day closed; the week Δ
        counts closed days only, since today and anything after it have not settled yet.
      </p>
    </section>
  );
}

function BalanceCell({ seconds }: { seconds: number }): JSX.Element {
  if (seconds === 0) return <span className="muted">square</span>;
  return (
    <span className={seconds > 0 ? 'owed' : 'banked'}>
      {formatHm(Math.abs(seconds))} {seconds > 0 ? 'owed' : 'banked'}
    </span>
  );
}
