import { useEffect, useState } from 'react';
import { api } from '../api';
import { useClockView, useServerNow } from '../live';
import { ScreenView, currentScene } from '../screen/ScreenView';
import { defaultLayout, type ScreenLayout } from '../../shared/layout';
import type { Entry, Move, Scene, Tournament } from '../../shared/types';

const sceneNames: Record<Scene, string> = {
  clock: 'Clock',
  seating: 'Seating',
  moves: 'Player moves',
  payouts: 'Payouts',
  message: 'Message',
};

/** Director card: what the big screens show right now, and which layout they use. */
export function ScreenControl({ t, entries, moves, offset }: { t: Tournament; entries: Entry[]; moves: Move[]; offset: number }) {
  const now = useServerNow(offset);
  const view = useClockView(t, offset);
  const [layouts, setLayouts] = useState<ScreenLayout[]>([]);
  const [pick, setPick] = useState<number | null>(t.layoutId);
  const [applied, setApplied] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [message, setMessage] = useState(t.screen.message ?? '');
  const [error, setError] = useState('');
  const scene = currentScene(t, now);
  const left = scene !== 'clock' && t.screen.until ? Math.max(0, Math.ceil((t.screen.until - now) / 1000)) : null;

  useEffect(() => {
    api.layouts().then(setLayouts);
  }, []);
  // Follow changes made from another device.
  useEffect(() => setPick(t.layoutId), [t.layoutId]);

  const picked = layouts.find((l) => l.id === pick) ?? null;
  const editUrl = `/layouts?tournament=${t.id}${pick ? `&layout=${pick}` : ''}`;
  const apply = () =>
    act(async () => {
      await api.updateTournament(t.id, { layoutId: pick });
      setApplied(`The screens now use ${picked ? `"${picked.name}"` : 'the built-in layout'}.`);
    });

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const show = (s: Scene) => act(() => api.setScreen(t.id, { scene: s, seconds: s === 'clock' ? 0 : seconds, message }));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Big screens</h2>
        <span className="muted">
          Showing <b>{sceneNames[scene]}</b>
          {left !== null && `, back to the clock in ${left} s`}
        </span>
      </div>
      <div className="control-buttons scene-buttons">
        {(Object.keys(sceneNames) as Scene[]).map((s) => (
          <button key={s} className={s === scene ? 'primary' : ''} onClick={() => show(s)}>
            {sceneNames[s]}
          </button>
        ))}
      </div>
      <div className="grid-form">
        <label>
          Message
          <input
            value={message}
            placeholder="E.g. Dinner break, back at 20:30"
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => message !== (t.screen.message ?? '') && act(() => api.setScreen(t.id, { message }))}
          />
        </label>
        <label>
          Go back to the clock
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            <option value={30}>After 30 seconds</option>
            <option value={60}>After 1 minute</option>
            <option value={120}>After 2 minutes</option>
            <option value={300}>After 5 minutes</option>
            <option value={0}>Never, stay until changed</option>
          </select>
        </label>
      </div>
      <div className="layout-switch">
        <div className="layout-thumb">
          {view && (
            <ScreenView
              t={t}
              entries={entries}
              view={view}
              layout={picked ?? defaultLayout}
              moves={moves}
              now={now}
              scene="clock"
            />
          )}
        </div>
        <div className="stack-form">
          <label>
            Screen layout
            <select value={pick ?? ''} onChange={(e) => (setApplied(''), setPick(e.target.value ? Number(e.target.value) : null))}>
              <option value="">Built-in</option>
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.id === t.layoutId ? ' (on screen now)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="row-actions">
            <button className="primary" disabled={pick === t.layoutId} onClick={apply}>
              Apply to screens
            </button>
            <a className="button" href={editUrl}>
              {pick ? 'Edit this layout' : 'Customise'}
            </a>
          </span>
          {pick !== t.layoutId ? (
            <span className="muted small">Preview only. The screens change when you press Apply.</span>
          ) : (
            applied && <span className="paid small">{applied}</span>
          )}
        </div>
      </div>
      <label className="inline check">
        <input
          type="checkbox"
          checked={t.screen.autoMoves}
          onChange={(e) => act(() => api.setScreen(t.id, { autoMoves: e.target.checked }))}
        />
        Show player moves for a minute when a table is broken
      </label>
      <p className="muted small">
        To keep one TV on a single screen, add <code>?scene=payouts</code> (or seating, moves, clock) to its address.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
