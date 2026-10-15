import { useEffect, useState } from 'react';
import { api } from '../api';
import { useClockView, useLiveTournament } from '../live';
import { formatClock } from '../../shared/clock';
import { isAlive } from '../../shared/seating';
import type { ClockCommand, Tournament } from '../../shared/types';
import { blindsText, fromLocalInput, startText, toLocalInput } from '../format';
import { MoneySettings, PayoutEditor } from './MoneySettings';
import { ScreenControl } from './ScreenControl';
import { SaveTemplate } from './SaveTemplate';
import { StructureEditor } from './StructureEditor';

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
  const alive = entries.filter(isAlive);
  const winner = t.status === 'finished' && alive.length === 1 ? alive[0] : null;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{t.name}</h1>
        <nav>
          <a href="/">Home</a>
          <a href={`/desk/${id}`}>Registrations</a>
          <a href={`/floor/${id}`}>Floor</a>
          <a href={`/display/${id}`} target="_blank" rel="noreferrer">
            Open big screen
          </a>
        </nav>
      </header>
      {!connected && <p className="error">Lost connection to the server, reconnecting...</p>}

      <section className="card control">
        <div className="control-clock">{formatClock(view.remainingMs)}</div>
        <div className="control-level">
          {view.level?.kind === 'break' ? 'Break' : `Level ${view.levelNumber}`}: {blindsText(view.level)}
        </div>
        {winner && (
          <p className="control-winner">
            Finished. <strong>{winner.playerName}</strong> won. Undo the last bust on the Floor page to carry on.
          </p>
        )}
        {t.status === 'setup' && <StartTime t={t} />}
        <div className="control-buttons">
          <button onClick={() => send({ type: 'clock.setLevel', levelIndex: view.levelIndex - 1 })}>Previous level</button>
          <button onClick={() => send({ type: 'clock.adjust', deltaMs: -60_000 })}>-1 min</button>
          {view.running ? (
            <button className="primary" onClick={() => send({ type: 'clock.pause' })}>
              Pause
            </button>
          ) : (
            <button className="primary" onClick={() => send({ type: 'clock.start' })} disabled={view.finished || !!winner}>
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

      <StructureEditor t={t} view={view} onJump={(levelIndex) => send({ type: 'clock.setLevel', levelIndex })} />

      <SaveTemplate t={t} />
    </main>
  );
}

/** The planned start, which the big screen counts down to. The clock still waits for "Start tournament". */
function StartTime({ t }: { t: Tournament }) {
  const [value, setValue] = useState(toLocalInput(t.startsAt));
  const [error, setError] = useState('');
  useEffect(() => setValue(toLocalInput(t.startsAt)), [t.startsAt]);
  const save = async (v: string) => {
    setError('');
    try {
      await api.updateTournament(t.id, { startsAt: fromLocalInput(v) });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="control-start">
      <label className="inline">
        Starts at
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {value !== toLocalInput(t.startsAt) && (
        <button type="button" onClick={() => save(value)}>
          Save start time
        </button>
      )}
      {t.startsAt && value === toLocalInput(t.startsAt) && (
        <span className="muted small">
          The big screen counts down to {startText(t.startsAt)}.{' '}
          <button type="button" className="link" onClick={() => save('')}>
            Clear
          </button>
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
