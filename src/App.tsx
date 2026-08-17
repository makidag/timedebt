import { useState } from 'react';
import { AnomalyBanner, RecoveryBanner } from './components/Banners';
import { Controls } from './components/Controls';
import { EntriesView } from './components/EntriesView';
import { ProgressRail } from './components/ProgressRail';
import { SplitDisplay } from './components/SplitDisplay';
import { WeekView } from './components/WeekView';
import { formatHm } from './time';
import { useTimeDebt } from './useTimeDebt';

type View = 'today' | 'week' | 'entries';

const TABS: { id: View; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'entries', label: 'Entries' },
];

export function App(): JSX.Element {
  const store = useTimeDebt();
  const [view, setView] = useState<View>('today');
  const { ledger, status } = store;

  if (!store.loaded) {
    return (
      <main className="app app--loading">
        <p className="muted">Reading the ledger…</p>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          Time<span className="brand__thin">Debt</span>
        </h1>
        <nav className="tabs" aria-label="Views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab${view === tab.id ? ' tab--active' : ''}`}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <p className="streak" title="Consecutive required days that met their target">
          <span className="streak__n">{ledger.currentStreakDays}</span>
          <span className="streak__label">day streak</span>
        </p>
      </header>

      {store.recovery && (
        <RecoveryBanner
          recovery={store.recovery}
          onAccept={store.acknowledgeRecovery}
          onEdit={() => {
            store.acknowledgeRecovery();
            setView('entries');
          }}
          onDiscard={store.discardRecovered}
        />
      )}

      <AnomalyBanner anomalies={ledger.anomalies} onReview={() => setView('entries')} />

      {view === 'today' && (
        <main className="today">
          <SplitDisplay ledger={ledger} running={status === 'running'} />
          <ProgressRail day={ledger.today} />
          <Controls
            status={status}
            onStart={store.start}
            onPause={store.pause}
            onResume={store.resume}
            onStop={store.stop}
          />
        </main>
      )}

      {view === 'week' && (
        <main>
          <WeekView ledger={ledger} />
        </main>
      )}

      {view === 'entries' && (
        <main>
          <EntriesView
            ledger={ledger}
            intervals={store.intervals}
            now={store.now}
            onSave={store.saveInterval}
            onDelete={store.deleteInterval}
            onReplaceAll={store.replaceAll}
          />
        </main>
      )}

      <footer className="foot">
        <span>All days are KST (UTC+9).</span>
        <span>
          If the day ended now:{' '}
          <strong className={ledger.projectedBalanceSeconds > 0 ? 'owed' : 'banked'}>
            {ledger.projectedBalanceSeconds === 0
              ? 'square'
              : `${formatHm(Math.abs(ledger.projectedBalanceSeconds))} ${
                  ledger.projectedBalanceSeconds > 0 ? 'owed' : 'banked'
                }`}
          </strong>
        </span>
      </footer>
    </div>
  );
}
