import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { BlindStructure, TemplateConfig, Tournament, TournamentTemplate } from '../../shared/types';
import { num } from '../format';
import { SessionFooter, signInUrl, useSession } from '../session';
import { hasRole } from '../../shared/auth';

/** Start page: the tournament list for everyone, with staff links and the create form for signed-in staff. */
export function Home() {
  const me = useSession();
  const user = me?.user ?? null;
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [structures, setStructures] = useState<BlindStructure[]>([]);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  // "" = blank, "t:<id>" = a saved template, "c:<id>" = a copy of an earlier tournament.
  const [source, setSource] = useState('');
  const [form, setForm] = useState({ name: '', buyIn: 0, fee: 0, startingStack: 30000, structureId: 0, theme: 'slate', tableCount: 10, seatsPerTable: 9 });
  const isDirector = hasRole(user, 'director');

  const load = () => {
    api.tournaments().then(setTournaments);
    if (isDirector) api.templates().then(setTemplates);
    api.structures().then((s) => {
      setStructures(s);
      setForm((f) => (f.structureId ? f : { ...f, structureId: s[0]?.id ?? 0 }));
    });
  };
  useEffect(load, [isDirector]);

  const sourceConfig = (value: string): TemplateConfig | undefined => {
    const id = Number(value.slice(2));
    if (value.startsWith('t:')) return templates.find((x) => x.id === id);
    if (value.startsWith('c:')) {
      const t = tournaments.find((x) => x.id === id);
      return t && { ...t, tableCount: t.tables.length, seatsPerTable: t.tables[0]?.seats ?? 9 };
    }
  };
  const chosen = sourceConfig(source);

  const pickSource = (value: string) => {
    setSource(value);
    const c = sourceConfig(value);
    if (c) {
      const { buyIn, fee, startingStack, tableCount, seatsPerTable } = c;
      setForm((f) => ({ ...f, buyIn, fee, startingStack, tableCount, seatsPerTable }));
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const id = Number(source.slice(2));
      await api.createTournament({
        ...form,
        templateId: source.startsWith('t:') ? id : undefined,
        fromTournamentId: source.startsWith('c:') ? id : undefined,
      });
      setForm((f) => ({ ...f, name: '' }));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
    <main className="page">
      <header className="page-head">
        <h1>PSICLOCK</h1>
        <nav>
          {hasRole(user, 'desk') && <a href="/players">Players</a>}
          {hasRole(user, 'director') && <a href="/layouts">Screen layouts</a>}
          {hasRole(user, 'admin') && <a href="/users">Logins</a>}
          {me && !user && <a href={me.setupNeeded ? '/login' : signInUrl()}>{me.setupNeeded ? 'Set up logins' : 'Sign in'}</a>}
        </nav>
      </header>

      <section className="card">
        <h2>Tournaments</h2>
        {tournaments.length === 0 && <p className="muted">No tournaments yet.</p>}
        <ul className="list">
          {tournaments.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.name}</strong> <span className={`badge badge-${t.status}`}>{t.status}</span>
              </span>
              <span className="actions">
                {hasRole(user, 'director') && <a href={`/director/${t.id}`}>Manage</a>}
                {hasRole(user, 'desk') && <a href={`/desk/${t.id}`}>Desk</a>}
                {hasRole(user, 'floor') && <a href={`/floor/${t.id}`}>Floor</a>}
                <a href={`/display/${t.id}`} target="_blank" rel="noreferrer">
                  Big screen
                </a>
                <a href={`/payouts/${t.id}`} target="_blank" rel="noreferrer">
                  Payouts
                </a>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isDirector && (
      <section className="card">
        <h2>New tournament</h2>
        <form className="grid-form" onSubmit={create}>
          <label>
            Start from
            <select value={source} onChange={(e) => pickSource(e.target.value)}>
              <option value="">Blank tournament</option>
              {templates.length > 0 && (
                <optgroup label="Templates">
                  {templates.map((x) => (
                    <option key={x.id} value={`t:${x.id}`}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {tournaments.length > 0 && (
                <optgroup label="Copy an earlier tournament">
                  {tournaments.map((x) => (
                    <option key={x.id} value={`c:${x.id}`}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
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
            Tables
            <input
              type="number"
              min={0}
              max={50}
              value={form.tableCount}
              onChange={(e) => setForm({ ...form, tableCount: +e.target.value })}
            />
          </label>
          <label>
            Seats per table
            <input
              type="number"
              min={2}
              max={12}
              value={form.seatsPerTable}
              onChange={(e) => setForm({ ...form, seatsPerTable: +e.target.value })}
            />
          </label>
          {chosen ? (
            <label>
              Blind structure
              <input disabled value={`As in the original (${chosen.levels.filter((l) => l.kind === 'level').length} levels)`} />
            </label>
          ) : (
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
          )}
          <button type="submit">Create tournament</button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted small">
          {chosen
            ? 'Blind levels, rebuy and late-registration settings, the payout table and the screen layout are copied too.'
            : `Starting stack ${num(form.startingStack)}. To reuse a set-up, open a tournament's clock page and save it as a template.`}
        </p>
        {templates.length > 0 && (
          <details className="templates">
            <summary>Manage templates ({templates.length})</summary>
            <ul className="list">
              {templates.map((x) => (
                <li key={x.id}>
                  <span>
                    {x.name}{' '}
                    <span className="muted small">
                      buy-in {num(x.buyIn)}, {x.levels.filter((l) => l.kind === 'level').length} levels
                    </span>
                  </span>
                  <button
                    className="link danger-link"
                    onClick={async () => {
                      if (!confirm(`Delete the template "${x.name}"?`)) return;
                      await api.deleteTemplate(x.id);
                      if (source === `t:${x.id}`) setSource('');
                      load();
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      )}
    </main>
    <SessionFooter />
    </>
  );
}
