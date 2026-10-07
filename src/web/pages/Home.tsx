import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { BlindStructure, Tournament } from '../../shared/types';
import { num } from '../format';

export function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [structures, setStructures] = useState<BlindStructure[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', buyIn: 0, fee: 0, startingStack: 30000, structureId: 0, theme: 'classic' });

  const load = () => {
    api.tournaments().then(setTournaments);
    api.structures().then((s) => {
      setStructures(s);
      setForm((f) => (f.structureId ? f : { ...f, structureId: s[0]?.id ?? 0 }));
    });
  };
  useEffect(load, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.createTournament(form);
      setForm((f) => ({ ...f, name: '' }));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>PSICLOCK</h1>
        <nav>
          <a href="/players">Players</a>
        </nav>
      </header>

      <section className="card">
        <h2>Tournaments</h2>
        {tournaments.length === 0 && <p className="muted">No tournaments yet. Create one below.</p>}
        <ul className="list">
          {tournaments.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.name}</strong> <span className={`badge badge-${t.status}`}>{t.status}</span>
              </span>
              <span className="actions">
                <a href={`/director/${t.id}`}>Control</a>
                <a href={`/display/${t.id}`} target="_blank" rel="noreferrer">
                  Big screen
                </a>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>New tournament</h2>
        <form className="grid-form" onSubmit={create}>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Buy-in
            <input type="number" min={0} value={form.buyIn} onChange={(e) => setForm({ ...form, buyIn: +e.target.value })} />
          </label>
          <label>
            Fee
            <input type="number" min={0} value={form.fee} onChange={(e) => setForm({ ...form, fee: +e.target.value })} />
          </label>
          <label>
            Starting stack
            <input
              type="number"
              min={0}
              value={form.startingStack}
              onChange={(e) => setForm({ ...form, startingStack: +e.target.value })}
            />
          </label>
          <label>
            Blind structure
            <select value={form.structureId} onChange={(e) => setForm({ ...form, structureId: +e.target.value })}>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.levels.filter((l) => l.kind === 'level').length} levels)
                </option>
              ))}
            </select>
          </label>
          <label>
            Big-screen theme
            <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
              <option value="classic">Classic green</option>
              <option value="midnight">Midnight</option>
            </select>
          </label>
          <button type="submit">Create tournament</button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted small">Starting stack {num(form.startingStack)}. Structures can be edited in a later step.</p>
      </section>
    </main>
  );
}
