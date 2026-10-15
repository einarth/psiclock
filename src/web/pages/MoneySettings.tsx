import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../api';
import { num } from '../format';
import { moneySummary, payoutAmounts, payoutPercents, suggestedPercents, suggestedPlacesPaid } from '../../shared/money';
import type { Entry, MoneyConfig, Tournament } from '../../shared/types';

type Field = { key: string; label: string; hint?: string };

const basics: Field[] = [
  { key: 'buyIn', label: 'Buy-in' },
  { key: 'startingStack', label: 'Starting stack' },
  { key: 'lateRegUntilLevel', label: 'Late registration until level', hint: '0 = no limit' },
  { key: 'guarantee', label: 'Guarantee', hint: '0 = none' },
  { key: 'rounding', label: 'Round prizes down to' },
];
const rebuys: Field[] = [
  { key: 'rebuyPrice', label: 'Rebuy price' },
  { key: 'rebuyChips', label: 'Rebuy chips' },
  { key: 'rebuyUntilLevel', label: 'Rebuys until level', hint: '0 = no limit' },
];
const addOn: Field[] = [
  { key: 'addOnPrice', label: 'Add-on price' },
  { key: 'addOnChips', label: 'Add-on chips' },
];
const switches = ['allowRebuys', 'allowAddOn'] as const;

/** Every setting as text for the inputs; the two switches as 'yes' or ''. */
function toForm(t: Tournament): Record<string, string> {
  const values: Record<string, number | boolean> = { buyIn: t.buyIn, fee: t.fee, startingStack: t.startingStack, ...t.money };
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'yes' : '') : String(v)]),
  );
}

/** Buy-in, rebuy, add-on and late registration settings for the director. */
export function MoneySettings({ t }: { t: Tournament }) {
  const [form, setForm] = useState(() => toForm(t));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const saved = toForm(t);
  const dirty = Object.keys(saved).some((k) => saved[k] !== form[k]);

  // Pick up changes made from another screen, unless there are unsaved edits here.
  useEffect(() => {
    if (!dirty) setForm(toForm(t));
  }, [t]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const n = (k: string) => Number(form[k]);
    const isSwitch = (k: string) => (switches as readonly string[]).includes(k);
    if (Object.entries(form).some(([k, v]) => !isSwitch(k) && !/^\d+$/.test(v.trim()))) {
      setError('Every field must be a whole number, 0 or more.');
      return;
    }
    const money = Object.fromEntries(
      Object.keys(t.money).map((k) => [k, isSwitch(k) ? form[k] === 'yes' : n(k)]),
    ) as unknown as MoneyConfig;
    try {
      await api.updateTournament(t.id, { buyIn: n('buyIn'), fee: n('fee'), startingStack: n('startingStack'), money });
      setMessage('Saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (k: (typeof switches)[number], on: boolean) => setForm({ ...form, [k]: on ? 'yes' : '' });

  const input = (f: Field) => (
    <label key={f.key}>
      {f.label}
      <input inputMode="numeric" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
      {f.hint && <span className="small">{f.hint}</span>}
    </label>
  );

  return (
    <section className="card">
      <h2>Buy-in and rebuys</h2>
      <form onSubmit={save}>
        <div className="grid-form">{basics.map(input)}</div>
        <h3 className="subhead">Rebuys and add-on</h3>
        <label className="check">
          <input type="checkbox" checked={form.allowRebuys === 'yes'} onChange={(e) => toggle('allowRebuys', e.target.checked)} />
          Allow rebuys
        </label>
        {form.allowRebuys === 'yes' && <div className="grid-form">{rebuys.map(input)}</div>}
        <label className="check">
          <input type="checkbox" checked={form.allowAddOn === 'yes'} onChange={(e) => toggle('allowAddOn', e.target.checked)} />
          Allow an add-on
        </label>
        {form.allowAddOn === 'yes' && <div className="grid-form">{addOn.map(input)}</div>}
        {form.allowRebuys !== 'yes' && form.allowAddOn !== 'yes' && <p className="muted small">Freezeout: no rebuys or add-on.</p>}
        <div className="form-actions">
          <button type="submit" disabled={!dirty}>
            Save settings
          </button>
          {dirty && (
            <button type="button" onClick={() => setForm(saved)}>
              Discard changes
            </button>
          )}
          {message && !dirty && <span className="muted">{message}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The payout table. Until the director saves their own percentages it follows
 * the field: about 15% of entries paid on a top-heavy curve.
 */
export function PayoutEditor({ t, entries }: { t: Tournament; entries: Entry[] }) {
  const summary = moneySummary(t, entries);
  const live = payoutPercents(t, entries);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  // What is typed in Places paid and Prize pool; checked when the field is left or Enter is pressed.
  const [placesText, setPlacesText] = useState<string | null>(null);
  const [poolText, setPoolText] = useState<string | null>(null);
  const rows = draft ?? live.map(String);
  const percents = rows.map((r) => Number(r));
  const total = round1(percents.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
  const valid = rows.length > 0 && percents.every((p) => Number.isFinite(p) && p > 0) && Math.abs(total - 100) < 0.05;
  const amounts = payoutAmounts(summary.prizePool, valid ? percents : percents.map((p) => p || 0), t.money.rounding);

  const edit = (next: string[]) => {
    setError('');
    setDraft(next);
  };
  const setPlaces = (n: number) => {
    if (n !== rows.length) edit(suggestedPercents(n).map(String));
  };
  const commitPlaces = () => {
    const typed = placesText?.trim() ?? '';
    setPlacesText(null);
    if (!/^\d+$/.test(typed)) return;
    setPlaces(Math.min(Math.max(1, Number(typed)), Math.max(1, summary.entries)));
  };
  const savePool = async (prizePoolOverride: number | null) => {
    setError('');
    try {
      await api.updateTournament(t.id, { prizePoolOverride });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const commitPool = () => {
    const typed = (poolText ?? '').replace(/[\s.,]/g, '');
    setPoolText(null);
    if (poolText === null || !/^\d+$/.test(typed) || Number(typed) === summary.prizePool) return;
    void savePool(Number(typed));
  };
  const onEnter = (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };
  const save = async (payouts: number[] | null) => {
    setError('');
    try {
      await api.updateTournament(t.id, { payouts });
      setDraft(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Payouts</h2>
        <span className="muted">
          {t.payouts ? 'Your own table' : `Automatic, ${suggestedPlacesPaid(summary.entries)} of ${summary.entries} paid`}
        </span>
      </div>
      <div className="form-actions">
        <label className="inline">
          Prize pool
          <input
            type="number"
            min={0}
            value={poolText ?? String(summary.prizePool)}
            onChange={(e) => setPoolText(e.target.value)}
            onBlur={commitPool}
            onKeyDown={onEnter(commitPool)}
            style={{ width: 140 }}
          />
        </label>
        {summary.poolSource === 'set' ? (
          <>
            <span className="muted">Set by hand.</span>
            <button type="button" onClick={() => savePool(null)}>
              Use what was paid in ({num(summary.automaticPool)})
            </button>
          </>
        ) : (
          <span className="muted">{summary.poolSource === 'guarantee' ? 'The guarantee.' : 'What was paid in.'} Type a sum to set it by hand.</span>
        )}
      </div>
      <div className="money-line">
        <span>
          Entries <b>{summary.entries}</b>
        </span>
        <span>
          Rebuys <b>{summary.rebuys}</b>
        </span>
        <span>
          Add-ons <b>{summary.addOns}</b>
        </span>
        {summary.fees > 0 && (
          <span>
            Fees <b>{num(summary.fees)}</b>
          </span>
        )}
      </div>
      <div className="form-actions">
        <label className="inline">
          Places paid
          <input
            type="number"
            min={1}
            value={placesText ?? String(rows.length)}
            onChange={(e) => setPlacesText(e.target.value)}
            onBlur={commitPlaces}
            onKeyDown={onEnter(commitPlaces)}
            style={{ width: 80 }}
          />
        </label>
        <button type="button" onClick={() => setPlaces(suggestedPlacesPaid(summary.entries))}>
          Use suggested (15%)
        </button>
      </div>
      <table className="payouts">
        <thead>
          <tr>
            <th>Place</th>
            <th>%</th>
            <th className="num">Prize</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input
                  inputMode="decimal"
                  value={r}
                  aria-label={`Percent for place ${i + 1}`}
                  onChange={(e) => edit(rows.map((x, j) => (j === i ? e.target.value : x)))}
                  style={{ width: 90 }}
                />
              </td>
              <td className="num">{num(amounts[i] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className={valid ? '' : 'error'}>{total}%</td>
            <td className="num">{num(amounts.reduce((a, b) => a + b, 0))}</td>
          </tr>
        </tfoot>
      </table>
      {!valid && <p className="error">Percentages must all be above 0 and add up to 100.</p>}
      <div className="form-actions">
        <button className="primary" disabled={!draft || !valid} onClick={() => save(percents)}>
          Save payouts
        </button>
        {draft && <button onClick={() => setDraft(null)}>Discard changes</button>}
        {t.payouts && !draft && <button onClick={() => save(null)}>Go back to automatic</button>}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
