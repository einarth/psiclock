import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { useClockView, useLiveTournament } from '../live';
import { finishingPlace, isAlive } from '../../shared/seating';
import { moneySummary, payoutsFor, withinLevel } from '../../shared/money';
import type { Entry, Player } from '../../shared/types';
import { num, ordinal } from '../format';
import { useSession } from '../session';
import { hasRole } from '../../shared/auth';
import { toDraft, type Draft } from './Players';

type Blocked = { text: string; retry: () => Promise<unknown> };

/** Registration desk: register and seat players, take rebuys and add-ons, and pay out prizes. */
export function Desk({ id }: { id: number }) {
  const { tournament: t, entries, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const me = useSession();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [last, setLast] = useState<{ entry: Entry; collect: number; what: string } | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [error, setError] = useState('');
  // The entry whose player details are open for editing.
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => api.players(search).then(setPlayers), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const prizes = useMemo(() => (t ? payoutsFor(t, entries) : []), [t, entries]);

  /** Runs a desk action. A 409 means a level limit has passed; the desk can confirm and force it. */
  const attempt = async (action: (force: boolean) => Promise<unknown>) => {
    setError('');
    setBlocked(null);
    try {
      await action(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBlocked({ text: err.message, retry: () => action(true) });
      } else setError((err as Error).message);
    }
  };

  const forceBlocked = async () => {
    if (!blocked) return;
    setBlocked(null);
    try {
      await blocked.retry();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const register = (playerId: number) =>
    attempt(async (force) => {
      const entry = await api.register(id, playerId, force);
      setLast({ entry, collect: t!.buyIn + t!.fee, what: 'Buy-in' });
      setSearch('');
    });

  const rebuy = (e: Entry) =>
    attempt(async (force) => {
      const seat = await api.rebuy(id, e.id, force);
      setLast({ entry: { ...e, ...seat }, collect: t!.money.rebuyPrice + t!.money.rebuyFee, what: 'Rebuy' });
    });

  const addOn = (e: Entry) =>
    attempt(async () => {
      await api.addOn(id, e.id);
      setLast({ entry: e, collect: t!.money.addOnPrice + t!.money.addOnFee, what: 'Add-on' });
    });

  const simple = (action: () => Promise<unknown>) =>
    attempt(async () => {
      await action();
    });

  const addAndRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return;
    try {
      const p = await api.createPlayer({ name: search.trim() });
      await register(p.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!t || !view) return <main className="page">{connected ? 'Tournament not found.' : 'Connecting...'}</main>;
  const m = t.money;
  const seated = new Set(entries.filter(isAlive).map((e) => e.playerId));
  const entered = new Set(entries.map((e) => e.playerId));
  const summary = moneySummary(t, entries);
  const remaining = entries.filter(isAlive).length;
  const regOpen = withinLevel(view.levelNumber, m.lateRegUntilLevel);
  const rebuyOpen = m.allowRebuys && withinLevel(view.levelNumber, m.rebuyUntilLevel);
  const inTheMoney = entries
    .map((e) => ({ e, place: finishingPlace(entries, e) }))
    .filter((x): x is { e: Entry; place: number } => x.place !== null && (prizes[x.place - 1] ?? 0) > 0)
    .sort((a, b) => a.place - b.place);
  const shown = entries
    .filter((e) => e.playerName.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => Number(isAlive(b)) - Number(isAlive(a)) || b.id - a.id);

  return (
    <main className="page">
      <header className="page-head">
        <h1>{t.name}: registrations</h1>
        <nav>
          <a href="/">Home</a>
          {hasRole(me?.user, 'director') && <a href={`/director/${id}`}>Manage</a>}
          <a href={`/floor/${id}`}>Floor</a>
          <a href={`/api/tournaments/${id}/results.csv`}>Results (CSV)</a>
        </nav>
      </header>

      {last && (
        <section className="card seat-card">
          <div className="muted">
            {last.what}: {last.entry.playerName}
          </div>
          <div className="seat-card-big">
            Table {last.entry.table} · Seat {last.entry.seat}
          </div>
          {last.collect > 0 && (
            <div className="collect">
              Collect <b>{num(last.collect)}</b>
            </div>
          )}
          {editing !== last.entry.id && (
            <button className="link" onClick={() => setEditing(last.entry.id)}>
              Add {last.entry.playerName}'s details
            </button>
          )}
        </section>
      )}

      <section className="card">
        {!regOpen && (
          <p className="muted small">Late registration closed after level {m.lateRegUntilLevel}.</p>
        )}
        <form onSubmit={addAndRegister}>
          <input
            className="search"
            autoFocus
            placeholder="Type a name to find or add a player"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        {blocked && (
          <div className="notice">
            <span>{blocked.text[0].toUpperCase() + blocked.text.slice(1)}.</span>
            <span className="row-actions">
              <button onClick={forceBlocked}>Do it anyway</button>
              <button onClick={() => setBlocked(null)}>Cancel</button>
            </span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="list">
          {players.slice(0, 15).map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong> <span className="muted">{p.fullName}</span>
              </span>
              {seated.has(p.id) ? (
                <span className="muted">Playing</span>
              ) : (
                <button className="primary" onClick={() => register(p.id)}>
                  {entered.has(p.id) ? 'Re-enter and seat' : 'Register and seat'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {search.trim() && !players.some((p) => p.name.toLowerCase() === search.trim().toLowerCase()) && (
          <button onClick={addAndRegister}>Add "{search.trim()}" as a new player and seat them</button>
        )}
        <p className="muted small">
          Buy-in {num(t.buyIn)}
          {m.allowRebuys && `, rebuy ${num(m.rebuyPrice + m.rebuyFee)}`}
          {m.allowAddOn && `, add-on ${num(m.addOnPrice + m.addOnFee)}`}
        </p>
      </section>

      <section className="card">
        <h2>Money</h2>
        <div className="money-line">
          <span>
            Entries <b>{summary.entries}</b>
          </span>
          <span>
            Still in <b>{remaining}</b>
          </span>
          <span>
            Rebuys <b>{summary.rebuys}</b>
          </span>
          <span>
            Add-ons <b>{summary.addOns}</b>
          </span>
          <span>
            Prize pool <b>{num(summary.prizePool)}</b>
            {summary.poolSource === 'guarantee' && ' (guarantee)'}
            {summary.poolSource === 'set' && ' (set by hand)'}
          </span>
          {summary.fees > 0 && (
            <span>
              Fees <b>{num(summary.fees)}</b>
            </span>
          )}
          <span>
            Places paid <b>{prizes.filter((p) => p > 0).length}</b>
          </span>
        </div>
      </section>

      {inTheMoney.length > 0 && (
        <section className="card">
          <h2>Pay out</h2>
          <ul className="list">
            {inTheMoney.map(({ e, place }) => (
              <li key={e.id}>
                <span>
                  {ordinal(place)} <strong>{e.playerName}</strong>
                </span>
                <span className="row-actions">
                  <b>{num(prizes[place - 1])}</b>
                  {e.paidOut > 0 ? (
                    <>
                      <span className="paid">Paid{e.paidOut !== prizes[place - 1] ? ` ${num(e.paidOut)}` : ''}</span>
                      <button className="link" onClick={() => simple(() => api.markPaid(id, e.id, false))}>
                        Undo
                      </button>
                    </>
                  ) : (
                    <button className="primary" onClick={() => simple(() => api.markPaid(id, e.id))}>
                      Mark paid
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Entries</h2>
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <ul className="list">
          {shown.slice(0, 50).map((e) => {
            const alive = isAlive(e);
            const place = finishingPlace(entries, e);
            const row = (
              <li key={e.id}>
                <span>
                  <span className="player-name" title="Double-click to edit details" onDoubleClick={() => setEditing(e.id)}>
                    {e.playerName}
                  </span>{' '}
                  <span className="muted small">
                    {alive ? `Table ${e.table}, seat ${e.seat}` : `Out ${place ? ordinal(place) : ''}`}
                    {e.rebuys > 0 && `, ${e.rebuys} rebuy${e.rebuys > 1 ? 's' : ''}`}
                    {e.addOn && ', add-on'}
                  </span>
                </span>
                <span className="row-actions">
                  <button className="link" onClick={() => setEditing(editing === e.id ? null : e.id)}>
                    Edit
                  </button>
                  {m.allowRebuys && (
                    <button onClick={() => rebuy(e)} className={rebuyOpen ? '' : 'muted'}>
                      Rebuy
                    </button>
                  )}
                  {e.rebuys > 0 && (
                    <button className="link" onClick={() => simple(() => api.undoRebuy(id, e.id))}>
                      Undo rebuy
                    </button>
                  )}
                  {m.allowAddOn &&
                    (e.addOn ? (
                      <button className="link" onClick={() => simple(() => api.addOn(id, e.id, true))}>
                        Undo add-on
                      </button>
                    ) : (
                      alive && <button onClick={() => addOn(e)}>Add-on</button>
                    ))}
                </span>
              </li>
            );
            return editing === e.id ? [row, <PlayerDetails key={`edit-${e.id}`} playerId={e.playerId} onClose={() => setEditing(null)} />] : row;
          })}
        </ul>
        {shown.length > 50 && <p className="muted small">Showing 50 of {shown.length}. Type in the filter to find others.</p>}
      </section>
    </main>
  );
}

/** Name, full name, email and phone of a player who was registered with just a name. */
function PlayerDetails({ playerId, onClose }: { playerId: number; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.player(playerId).then((p) => setDraft(toDraft(p)), (err) => setError((err as Error).message));
  }, [playerId]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError('');
    try {
      await api.updatePlayer(playerId, draft);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const field = (key: keyof Draft, label: string, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        required={key === 'name'}
        autoFocus={key === 'fullName'}
        value={draft![key]}
        onChange={(e) => setDraft({ ...draft!, [key]: e.target.value })}
      />
    </label>
  );

  if (!draft) return <li className="edit-row muted">{error || 'Loading...'}</li>;
  return (
    <li className="edit-row">
      <form className="grid-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        {field('name', 'Name (shown on screens)')}
        {field('fullName', 'Full name')}
        {field('email', 'Email', 'email')}
        {field('phone', 'Phone', 'tel')}
        <button type="submit" className="primary">
          Save details
        </button>
        <button type="button" className="link" onClick={onClose}>
          Cancel
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </li>
  );
}
