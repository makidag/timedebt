import type { Ledger } from '../ledger';
import { formatHm, formatHms, kstWeekdayName } from '../time';

interface Props {
  ledger: Ledger;
  running: boolean;
}

/**
 * The whole point of the app: hours worked on the left, hours owed on the
 * right, facing each other across the spine of a ledger. The right side flips
 * to banked credit when the balance goes negative — a debt figure is never
 * rendered with a minus sign.
 */
export function SplitDisplay({ ledger, running }: Props): JSX.Element {
  const { today, debtSeconds, creditSeconds, carriedBalanceSeconds, surplusSeconds } = ledger;
  const inCredit = debtSeconds === 0 && creditSeconds > 0;
  const targetMet = today.trackedSeconds >= today.targetSeconds;

  const dayStatus = !today.isRequired
    ? 'No target today'
    : targetMet
      ? 'Complete'
      : running
        ? 'In progress'
        : today.trackedSeconds > 0
          ? 'Short of target'
          : 'Not started';

  const balanceNote = inCredit
    ? surplusSeconds > 0
      ? `${formatHm(surplusSeconds)} of it banked today`
      : 'Ahead of the ledger'
    : debtSeconds === 0
      ? 'Square with the ledger'
      : surplusSeconds > 0
        ? `${formatHm(surplusSeconds)} paid down today`
        : today.isRequired && !targetMet
          ? "Today's hours pay this down only past 8h"
          : `Carried in from ${formatHm(Math.max(0, carriedBalanceSeconds))} owed`;

  return (
    <section className="split" aria-label="Today at a glance">
      <div className="split__col">
        <h2 className="split__label">Worked today</h2>
        <p
          className={`hero${targetMet ? ' hero--met' : ''}`}
          role="timer"
          aria-label={`Worked today: ${formatHm(today.trackedSeconds)}`}
        >
          {formatHms(today.trackedSeconds)}
        </p>
        <p className="split__sub">
          {today.isRequired ? `of ${formatHm(today.targetSeconds)} · ` : ''}
          {kstWeekdayName(today.date)} {today.date}
        </p>
      </div>

      <div className="split__spine" aria-hidden="true" />

      <div className="split__col">
        <h2 className="split__label">{inCredit ? 'Banked credit' : 'Time debt'}</h2>
        <p
          className={`hero ${inCredit ? 'hero--credit' : debtSeconds > 0 ? 'hero--debt' : 'hero--met'}`}
          aria-label={
            inCredit
              ? `Banked credit: ${formatHm(creditSeconds)}`
              : `Time debt: ${formatHm(debtSeconds)}`
          }
        >
          {formatHms(inCredit ? creditSeconds : debtSeconds)}
        </p>
        <p className="split__sub">{balanceNote}</p>
      </div>

      <p className="split__status" aria-live="polite">
        <span className={`dot dot--${running ? 'running' : targetMet ? 'met' : 'idle'}`} aria-hidden="true" />
        {dayStatus}
      </p>
    </section>
  );
}
