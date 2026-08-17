import type { TimerStatus } from '../timerEngine';

interface Props {
  status: TimerStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function Controls({ status, onStart, onPause, onResume, onStop }: Props): JSX.Element {
  const running = status === 'running';
  const paused = status === 'paused';

  return (
    <div className="controls">
      {running ? (
        <button type="button" className="btn btn--primary" onClick={onPause}>
          Pause
        </button>
      ) : (
        <button type="button" className="btn btn--primary" onClick={paused ? onResume : onStart}>
          {paused ? 'Resume' : 'Start'}
        </button>
      )}
      <button
        type="button"
        className="btn"
        onClick={onStop}
        disabled={status === 'idle'}
      >
        Stop
      </button>
    </div>
  );
}
