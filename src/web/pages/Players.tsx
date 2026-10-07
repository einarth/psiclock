import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Player } from '../../shared/types';

type Draft = { name: string; fullName: string; email: string; phone: string };
const empty: Draft = { name: '', fullName: '', email: '', phone: '' };
const toDraft = (p: Player): Draft => ({
  name: p.name,
  fullName: p.fullName ?? '',
  email: p.email ?? '',
  phone: p.phone ?? '',
});

export function Players() {
  const [search, setSearch] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = (q = search) => api.players(q).then(setPlayers);
  useEffect(() => {
    const timer = setTimeout(() => load(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) await api.updatePlayer(editing, draft);
      else await api.createPlayer(draft);
      setDraft(empty);
      setEditing(null);
      load();
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
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <main className="page">
      <header className="page-head">
        <h1>Players</h1>
        <nav>
          <a href="/">Tournaments</a>
        </nav>
      </header>

      <section className="card">
        <h2>{editing ? 'Edit player' : 'Add player'}</h2>
        <form className="grid-form" onSubmit={save}>
          {field('name', 'Name (shown on screens)')}
          {field('fullName', 'Full name')}
          {field('email', 'Email', 'email')}
          {field('phone', 'Phone', 'tel')}
          <button type="submit">{editing ? 'Save' : 'Add player'}</button>
          {editing && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setEditing(null);
                setDraft(empty);
              }}
            >
              Cancel
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted small">Only the name is required; the rest can be filled in later.</p>
      </section>

      <section className="card">
        <input className="search" placeholder="Search name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <table className="players">
          <thead>
            <tr>
              <th>Name</th>
              <th>Full name</th>
              <th>Email</th>
              <th>Phone</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.fullName}</td>
                <td>{p.email}</td>
                <td>{p.phone}</td>
                <td>
                  <button
                    className="link"
                    onClick={() => {
                      setEditing(p.id);
                      setDraft(toDraft(p));
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {players.length === 0 && <p className="muted">No players found.</p>}
      </section>
    </main>
  );
}
