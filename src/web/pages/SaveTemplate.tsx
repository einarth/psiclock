import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Tournament, TournamentTemplate } from '../../shared/types';

/** Director card: save this tournament's set-up so the next one can start from it. */
export function SaveTemplate({ t }: { t: Tournament }) {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [name, setName] = useState(t.name);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.templates().then(setTemplates);
  }, []);

  const replacing = templates.some((x) => x.name.toLowerCase() === name.trim().toLowerCase());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (replacing && !confirm(`Replace the template "${name.trim()}"?`)) return;
    try {
      const saved = await api.saveTemplate(name, t.id);
      setMessage(`Saved as "${saved.name}". Pick it under "Start from" when you create a tournament.`);
      setTemplates(await api.templates());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="card">
      <h2>Save as template</h2>
      <p className="muted small">
        Keeps the buy-in, starting stack, blind levels, tables, rebuy and late-registration settings, payout table and
        screen layout. Players and the clock are not saved.
      </p>
      <form className="form-actions" onSubmit={save}>
        <label className="inline">
          Template name
          <input required value={name} onChange={(e) => setName(e.target.value)} list="template-names" />
          <datalist id="template-names">
            {templates.map((x) => (
              <option key={x.id} value={x.name} />
            ))}
          </datalist>
        </label>
        <button type="submit">{replacing ? 'Replace template' : 'Save template'}</button>
      </form>
      {message && <p className="paid">{message}</p>}
      {error && <p className="error">{error[0].toUpperCase() + error.slice(1)}.</p>}
    </section>
  );
}
