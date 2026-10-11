import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { api, type Asset } from '../api';
import { useClockView, useLiveTournament, useServerNow } from '../live';
import { ScreenView } from '../screen/ScreenView';
import { themes } from '../themes';
import {
  defaultLayout,
  showWhenNames,
  widgetNames,
  widgetTypes,
  zoneNames,
  zones,
  type ColorKey,
  type LayoutConfig,
  type ScreenLayout,
  type ShowWhen,
  type Widget,
  type WidgetType,
  type Zone,
} from '../../shared/layout';
import { defaultStructures } from '../../shared/structures';
import { clockAt } from '../../shared/clock';
import { defaultMoney } from '../../shared/money';
import { defaultScreen, type Entry, type Tournament } from '../../shared/types';

const colorNames: Record<ColorKey, string> = {
  bg: 'Background',
  text: 'Text',
  muted: 'Labels',
  accent: 'Highlights',
  warning: 'Warnings',
};

const fonts = [
  { value: '', label: 'Theme font' },
  { value: "'Segoe UI', system-ui, sans-serif", label: 'Clean sans-serif' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Classic serif' },
  { value: "'Arial Narrow', 'Roboto Condensed', Impact, sans-serif", label: 'Condensed' },
  { value: "Consolas, 'Courier New', monospace", label: 'Monospace' },
];

type Preview = 'live' | 'open' | 'final';

/** A made-up tournament so the editor has something to show before any tournament exists. */
function demoTournament(): { t: Tournament; entries: Entry[] } {
  const now = Date.now();
  const t: Tournament = {
    id: 0,
    name: 'Demo tournament',
    status: 'running',
    buyIn: 20000,
    fee: 2000,
    startingStack: 30000,
    levels: defaultStructures[0].levels,
    clock: { running: true, levelIndex: 2, elapsedMs: 9 * 60_000, anchorAt: now },
    theme: 'classic',
    tables: [],
    handForHand: false,
    money: { ...defaultMoney, lateRegUntilLevel: 6 },
    payouts: null,
    layoutId: null,
    screen: defaultScreen,
    createdAt: '',
  };
  const names = ['Anna', 'Bjarni', 'Dagur', 'Edda', 'Fannar', 'Gunnar', 'Helga', 'Ingi', 'Jón', 'Kári', 'Lilja', 'Magnús'];
  const entries: Entry[] = Array.from({ length: 48 }, (_, i) => ({
    id: i + 1,
    tournamentId: 0,
    playerId: i + 1,
    playerName: `${names[i % names.length]} ${i + 1}`,
    table: (i % 6) + 1,
    seat: Math.floor(i / 6) + 1,
    bustSeq: i < 9 ? i + 1 : null,
    rebuys: 0,
    addOn: false,
    paidOut: 0,
    createdAt: '',
  }));
  return { t, entries };
}

const clone = (c: LayoutConfig): LayoutConfig => JSON.parse(JSON.stringify(c));
const configOf = (l: ScreenLayout): LayoutConfig => {
  const { id: _id, name: _name, updatedAt: _u, ...config } = l;
  return clone(config);
};

/** Director page: build and save big-screen layouts, with a live preview. */
export function Layouts() {
  const [layouts, setLayouts] = useState<ScreenLayout[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [editing, setEditing] = useState<{ id: number | null; name: string; config: LayoutConfig }>({
    id: null,
    name: 'My layout',
    config: clone(defaultLayout),
  });
  const [saved, setSaved] = useState(JSON.stringify(editing));
  const [previewId, setPreviewId] = useState(0);
  const [preview, setPreview] = useState<Preview>('live');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadLayouts = () => api.layouts().then(setLayouts);
  useEffect(() => {
    loadLayouts();
    api.assets().then(setAssets);
    api.tournaments().then((list) => {
      setTournaments(list);
      setPreviewId(list[0]?.id ?? 0);
    });
  }, []);

  const dirty = JSON.stringify(editing) !== saved;
  const open = (next: typeof editing) => {
    if (dirty && !confirm('Discard your unsaved changes to this layout?')) return;
    setEditing(next);
    setSaved(JSON.stringify(next));
    setError('');
    setMessage('');
  };

  const config = editing.config;
  const update = (fn: (c: LayoutConfig) => void) => {
    const next = clone(config);
    fn(next);
    setEditing({ ...editing, config: next });
  };

  const save = async () => {
    setError('');
    setMessage('');
    try {
      const l = editing.id
        ? await api.saveLayout(editing.id, editing.name, config)
        : await api.createLayout(editing.name, config);
      const next = { id: l.id, name: l.name, config: configOf(l) };
      setEditing(next);
      setSaved(JSON.stringify(next));
      setMessage('Saved. Screens using this layout update straight away.');
      loadLayouts();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!editing.id || !confirm(`Delete the layout "${editing.name}"? Tournaments using it go back to the built-in layout.`)) return;
    await api.deleteLayout(editing.id);
    const next = { id: null, name: 'My layout', config: clone(defaultLayout) };
    setEditing(next);
    setSaved(JSON.stringify(next));
    loadLayouts();
  };

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return null;
    try {
      const a = await api.uploadAsset(file);
      setAssets((list) => [a, ...list]);
      return a.id;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  return (
    <main className="page wide">
      <header className="page-head">
        <h1>Screen layouts</h1>
        <nav>
          <a href="/">All tournaments</a>
        </nav>
      </header>

      <section className="card">
        <div className="form-actions layout-picker">
          <label className="inline">
            Layout
            <select
              value={editing.id ?? ''}
              onChange={(e) => {
                const l = layouts.find((x) => x.id === Number(e.target.value));
                if (l) open({ id: l.id, name: l.name, config: configOf(l) });
              }}
            >
              {!editing.id && <option value="">(new, not saved yet)</option>}
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => open({ id: null, name: 'My layout', config: clone(defaultLayout) })}>New from built-in</button>
          {editing.id && (
            <button onClick={() => open({ id: null, name: `${editing.name} (copy)`, config: clone(config) })}>Duplicate</button>
          )}
        </div>
        <div className="form-actions">
          <label className="inline">
            Name
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <button className="primary" onClick={save} disabled={!dirty && !!editing.id}>
            Save layout
          </button>
          {editing.id && (
            <button className="danger-link link" onClick={remove}>
              Delete
            </button>
          )}
          {dirty && <span className="muted">Unsaved changes</span>}
          {message && !dirty && <span className="paid">{message}</span>}
        </div>
        {error && <p className="error">{error[0].toUpperCase() + error.slice(1)}.</p>}
      </section>

      <div className="layout-editor">
        <section className="card layout-preview-card">
          <div className="card-head">
            <h2>Preview</h2>
            <span className="row-actions">
              <select value={previewId} onChange={(e) => setPreviewId(Number(e.target.value))} aria-label="Preview with">
                <option value={0}>Demo tournament</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select value={preview} onChange={(e) => setPreview(e.target.value as Preview)} aria-label="Preview state">
                <option value="live">As it is now</option>
                <option value="open">While registration is open</option>
                <option value="final">After registration closes</option>
              </select>
            </span>
          </div>
          <PreviewScreen tournamentId={previewId} config={config} state={preview} />
        </section>

        <section className="card">
          <h2>Look</h2>
          <div className="grid-form">
            <label>
              Theme
              <select value={config.theme} onChange={(e) => update((c) => void (c.theme = e.target.value))}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Font
              <select value={config.font ?? ''} onChange={(e) => update((c) => void (c.font = e.target.value || undefined))}>
                {fonts.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <ImagePicker
              label="Background image"
              value={config.backgroundAssetId ?? undefined}
              assets={assets}
              onUpload={upload}
              onChange={(id) => update((c) => void (c.backgroundAssetId = id ?? null))}
            />
          </div>
          <div className="color-row">
            {(Object.keys(colorNames) as ColorKey[]).map((k) => (
              <label key={k} className="color-field">
                {colorNames[k]}
                <span className="row-actions">
                  <input
                    type="color"
                    value={config.colors[k] ?? '#808080'}
                    className={config.colors[k] ? '' : 'unset'}
                    onChange={(e) => update((c) => void (c.colors[k] = e.target.value))}
                  />
                  {config.colors[k] ? (
                    <button className="link" onClick={() => update((c) => void delete c.colors[k])}>
                      Use theme
                    </button>
                  ) : (
                    <span className="small">Theme</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>What goes where</h2>
          <p className="muted small">
            The centre holds the clock. Side columns only take up room when something in them is showing, so a payout
            table set to appear after registration closes stays out of the way until then.
          </p>
          <div className="zone-grid">
            {zones.map((z) => (
              <ZoneEditor
                key={z}
                zone={z}
                widgets={config.zones[z]}
                assets={assets}
                onUpload={upload}
                onChange={(list) => update((c) => void (c.zones[z] = list))}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function PreviewScreen({ tournamentId, config, state }: { tournamentId: number; config: LayoutConfig; state: Preview }) {
  const live = useLiveTournament(tournamentId);
  const demo = useMemo(demoTournament, []);
  const now = useServerNow(live.offset);
  const base = tournamentId && live.tournament ? live.tournament : demo.t;
  const entries = tournamentId && live.tournament ? live.entries : demo.entries;
  // Pretend the limits have passed (or not) so conditional widgets can be checked.
  const t: Tournament =
    state === 'open'
      ? { ...base, status: 'setup', money: { ...base.money, lateRegUntilLevel: 0 } }
      : state === 'final'
        ? { ...base, status: 'running', money: { ...base.money, lateRegUntilLevel: 0, rebuyUntilLevel: 0 } }
        : base;
  const view = useClockView(t, live.offset) ?? clockAt(t.levels, t.clock, now);
  return (
    <div className="layout-preview">
      <ScreenView t={t} entries={entries} view={view} layout={config} moves={live.moves} now={now} scene="clock" />
    </div>
  );
}

function ImagePicker({
  label,
  value,
  assets,
  onChange,
  onUpload,
}: {
  label: string;
  value: number | undefined;
  assets: Asset[];
  onChange: (id: number | undefined) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<number | null>;
}) {
  return (
    <label>
      {label}
      <span className="row-actions">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">None</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="upload">
          Upload...
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={async (e) => {
              const id = await onUpload(e);
              if (id) onChange(id);
            }}
          />
        </span>
      </span>
    </label>
  );
}

function ZoneEditor({
  zone,
  widgets,
  assets,
  onChange,
  onUpload,
}: {
  zone: Zone;
  widgets: Widget[];
  assets: Asset[];
  onChange: (list: Widget[]) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<number | null>;
}) {
  const set = (i: number, w: Widget) => onChange(widgets.map((x, j) => (j === i ? w : x)));
  const move = (i: number, by: number) => {
    const list = [...widgets];
    const [w] = list.splice(i, 1);
    list.splice(i + by, 0, w);
    onChange(list);
  };
  const add = (type: WidgetType) => {
    const w: Widget = { type };
    if (type === 'payouts') w.show = 'moneyFinal';
    if (type === 'lateReg') w.show = 'moneyOpen';
    if (type === 'bustouts') w.count = 5;
    if (type === 'message') w.text = '';
    onChange([...widgets, w]);
  };
  return (
    <div className={`zone-card zone-card-${zone}`}>
      <h3>{zoneNames[zone]}</h3>
      {widgets.length === 0 && <p className="muted small">Empty</p>}
      {widgets.map((w, i) => (
        <div key={i} className="widget-row">
          <div className="widget-line">
            <strong>{widgetNames[w.type]}</strong>
            <span className="row-actions">
              <button className="icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon" title="Move down" disabled={i === widgets.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="icon" title="Remove" onClick={() => onChange(widgets.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          </div>
          <select
            value={w.show ?? 'always'}
            aria-label={`When to show ${widgetNames[w.type]}`}
            onChange={(e) => set(i, { ...w, show: e.target.value as ShowWhen })}
          >
            {(Object.keys(showWhenNames) as ShowWhen[]).map((s) => (
              <option key={s} value={s}>
                {showWhenNames[s]}
              </option>
            ))}
          </select>
          {w.type === 'message' && (
            <textarea
              rows={2}
              placeholder="Text to show"
              value={w.text ?? ''}
              onChange={(e) => set(i, { ...w, text: e.target.value })}
            />
          )}
          {w.type === 'bustouts' && (
            <label className="inline">
              Rows
              <input
                type="number"
                min={1}
                max={30}
                value={w.count ?? 5}
                onChange={(e) => set(i, { ...w, count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
              />
            </label>
          )}
          {w.type === 'sponsor' && (
            <ImagePicker
              label="Logo"
              value={w.assetId}
              assets={assets}
              onUpload={onUpload}
              onChange={(id) => set(i, { ...w, assetId: id })}
            />
          )}
        </div>
      ))}
      <select value="" aria-label={`Add to ${zoneNames[zone]}`} onChange={(e) => e.target.value && add(e.target.value as WidgetType)}>
        <option value="">+ Add...</option>
        {widgetTypes.map((t) => (
          <option key={t} value={t}>
            {widgetNames[t]}
          </option>
        ))}
      </select>
    </div>
  );
}
