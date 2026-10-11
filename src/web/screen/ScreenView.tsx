import type { CSSProperties, ReactNode } from 'react';
import { formatClock, msUntilEndOfLevel, msUntilNextBreak, type ClockView } from '../../shared/clock';
import { averageStack, moneyFinal, moneySummary, payoutsFor } from '../../shared/money';
import { finishingPlace, isAlive } from '../../shared/seating';
import { zones, type LayoutConfig, type Widget, type Zone } from '../../shared/layout';
import type { Entry, Move, Scene, Tournament } from '../../shared/types';
import { blindsText, num, ordinal } from '../format';

export interface ScreenProps {
  t: Tournament;
  entries: Entry[];
  view: ClockView;
  layout: LayoutConfig;
  moves: Move[];
  /** Server time, for countdowns and paging. */
  now: number;
  scene: Scene;
  message?: string;
}

/** Everything the widgets need, worked out once per render. */
function derive(p: ScreenProps) {
  const summary = moneySummary(p.t, p.entries);
  const prizes = payoutsFor(p.t, p.entries).filter((x) => x > 0);
  const placed = new Map<number, Entry>();
  for (const e of p.entries) {
    const place = finishingPlace(p.entries, e);
    if (place) placed.set(place, e);
  }
  return {
    ...p,
    summary,
    prizes,
    placed,
    remaining: p.entries.filter(isAlive).length,
    isBreak: p.view.level?.kind === 'break',
    final: moneyFinal(p.t, p.view.levelNumber),
  };
}
type Data = ReturnType<typeof derive>;

/** The scene that should be on screen now: a timed scene goes back to the clock when its time is up. */
export function currentScene(t: Tournament, now: number, pinned?: string | null): Scene {
  if (pinned && ['clock', 'seating', 'moves', 'payouts', 'message'].includes(pinned)) return pinned as Scene;
  const s = t.screen;
  return s.scene !== 'clock' && s.until && now > s.until ? 'clock' : s.scene;
}

/** Theme name plus the layout's own colour and font overrides, as CSS variables. */
export function themeStyle(layout: LayoutConfig): CSSProperties {
  const c = layout.colors;
  const style: Record<string, string> = {};
  if (c.bg) style['--d-bg'] = c.bg;
  if (c.text) style['--d-text'] = c.text;
  if (c.muted) style['--d-muted'] = c.muted;
  if (c.accent) style['--d-accent'] = c.accent;
  if (c.warning) style['--d-warning'] = c.warning;
  if (layout.font) style['--d-font'] = layout.font;
  return style as CSSProperties;
}

const visible = (w: Widget, d: Data) => {
  switch (w.show ?? 'always') {
    case 'moneyOpen':
      return !d.final;
    case 'moneyFinal':
      return d.final;
    case 'break':
      return d.isBreak;
    default:
      return true;
  }
};

/**
 * A big screen. It is sized by its container, not the window, so the same
 * component drives the TV and the small preview in the layout editor.
 */
export function ScreenView(props: ScreenProps) {
  const d = derive(props);
  const bg = props.layout.backgroundAssetId;
  return (
    <div className="screen" data-theme={props.layout.theme} style={themeStyle(props.layout)}>
      {bg && <img className="screen-bg" src={`/api/assets/${bg}`} alt="" />}
      {props.scene === 'clock' ? <ClockScene d={d} /> : <OtherScene d={d} />}
    </div>
  );
}

function ClockScene({ d }: { d: Data }) {
  const shown = Object.fromEntries(zones.map((z) => [z, d.layout.zones[z].filter((w) => visible(w, d))])) as Record<
    Zone,
    Widget[]
  >;
  const style = {
    '--left': shown.left.length ? '24cqw' : '0px',
    '--right': shown.right.length ? '24cqw' : '0px',
  } as CSSProperties;
  return (
    <div className="zones" style={style}>
      {zones.map((z) => (
        <div key={z} className={`zone zone-${z}`}>
          {z === 'center' && d.t.handForHand && <div className="w-hfh">Hand for hand</div>}
          {shown[z].map((w, i) => (
            <WidgetView key={i} w={w} d={d} />
          ))}
        </div>
      ))}
    </div>
  );
}

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="w-stat">
    <span>{label}</span>
    {children}
  </div>
);

function WidgetView({ w, d }: { w: Widget; d: Data }) {
  const { t, view } = d;
  switch (w.type) {
    case 'title':
      return <div className="w-title">{t.name}</div>;
    case 'level':
      return <div className="w-level">{d.isBreak ? 'Break' : `Level ${view.levelNumber}`}</div>;
    case 'clock': {
      const low = view.running && view.remainingMs < 60_000;
      return (
        <div className="w-clock-box">
          <div className={`w-clock${low ? ' low' : ''}${view.running ? '' : ' paused'}`}>{formatClock(view.remainingMs)}</div>
          {!view.running && !view.finished && <div className="w-paused">{t.status === 'setup' ? 'Starting soon' : 'Paused'}</div>}
        </div>
      );
    }
    case 'blinds':
      return (
        <div className="w-blinds">
          {d.isBreak ? (view.level?.kind === 'break' && view.level.note) || '' : blindsText(view.level)}
        </div>
      );
    case 'next':
      return <div className="w-next">Next: {view.nextLevel ? blindsText(view.nextLevel) : 'final level'}</div>;
    case 'players':
      return (
        <Stat label="Players">
          {d.remaining} / {d.entries.length}
        </Stat>
      );
    case 'avgStack':
      return <Stat label="Average stack">{num(averageStack(t, d.entries))}</Stat>;
    case 'chips':
      return <Stat label="Chips in play">{num(d.summary.totalChips)}</Stat>;
    case 'prizePool':
      return <Stat label="Prize pool">{num(d.summary.prizePool)}</Stat>;
    case 'placesPaid':
      return <Stat label="Places paid">{d.summary.prizePool > 0 ? d.prizes.length : '-'}</Stat>;
    case 'buyIn':
      return (
        <Stat label="Buy-in">
          {num(t.buyIn)}
          {t.fee ? ` + ${num(t.fee)}` : ''}
        </Stat>
      );
    case 'nextBreak': {
      const ms = msUntilNextBreak(t.levels, view);
      return ms === null ? null : <Stat label="Next break">{formatClock(ms)}</Stat>;
    }
    case 'lateReg': {
      const until = t.money.lateRegUntilLevel;
      const ms = until ? msUntilEndOfLevel(t.levels, view, until) : null;
      if (!until) return t.status === 'setup' ? <Stat label="Registration">Open</Stat> : null;
      return ms === null ? <Stat label="Registration">Closed</Stat> : <Stat label="Late reg closes in">{formatClock(ms)}</Stat>;
    }
    case 'payouts':
      return <PayoutList d={d} />;
    case 'bustouts':
      return <Bustouts d={d} count={w.count ?? 5} />;
    case 'sponsor':
      return w.assetId ? <img className="w-sponsor" src={`/api/assets/${w.assetId}`} alt="Sponsor" /> : null;
    case 'message':
      return w.text ? <div className="w-message">{w.text}</div> : null;
  }
}

function PayoutList({ d }: { d: Data }) {
  if (!d.prizes.length || d.summary.prizePool === 0) return null;
  const max = 18;
  const rows = d.prizes.slice(0, max);
  const size = Math.max(1.8, Math.min(3.4, 64 / rows.length));
  return (
    <div className="w-payouts" style={{ fontSize: `${size}cqh` }}>
      <div className="w-heading">Payouts</div>
      {rows.map((p, i) => (
        <div key={i} className={`w-row${d.placed.has(i + 1) ? ' done' : ''}`}>
          <span className="muted">{ordinal(i + 1)}</span>
          <span>{num(p)}</span>
        </div>
      ))}
      {d.prizes.length > max && (
        <div className="w-row muted">
          {ordinal(max + 1)} to {ordinal(d.prizes.length)}: {num(d.prizes[max])} down to {num(d.prizes.at(-1)!)}
        </div>
      )}
    </div>
  );
}

function Bustouts({ d, count }: { d: Data; count: number }) {
  const out = d.entries
    .filter((e) => e.bustSeq !== null)
    .sort((a, b) => b.bustSeq! - a.bustSeq!)
    .slice(0, count);
  if (!out.length) return null;
  return (
    <div className="w-bustouts">
      <div className="w-heading">Recent bustouts</div>
      {out.map((e) => {
        const place = finishingPlace(d.entries, e)!;
        const prize = d.prizes[place - 1];
        return (
          <div key={e.id} className="w-row">
            <span className="muted">{ordinal(place)}</span>
            <span className="w-name">{e.playerName}</span>
            {prize ? <span className="w-prize">{num(prize)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Seating, moves, payouts and message scenes all keep a small clock in the corner. */
function OtherScene({ d }: { d: Data }) {
  const { view } = d;
  return (
    <div className="scene">
      <header className="scene-head">
        <span className="scene-title">{d.t.name}</span>
        <span className="scene-clock">
          {d.isBreak ? 'Break' : `Level ${view.levelNumber}`} · {formatClock(view.remainingMs)}
          {!view.running && !view.finished && ' (paused)'}
        </span>
      </header>
      {d.scene === 'seating' && <Seating d={d} />}
      {d.scene === 'moves' && <Moves d={d} />}
      {d.scene === 'payouts' && <PayoutBoard d={d} />}
      {d.scene === 'message' && <div className="scene-message">{d.message || d.t.screen.message || ''}</div>}
    </div>
  );
}

/** Columns that fill the screen; when there are too many rows, pages turn every 10 seconds. */
function Paged({ title, items, now }: { title: string; items: ReactNode[]; now: number }) {
  // Short lists get fewer, wider columns; long ones fill four columns and turn pages.
  const cols = Math.min(4, Math.max(1, Math.ceil(items.length / 12)));
  const perCol = 25;
  const perPage = cols * perCol;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const page = Math.floor(now / 10_000) % pages;
  const shown = items.slice(page * perPage, (page + 1) * perPage);
  const rows = Math.max(8, Math.ceil(shown.length / cols));
  return (
    <>
      <div className="scene-heading">
        {title}
        {pages > 1 && <span className="muted"> · page {page + 1} of {pages}</span>}
      </div>
      <div
        className="scene-columns"
        style={{ '--rows': rows, '--cols': cols, maxWidth: `${cols * 25}cqw`, fontSize: `${Math.min(4.5, 72 / rows)}cqh` } as CSSProperties}
      >
        {shown}
      </div>
    </>
  );
}

function Seating({ d }: { d: Data }) {
  const seated = d.entries.filter(isAlive).sort((a, b) => a.playerName.localeCompare(b.playerName, 'is'));
  if (!seated.length) return <div className="scene-message">Nobody is seated yet</div>;
  const items = seated.map((e) => (
    <div key={e.id} className="scene-row">
      <span className="w-name">{e.playerName}</span>
      <span className="scene-seat">
        {e.table}-{e.seat}
      </span>
    </div>
  ));
  return <Paged title="Seating (table-seat)" items={items} now={d.now} />;
}

function Moves({ d }: { d: Data }) {
  if (!d.moves.length) return <div className="scene-message">No player moves in the last 30 minutes</div>;
  const items = d.moves.map((m, i) => (
    <div key={i} className="scene-row">
      <span className="w-name">{m.playerName}</span>
      <span className="scene-seat">
        {m.from && m.from.table !== m.to.table ? `T${m.from.table} → ` : ''}T{m.to.table} S{m.to.seat}
      </span>
    </div>
  ));
  return <Paged title="Player moves" items={items} now={d.now} />;
}

export function PayoutBoard({ d }: { d: Data }) {
  const rows = Math.min(10, Math.max(1, d.prizes.length));
  const columns = Math.max(1, Math.ceil(d.prizes.length / rows));
  // Fit the rows to the space under the prize pool, and the columns (about 18 characters each) to the width.
  const size = Math.min(5.5, 56 / (rows * 1.35), (92 - 5 * (columns - 1)) / (5.6 * columns));
  return (
    <div className="payout-board">
      <div className="payout-pool">{num(d.summary.prizePool)}</div>
      <div className="w-next">
        {d.prizes.length} paid of {d.summary.entries} entries, {d.remaining} still in
      </div>
      <div className="payout-grid" style={{ '--rows': rows, fontSize: `${size}cqh` } as CSSProperties}>
        {d.prizes.map((p, i) => {
          const who = d.placed.get(i + 1);
          return (
            <div key={i} className={who ? 'done' : ''}>
              <span className="muted">{ordinal(i + 1)}</span>
              {who && <span className="who">{who.playerName}</span>}
              <span>{num(p)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
