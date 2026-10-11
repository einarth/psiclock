import { useState } from 'react';
import { api } from '../api';
import { blindsText } from '../format';
import type { ClockView } from '../../shared/clock';
import type { Level, Tournament } from '../../shared/types';

/** A row being edited. `was` is its index in the saved structure, null for a new row. */
interface Row {
  key: number;
  was: number | null;
  kind: Level['kind'];
  smallBlind: string;
  bigBlind: string;
  ante: string;
  minutes: string;
  note: string;
}

let nextKey = 1;

function toRow(l: Level, was: number | null): Row {
  return {
    key: nextKey++,
    was,
    kind: l.kind,
    smallBlind: l.kind === 'level' ? String(l.smallBlind) : '',
    bigBlind: l.kind === 'level' ? String(l.bigBlind) : '',
    ante: l.kind === 'level' ? String(l.ante) : '',
    minutes: String(l.minutes),
    note: l.kind === 'break' ? (l.note ?? '') : '',
  };
}

const whole = (v: string) => /^\d+$/.test(v.trim());

/** The row as a level, or an error message saying what is wrong with it. */
function toLevel(r: Row, n: string): Level | string {
  if (!whole(r.minutes) || Number(r.minutes) < 1) return `${n}: minutes must be a whole number above 0`;
  if (r.kind === 'break') {
    const note = r.note.trim();
    return { kind: 'break', minutes: Number(r.minutes), ...(note ? { note } : {}) };
  }
  if (![r.smallBlind, r.bigBlind, r.ante].every(whole)) return `${n}: blinds and ante must be whole numbers`;
  if (Number(r.bigBlind) < Number(r.smallBlind)) return `${n}: the big blind is smaller than the small blind`;
  return { kind: 'level', smallBlind: Number(r.smallBlind), bigBlind: Number(r.bigBlind), ante: Number(r.ante), minutes: Number(r.minutes) };
}

/** A new level after `prev`: the same length, blinds doubled, as a starting point to edit. */
function levelAfter(rows: Row[], i: number): Row {
  const prev = rows.slice(0, i + 1).reverse().find((r) => r.kind === 'level');
  const minutes = rows[i]?.kind === 'level' ? rows[i].minutes : (prev?.minutes ?? '20');
  const double = (v: string | undefined) => String(whole(v ?? '') ? Number(v) * 2 : 0);
  return { key: nextKey++, was: null, kind: 'level', smallBlind: double(prev?.smallBlind), bigBlind: double(prev?.bigBlind), ante: double(prev?.ante), minutes, note: '' };
}

const breakRow = (): Row => ({ key: nextKey++, was: null, kind: 'break', smallBlind: '', bigBlind: '', ante: '', minutes: '15', note: '' });

/** The blind structure: a list to jump around in, and an editor to add, change and delete levels. */
export function StructureEditor({ t, view, onJump }: { t: Tournament; view: ClockView; onJump: (index: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const levelNo = (list: { kind: Level['kind'] }[], i: number) =>
    list[i].kind === 'level' ? list.slice(0, i + 1).filter((x) => x.kind === 'level').length : null;
  // Before the start the clock sits on the first level but nothing is being played yet.
  const playing = t.status !== 'setup';
  const isCurrent = (r: Row) => playing && r.was === view.levelIndex;

  const start = () => {
    setError('');
    setRows(t.levels.map((l, i) => toRow(l, i)));
  };
  const change = (key: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const insert = (i: number, row: Row) => setRows((rs) => [...rs!.slice(0, i + 1), row, ...rs!.slice(i + 1)]);
  const remove = (key: number) => setRows((rs) => rs!.filter((r) => r.key !== key));

  const save = async () => {
    if (!rows) return;
    setError('');
    const levels: Level[] = [];
    for (const [i, r] of rows.entries()) {
      const n = r.kind === 'level' ? `Level ${levelNo(rows, i)}` : `Break after level ${levelNo(rows, i - 1) ?? 0}`;
      const l = toLevel(r, n);
      if (typeof l === 'string') return setError(l);
      levels.push(l);
    }
    if (!levels.length) return setError('Keep at least one level.');
    const current = rows.findIndex((r) => r.was === view.levelIndex);
    setSaving(true);
    try {
      await api.saveLevels(t.id, levels, current < 0 ? 0 : current, view.levelIndex);
      setRows(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!rows) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Structure</h2>
          <button onClick={start}>Edit levels</button>
        </div>
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
                <td>{levelNo(t.levels, i) ?? ''}</td>
                <td>
                  {blindsText(l)}
                  {l.kind === 'break' && l.note ? `, ${l.note}` : ''}
                </td>
                <td>{l.minutes}</td>
                <td>
                  {i !== view.levelIndex && (
                    <button className="link" onClick={() => onJump(i)}>
                      Jump here
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  const num = (r: Row, k: 'smallBlind' | 'bigBlind' | 'ante' | 'minutes', label: string) => (
    <input inputMode="numeric" aria-label={label} value={r[k]} onChange={(e) => change(r.key, { [k]: e.target.value })} />
  );

  return (
    <section className="card">
      <div className="card-head">
        <h2>Structure</h2>
        <span className="muted">Editing. Changes reach the screens when you save.</span>
      </div>
      <table className="levels levels-edit">
        <thead>
          <tr>
            <th>#</th>
            <th>Small blind</th>
            <th>Big blind</th>
            <th>Ante</th>
            <th>Minutes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={isCurrent(r) ? 'current' : ''}>
              <td>{levelNo(rows, i) ?? ''}</td>
              {r.kind === 'level' ? (
                <>
                  <td>{num(r, 'smallBlind', 'Small blind')}</td>
                  <td>{num(r, 'bigBlind', 'Big blind')}</td>
                  <td>{num(r, 'ante', 'Ante')}</td>
                </>
              ) : (
                <td colSpan={3}>
                  <input
                    className="break-note"
                    aria-label="Break note"
                    placeholder="Break (note for the screen, e.g. colour up the 25s)"
                    value={r.note}
                    onChange={(e) => change(r.key, { note: e.target.value })}
                  />
                </td>
              )}
              <td>{num(r, 'minutes', 'Minutes')}</td>
              <td className="row-actions">
                <button type="button" className="link" onClick={() => insert(i, levelAfter(rows, i))}>
                  + level
                </button>
                <button type="button" className="link" onClick={() => insert(i, breakRow())}>
                  + break
                </button>
                {isCurrent(r) ? (
                  <span className="muted small">playing now</span>
                ) : (
                  <button type="button" className="link danger-link" onClick={() => remove(r.key)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">New rows start with the blinds doubled; change them to what you want.</p>
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={saving}>
          Save structure
        </button>
        <button onClick={() => setRows(null)} disabled={saving}>
          Discard changes
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
