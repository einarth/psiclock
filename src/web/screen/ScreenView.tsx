import { cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { formatClock, minutesToMs, msUntilEndOfLevel, msUntilNextBreak, type ClockView } from '../../shared/clock';
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

interface Panel {
  label?: string;
  body: ReactNode;
  /** Share of a side column's height. */
  grow?: number;
}

/**
 * The clock screen, built from framed panels. The centre panel holds the
 * clock. Side columns are always the same width as each other, so the clock
 * stays in the middle of the screen even when only one side has something in
 * it. Top and bottom bars share their width equally between their panels.
 */
/** Widgets that list rows. A bottom bar holding one is made tall enough to read it. */
const listTypes = new Set<string>(['payouts', 'bustouts', 'structure']);

function ClockScene({ d }: { d: Data }) {
  const panels = Object.fromEntries(
    zones.map((z) => [
      z,
      d.layout.zones[z]
        .filter((w) => visible(w, d))
        .map((w) => ({ w, p: panelFor(w, d) }))
        .filter((x): x is { w: Widget; p: Panel } => x.p !== null),
    ]),
  ) as Record<Zone, { w: Widget; p: Panel }[]>;
  const center = d.layout.zones.center.filter((w) => visible(w, d));
  const sides = panels.left.length > 0 || panels.right.length > 0;
  const style = {
    '--side': sides ? '23cqw' : '0px',
    '--col-gap': sides ? '1.4cqw' : '0px',
    '--top': panels.top.length ? '10cqh' : '0px',
    '--bottom': !panels.bottom.length ? '0px' : panels.bottom.some(({ w }) => listTypes.has(w.type)) ? '36cqh' : '13cqh',
    '--row-gap-top': panels.top.length ? '1.6cqh' : '0px',
    '--row-gap-bottom': panels.bottom.length ? '1.6cqh' : '0px',
  } as CSSProperties;
  const bar = (z: 'top' | 'bottom') => (
    <div className={`zone zone-${z}`} style={{ '--n': Math.max(1, panels[z].length) } as CSSProperties}>
      {panels[z].map(({ w, p }, i) => (
        <PanelView key={i} type={w.type} p={p} />
      ))}
    </div>
  );
  const column = (z: 'left' | 'right') => (
    <div className={`zone zone-${z}`}>
      {panels[z].map(({ w, p }, i) => (
        <PanelView key={i} type={w.type} p={p} />
      ))}
    </div>
  );
  return (
    <div className="zones" style={style}>
      {bar('top')}
      {column('left')}
      <div className="zone zone-center">
        <MainPanel widgets={center} d={d} />
      </div>
      {column('right')}
      {bar('bottom')}
    </div>
  );
}

function PanelView({ type, p }: { type: string; p: Panel }) {
  return (
    <div className={`panel panel-${type}`} style={{ flexGrow: p.grow ?? 1 }}>
      {p.label && <div className="panel-label">{p.label}</div>}
      <div className="panel-body">{p.body}</div>
    </div>
  );
}

/** The big centre panel: level band on top, then the clock, blinds and next level. */
function MainPanel({ widgets, d }: { widgets: Widget[]; d: Data }) {
  const { t, view } = d;
  const has = (type: Widget['type']) => widgets.some((w) => w.type === type);
  const others = widgets.filter((w) => !['level', 'clock', 'blinds', 'next'].includes(w.type));
  const low = view.running && view.remainingMs < 60_000;
  const breakNote = view.level?.kind === 'break' ? view.level.note : '';
  if (!widgets.length && !t.handForHand) return null;
  return (
    <div className="panel panel-main">
      {(has('level') || t.handForHand) && (
        <div className={`main-band${t.handForHand ? ' hfh' : ''}`}>
          {has('level') && <span>{d.isBreak ? 'Break' : `Level ${view.levelNumber}`}</span>}
          {t.handForHand && <span className="main-hfh">Hand for hand</span>}
        </div>
      )}
      <div className="main-body">
        {has('clock') && (
          <div className="main-clock-box">
            <div className={`main-clock${low ? ' low' : ''}${view.running ? '' : ' paused'}`}>{formatClock(view.remainingMs)}</div>
            {!view.running && !view.finished && <div className="main-paused">{t.status === 'setup' ? 'Starting soon' : 'Paused'}</div>}
            {view.level && (
              <div className="main-progress">
                <div style={{ width: `${Math.min(100, Math.max(0, 100 - (100 * view.remainingMs) / minutesToMs(view.level.minutes)))}%` }} />
              </div>
            )}
          </div>
        )}
        {has('blinds') &&
          (d.isBreak ? (
            breakNote && <div className="main-note">{breakNote}</div>
          ) : (
            <div className="main-blinds">
              <div>
                <span>Blinds</span>
                {view.level?.kind === 'level' ? `${num(view.level.smallBlind)} / ${num(view.level.bigBlind)}` : ''}
              </div>
              {view.level?.kind === 'level' && view.level.ante > 0 && (
                <div>
                  <span>Ante</span>
                  {num(view.level.ante)}
                </div>
              )}
            </div>
          ))}
        {others.map((w, i) => {
          const p = panelFor(w, d);
          return p && <div key={i} className="main-extra">{p.label && <span>{p.label}</span>}{p.body}</div>;
        })}
      </div>
      {has('next') && (
        <div className="main-next">
          <span>Next</span> {view.nextLevel ? blindsText(view.nextLevel) : 'Final level'}
        </div>
      )}
    </div>
  );
}

/** What a widget shows when it sits in a frame of its own; null hides it. */
function panelFor(w: Widget, d: Data): Panel | null {
  const { t, view } = d;
  const value = (v: ReactNode) => <div className="panel-value">{v}</div>;
  switch (w.type) {
    case 'title':
      return { body: <div className="panel-title">{t.name}</div> };
    case 'level':
      return { label: 'Level', body: value(d.isBreak ? 'Break' : view.levelNumber) };
    case 'clock':
      return { label: d.isBreak ? 'Break ends in' : 'Level ends in', body: value(formatClock(view.remainingMs)) };
    case 'blinds':
      return { label: 'Blinds', body: value(d.isBreak ? 'Break' : blindsText(view.level)) };
    case 'next':
      return { label: 'Next level', body: value(view.nextLevel ? blindsText(view.nextLevel) : 'Final level') };
    case 'players':
      return { label: 'Players', body: value(`${d.remaining} / ${d.entries.length}`) };
    case 'avgStack':
      return { label: 'Average stack', body: value(num(averageStack(t, d.entries))) };
    case 'chips':
      return { label: 'Chips in play', body: value(num(d.summary.totalChips)) };
    case 'prizePool':
      return { label: 'Prize pool', body: value(num(d.summary.prizePool)) };
    case 'placesPaid':
      return { label: 'Places paid', body: value(d.summary.prizePool > 0 ? d.prizes.length : '-') };
    case 'buyIn':
      return { label: 'Buy-in', body: value(`${num(t.buyIn)}${t.fee ? ` + ${num(t.fee)}` : ''}`) };
    case 'nextBreak': {
      const ms = msUntilNextBreak(t.levels, view);
      return ms === null ? null : { label: 'Next break', body: value(formatClock(ms)) };
    }
    case 'lateReg': {
      const until = t.money.lateRegUntilLevel;
      if (!until) return t.status === 'setup' ? { label: 'Registration', body: value('Open') } : null;
      const ms = msUntilEndOfLevel(t.levels, view, until);
      return ms === null
        ? { label: 'Registration', body: value('Closed') }
        : { label: 'Late reg closes in', body: value(formatClock(ms)) };
    }
    case 'payouts': {
      if (!d.prizes.length || d.summary.prizePool === 0) return null;
      const rows = Math.min(w.count ?? 10, d.prizes.length);
      return { label: 'Payouts', body: <PayoutList d={d} max={w.count ?? 10} />, grow: 1 + rows / 4 };
    }
    case 'structure':
      return { label: 'Blind structure', body: <Structure d={d} count={w.count ?? 8} />, grow: 1 + (w.count ?? 8) / 4 };
    case 'bustouts': {
      const list = <Bustouts d={d} count={w.count ?? 5} />;
      return d.entries.some((e) => e.bustSeq !== null) ? { label: 'Recent bustouts', body: list, grow: 1 + (w.count ?? 5) / 4 } : null;
    }
    case 'sponsor':
      return w.assetId ? { body: <img className="panel-sponsor" src={`/api/assets/${w.assetId}`} alt="Sponsor" />, grow: 2 } : null;
    case 'message':
      return w.text ? { body: <div className="panel-message">{w.text}</div>, grow: 1.5 } : null;
  }
}

function PayoutList({ d, max }: { d: Data; max: number }) {
  const rows = d.prizes.slice(0, max);
  const lines = rows.length + (d.prizes.length > max ? 1 : 0);
  return (
    <div className="w-list" style={{ '--rows': lines } as CSSProperties}>
      {rows.map((p, i) => (
        <div key={i} className={`w-row${d.placed.has(i + 1) ? ' done' : ''}`}>
          <span className="num">{ordinal(i + 1)}</span>
          <span className="acc">{num(p)}</span>
          <span className="end muted">{d.summary.prizePool ? `${Math.round((1000 * p) / d.summary.prizePool) / 10}%` : ''}</span>
        </div>
      ))}
      {d.prizes.length > max && (
        <div className="w-row muted">
          <span className="num">{ordinal(max + 1)}+</span>
          <span>
            {num(d.prizes[max])} to {num(d.prizes.at(-1)!)}
          </span>
          <span className="end">to {ordinal(d.prizes.length)}</span>
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
  return (
    <div className="w-list" style={{ '--rows': Math.max(out.length, Math.min(count, 5)) } as CSSProperties}>
      {out.map((e) => {
        const place = finishingPlace(d.entries, e)!;
        const prize = d.prizes[place - 1];
        return (
          <div key={e.id} className="w-row">
            <span className="num">{ordinal(place)}</span>
            <span className="w-name">{e.playerName}</span>
            <span className="end acc">{prize ? num(prize) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The coming levels, starting with the one being played. */
function Structure({ d, count }: { d: Data; count: number }) {
  const { t, view } = d;
  const numbers = t.levels.map((_, i) => t.levels.slice(0, i + 1).filter((l) => l.kind === 'level').length);
  const rows = t.levels.map((l, i) => ({ l, i })).slice(view.levelIndex, view.levelIndex + count);
  return (
    <div className="w-list" style={{ '--rows': Math.max(rows.length, Math.min(count, 5)) } as CSSProperties}>
      {rows.map(({ l, i }) => (
        <div key={i} className={`w-row${i === view.levelIndex ? ' current' : ''}`}>
          <span className="num">{l.kind === 'level' ? numbers[i] : ''}</span>
          <span>{l.kind === 'level' ? blindsText(l) : 'Break'}</span>
          <span className="end acc">{l.minutes}'</span>
        </div>
      ))}
    </div>
  );
}

/** Seating, moves, payouts and message scenes all keep a small clock in the corner. */
function OtherScene({ d }: { d: Data }) {
  const { view } = d;
  return (
    <div className="scene">
      <header className="panel scene-head">
        <span className="scene-title">{d.t.name}</span>
        <span className="scene-clock">
          {d.isBreak ? 'Break' : `Level ${view.levelNumber}`} · {formatClock(view.remainingMs)}
          {!view.running && !view.finished && ' (paused)'}
        </span>
      </header>
      <div className="panel scene-panel">
        {d.scene === 'seating' && <Seating d={d} />}
        {d.scene === 'moves' && <Moves d={d} />}
        {d.scene === 'payouts' && <PayoutBoard d={d} />}
        {d.scene === 'message' && <div className="scene-message">{d.message || d.t.screen.message || ''}</div>}
      </div>
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
        {shown.map((item, i) =>
          isValidElement(item) && i % rows % 2 === 0
            ? cloneElement(item as ReactElement<{ className?: string }>, {
                className: `${(item as ReactElement<{ className?: string }>).props.className ?? ''} odd`,
              })
            : item,
        )}
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
      <div className="payout-sub">
        {d.prizes.length} paid of {d.summary.entries} entries, {d.remaining} still in
      </div>
      <div className="payout-grid" style={{ '--rows': rows, fontSize: `${size}cqh` } as CSSProperties}>
        {d.prizes.map((p, i) => {
          const who = d.placed.get(i + 1);
          return (
            <div key={i} className={`${who ? 'done' : ''}${(i % rows) % 2 === 0 ? ' odd' : ''}`}>
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
