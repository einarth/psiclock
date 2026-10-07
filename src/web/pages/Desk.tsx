import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useLiveTournament } from '../live';
import { fieldStats, isAlive } from '../../shared/seating';
import type { Entry, Player } from '../../shared/types';

/** Registration desk: find or add a player and give them a seat. Money handling arrives in step 4. */
export function Desk({ id }: { id: number }) {
  const { tournament: t, entries, connected } = useLiveTournament(id);
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [last, setLast] = useState<Entry | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => api.players(search).then(setPlayers), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const register = async (playerId: number) => {
    setError('');
    try {
      setLast(await api.register(id, playerId));
      setSearch('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

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

  if (!t) return <main className="page">{connected ? 'Tournament not found.' : 'Connecting...'}</main>;
  const seated = new Set(entries.filter(isAlive).map((e) => e.playerId));
  const entered = new Set(entries.map((e) => e.playerId));
  const stats = fieldStats(entries, t.startingStack);

  return (
    <main className="page">
      <header className="page-head">
        <h1>{t.name}: registration</h1>
        <nav>
          <a href="/">All tournaments</a>
          <a href={`/floor/${id}`}>Floor</a>
        </nav>
      </header>

      {last && (
        <section className="card seat-card">
          <div className="muted">{last.playerName}</div>
          <div className="seat-card-big">
            Table {last.table} · Seat {last.seat}
          </div>
        </section>
      )}

      <section className="card">
        <form onSubmit={addAndRegister}>
          <input
            className="search"
            autoFocus
            placeholder="Type a name to find or add a player"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
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
      </section>

      <section className="card">
        <h2>
          Entries: {stats.entries}, still in: {stats.remaining}
        </h2>
        <ul className="list">
          {[...entries].reverse().slice(0, 20).map((e) => (
            <li key={e.id}>
              <span>{e.playerName}</span>
              <span className="muted">{isAlive(e) ? `Table ${e.table}, seat ${e.seat}` : 'Out'}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
