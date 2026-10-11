import { useState } from 'react';
import { api } from '../api';
import { useClockView, useLiveTournament } from '../live';
import { formatClock } from '../../shared/clock';
import type { ClockCommand } from '../../shared/types';
import { blindsText } from '../format';
import { MoneySettings, PayoutEditor } from './MoneySettings';
import { ScreenControl } from './ScreenControl';
import { SaveTemplate } from './SaveTemplate';

export function Director({ id }: { id: number }) {
  const { tournament: t, entries, moves, setTournament, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const [error, setError] = useState('');

  const send = async (cmd: ClockCommand) => {
    setError('');
    try {
      setTournament(await api.clock(id, cmd));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!t || !view) return <main className="page">{connected ? 'Tournament not found.' : 'Connecting...'}</main>;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{t.name}</h1>
        <nav>
          <a href="/">Home</a>
          <a href={`/desk/${id}`}>Desk</a>
          <a href={`/floor/${id}`}>Floor</a>
          <a href={`/display/${id}`} target="_blank" rel="noreferrer">
            Open big screen
          </a>
          <a href={`/payouts/${id}`} target="_blank" rel="noreferrer">
            Payout screen
          </a>
        </nav>
      </header>
      {!connected && <p className="error">Lost connection to the server, reconnecting...</p>}

      <section className="card control">
        <div className="control-clock">{formatClock(view.remainingMs)}</div>
        <div className="control-level">
          {view.level?.kind === 'break' ? 'Break' : `Level ${view.levelNumber}`}: {blindsText(view.level)}
        </div>
        <div className="control-buttons">
          <button onClick={() => send({ type: 'clock.setLevel', levelIndex: view.levelIndex - 1 })}>Previous level</button>
          <button onClick={() => send({ type: 'clock.adjust', deltaMs: -60_000 })}>-1 min</button>
          {view.running ? (
            <button className="primary" onClick={() => send({ type: 'clock.pause' })}>
              Pause
            </button>
          ) : (
            <button className="primary" onClick={() => send({ type: 'clock.start' })} disabled={view.finished}>
              {t.status === 'setup' ? 'Start tournament' : 'Resume'}
            </button>
          )}
          <button onClick={() => send({ type: 'clock.adjust', deltaMs: 60_000 })}>+1 min</button>
          <button onClick={() => send({ type: 'clock.setLevel', levelIndex: view.levelIndex + 1 })}>Next level</button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <ScreenControl t={t} entries={entries} moves={moves} offset={offset} />
      <PayoutEditor t={t} entries={entries} />
      <MoneySettings t={t} />

      <section className="card">
        <h2>Structure</h2>
        <table className="levels">
          <thead>
            <tr>
              <th>#</th>
              <th>Blinds</th>
              <th>Minutes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {t.levels.map((l, i) => (
              <tr key={i} className={i === view.levelIndex ? 'current' : i < view.levelIndex ? 'past' : ''}>
                <td>{l.kind === 'level' ? t.levels.slice(0, i + 1).filter((x) => x.kind === 'level').length : ''}</td>
                <td>
                  {blindsText(l)}
                  {l.kind === 'break' && l.note ? `, ${l.note}` : ''}
                </td>
                <td>{l.minutes}</td>
                <td>
                  {i !== view.levelIndex && (
                    <button className="link" onClick={() => send({ type: 'clock.setLevel', levelIndex: i })}>
                      Jump here
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SaveTemplate t={t} />
    </main>
  );
}
