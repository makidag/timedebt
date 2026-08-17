import type { Anomaly } from '../ledger';
import type { Recovery } from '../timerEngine';
import { formatHm, kstTimestamp } from '../time';

interface RecoveryProps {
  recovery: Recovery;
  onAccept: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}

/**
 * Shown when a running timer was cut off by a crash. The unaccounted gap is
 * never silently counted — the interval has already been closed at the last
 * heartbeat, and this is the chance to correct it.
 */
export function RecoveryBanner({ recovery, onAccept, onEdit, onDiscard }: RecoveryProps): JSX.Element {
  return (
    <div className="banner banner--recovery" role="alertdialog" aria-labelledby="recovery-title">
      <p className="banner__body" id="recovery-title">
        <strong>Timer was running when the app closed.</strong>{' '}
        {recovery.discarded ? (
          <>The session never checked in, so nothing was counted.</>
        ) : (
          <>
            Counted until {kstTimestamp(recovery.heartbeatAt)} KST — the last heartbeat.{' '}
            {formatHm(recovery.gapSeconds)} after that is unaccounted for and was not counted.
          </>
        )}
      </p>
      <div className="banner__actions">
        <button type="button" className="btn btn--small btn--primary" onClick={onAccept}>
          {recovery.discarded ? 'OK' : 'Count it'}
        </button>
        {!recovery.discarded && (
          <>
            <button type="button" className="btn btn--small" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn btn--small btn--danger" onClick={onDiscard}>
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Data problems the ledger repaired on the way in, surfaced rather than hidden. */
export function AnomalyBanner({
  anomalies,
  onReview,
}: {
  anomalies: Anomaly[];
  onReview: () => void;
}): JSX.Element | null {
  if (anomalies.length === 0) return null;
  const unique = [...new Map(anomalies.map((a) => [a.kind + a.message, a])).values()];
  return (
    <div className="banner banner--anomaly" role="status">
      <p className="banner__body">
        <strong>
          {anomalies.length} adjustment{anomalies.length === 1 ? '' : 's'} applied:
        </strong>{' '}
        {unique.map((a) => a.message).join(' ')}
      </p>
      <div className="banner__actions">
        <button type="button" className="btn btn--small" onClick={onReview}>
          Review entries
        </button>
      </div>
    </div>
  );
}
