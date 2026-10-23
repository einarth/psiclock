import { useMemo, useState } from 'react';
import { api } from '../api';
import { useClockView, useLiveTournament } from '../live';
import { formatClock } from '../../shared/clock';
import {
  balanceMoves,
  breakTableMoves,
  fieldStats,
  finishingPlace,
  freeSeats,
  isAlive,
  nextBalanceMove,
  openTables,
  playersAt,
  tableToBreak,
  type Seat,
} from '../../shared/seating';
import type { Entry, TableConfig } from '../../shared/types';
import { blindsText, num, ordinal, short } from '../format';
import { averageStack, payoutsFor } from '../../shared/money';

type PlanMove = { entry: Entry; from: number; to: Seat };

type Sheet =
  | { kind: 'player'; entry: Entry }
  | { kind: 'move'; entry: Entry; suggested?: number }
  | { kind: 'table'; table: TableConfig }
  | { kind: 'break'; table: number; moves: PlanMove[] }
  | { kind: 'balance'; moves: PlanMove[] }
  | { kind: 'confirm'; text: string; action: () => Promise<unknown>; danger?: boolean }
  | { kind: 'handForHand' };

/** The floor manager's phone or tablet view: bust players, move them, balance and break tables. */
export function Floor({ id }: { id: number }) {
  const { tournament: t, entries, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<unknown> } | null>(null);
  const [error, setError] = useState('');

  const busted = useMemo(
    () => entries.filter((e) => !isAlive(e)).sort((a, b) => b.bustSeq! - a.bustSeq!),
    [entries],
  );

  if (!t || !view) return <main className="page">{connected ? 'Tournament not found.' : 'Connecting...'}</main>;

  const stats = fieldStats(entries, t.startingStack);
  const prizes = payoutsFor(t, entries);
  const balance = nextBalanceMove(t.tables, entries);
  const breakable = tableToBreak(t.tables, entries);
  const open = openTables(t.tables);
  const q = search.trim().toLowerCase();
  const matches = (e: Entry) => q !== '' && e.playerName.toLowerCase().includes(q);
  const shownTables = q ? open.filter((tb) => playersAt(entries, tb.number).some(matches)) : open;

  const act = async (fn: () => Promise<unknown>, text?: string, undo?: () => Promise<unknown>) => {
    setError('');
    setSheet(null);
    try {
      await fn();
      if (text) setToast({ text, undo });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Suggests a new seat for each player at the table; the floor can change the seats before confirming. */
  const openBreak = (no: number) => {
    const players = playersAt(entries, no);
    if (!players.length) {
      setSheet({ kind: 'confirm', text: `Close table ${no}? Nobody is sitting there.`, action: () => act(() => api.breakTable(id, no), `Table ${no} closed`) });
      return;
    }
    const plan = breakTableMoves(t.tables, entries, no, Math.random);
    if (!plan) {
      setError(`Not enough free seats to break table ${no}`);
      return;
    }
    setSheet({ kind: 'break', table: no, moves: plan.map((m) => ({ entry: players.find((p) => p.id === m.entryId)!, from: no, to: m.to })) });
  };

  /** Suggests who moves where to balance the tables; the floor can change the players and seats before confirming. */
  const openBalance = () => {
    const plan = balanceMoves(t.tables, entries, Math.random);
    if (!plan.length) {
      setError('No free seats to balance the tables');
      return;
    }
    setSheet({ kind: 'balance', moves: plan.map((m) => ({ entry: entries.find((e) => e.id === m.entryId)!, from: m.from, to: m.to })) });
  };

  const bust = (e: Entry) => {
    // Busting now places them just behind everyone else still in.
    const place = entries.filter(isAlive).length;
    const prize = payoutsFor(t, entries)[place - 1] ?? 0;
    const money = prize > 0 ? ` and win ${num(prize)}` : '';
    const winner = place === 2 ? entries.find((x) => isAlive(x) && x.id !== e.id) : undefined;
    setSheet({
      kind: 'confirm',
      text: `Bust ${e.playerName} (table ${e.table}, seat ${e.seat})? They finish ${ordinal(place)}${money}.${winner ? ` ${winner.playerName} wins the tournament and the clock stops.` : ''}`,
      danger: true,
      action: () =>
        act(
          () => api.bust(id, e.id),
          `${e.playerName} out in ${ordinal(place)}${prize > 0 ? `, send to the desk for ${num(prize)}` : ''}`,
          () => api.restore(id, e.id),
        ),
    });
  };

  const tapPlayer = (e: Entry) => setSheet({ kind: 'player', entry: e });

  return (
    <main className="floor">
      <header className="floor-head">
        <div className="floor-title">
          <strong>{t.name}</strong>
          <span className="floor-clock">
            {view.level?.kind === 'break' ? 'Break' : `L${view.levelNumber}`} {formatClock(view.remainingMs)}
            {!view.running && ' (paused)'}
          </span>
        </div>
        <div className="floor-stats">
          <span>
            <b>{stats.remaining}</b> / {stats.entries} left
          </span>
          <span>avg {short(averageStack(t, entries))}</span>
          <span>{blindsText(view.level)}</span>
        </div>
        {!connected && <div className="floor-alert danger">Lost connection, reconnecting...</div>}
        {t.status === 'running' && !view.finished && (
          <div className="floor-controls">
            <button
              className={view.running ? '' : 'primary'}
              onClick={() =>
                act(() => api.floorClock(id, !view.running), view.running ? 'Clock paused' : 'Clock resumed')
              }
            >
              {view.running ? 'Pause clock' : 'Resume clock'}
            </button>
            {!t.handForHand && (
              <button className="floor-hfh-start" onClick={() => setSheet({ kind: 'handForHand' })}>
                Play hand for hand
              </button>
            )}
          </div>
        )}
        {t.handForHand && (
          <div className="floor-alert hfh">
            <span>Playing hand for hand</span>
            <button
              onClick={() =>
                act(
                  () => api.handForHand(id, false),
                  view.running || t.status !== 'running' ? 'Hand-for-hand play stopped' : 'Hand-for-hand play stopped, clock restarted',
                )
              }
            >
              Stop hand-for-hand play
            </button>
          </div>
        )}
        {t.status !== 'running' && !t.handForHand && (
          <button className="floor-hfh-start" onClick={() => setSheet({ kind: 'handForHand' })}>
            Play hand for hand
          </button>
        )}
      </header>

      {error && (
        <div className="floor-alert danger" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {balance && (
        <div className="floor-alert action">
          Table {balance.from} has {playersAt(entries, balance.from).length}, table {balance.to} has{' '}
          {playersAt(entries, balance.to).length}.
          <button onClick={openBalance}>Balance tables</button>
        </div>
      )}
      {breakable && (
        <div className="floor-alert action">
          Table {breakable} can be broken.
          <button onClick={() => openBreak(breakable)}>
            Break table {breakable}
          </button>
        </div>
      )}

      <div className="floor-tools">
        <input type="search" placeholder="Find player" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <section className="floor-tables">
        {shownTables.map((tb) => {
          const players = playersAt(entries, tb.number);
          const bySeat = new Map(players.map((p) => [p.seat, p]));
          return (
            <div key={tb.number} className="floor-table">
              <button className="floor-table-head" onClick={() => setSheet({ kind: 'table', table: tb })}>
                <span>Table {tb.number}</span>
                <span className="muted">
                  {players.length}/{tb.seats}
                </span>
              </button>
              <ol className="seats">
                {Array.from({ length: tb.seats }, (_, i) => i + 1).map((seat) => {
                  const p = bySeat.get(seat);
                  return (
                    <li key={seat} className={p ? (matches(p) ? 'match' : '') : 'empty'}>
                      <span className="seat-no">{seat}</span>
                      {p ? (
                        <button className="seat-player" onClick={() => tapPlayer(p)}>
                          {p.playerName}
                        </button>
                      ) : (
                        <span className="muted">empty</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
        {open.length === 0 && (
          <p className="muted">No tables yet. Add one from the menu below.</p>
        )}
      </section>

      <section className="card floor-busted">
        <div className="floor-row">
          <h2>Out ({busted.length})</h2>
          <button onClick={() => act(() => api.addTable(id), 'Table added')}>Add table</button>
        </div>
        <ul className="list">
          {busted.slice(0, 10).map((e) => {
            const place = finishingPlace(entries, e) ?? 0;
            return (
              <li key={e.id}>
                <span>
                  {ordinal(place)} {e.playerName}
                  {prizes[place - 1] > 0 && <span className="muted">, {num(prizes[place - 1])}</span>}
                </span>
                <button className="link" onClick={() => act(() => api.restore(id, e.id), `${e.playerName} back in`)}>
                  Undo bust
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            {sheet.kind === 'player' && (
              <>
                <h2>{sheet.entry.playerName}</h2>
                <p className="muted">
                  Table {sheet.entry.table}, seat {sheet.entry.seat}
                </p>
                <button className="danger big" onClick={() => bust(sheet.entry)}>
                  Bust
                </button>
                <button className="big" onClick={() => setSheet({ kind: 'move', entry: sheet.entry })}>
                  Move to another table
                </button>
              </>
            )}
            {sheet.kind === 'move' && (
              <>
                <h2>Move {sheet.entry.playerName}</h2>
                <ul className="list">
                  {open
                    .filter((tb) => tb.number !== sheet.entry.table)
                    .map((tb) => {
                      const free = freeSeats(tb, entries).length;
                      return (
                        <li key={tb.number}>
                          <span>
                            Table {tb.number} <span className="muted">({playersAt(entries, tb.number).length} players)</span>
                          </span>
                          <button
                            disabled={free === 0}
                            onClick={() =>
                              act(() => api.move(id, sheet.entry.id, tb.number), `${sheet.entry.playerName} moved to table ${tb.number}`)
                            }
                          >
                            {free ? 'Move here' : 'Full'}
                          </button>
                        </li>
                      );
                    })}
                </ul>
                <p className="muted small">A free seat at the table is drawn at random.</p>
              </>
            )}
            {sheet.kind === 'table' && (
              <>
                <h2>Table {sheet.table.number}</h2>
                <button
                  className="big"
                  onClick={() =>
                    setSheet({
                      kind: 'confirm',
                      text: `Draw new seats for everyone at table ${sheet.table.number}?`,
                      action: () => act(() => api.redraw(id, sheet.table.number), `New seats drawn at table ${sheet.table.number}`),
                    })
                  }
                >
                  Redraw seats
                </button>
                <button className="big" onClick={() => openBreak(sheet.table.number)}>
                  Break this table
                </button>
              </>
            )}
            {sheet.kind === 'break' && (
              <MovePlan
                title={`Break table ${sheet.table}`}
                note="The tables keep the room balanced. Change a seat if another one is closer to the big blind."
                confirmText={`Move players and close table ${sheet.table}`}
                moves={sheet.moves}
                entries={entries}
                tables={t.tables}
                onChange={(moves) => setSheet({ ...sheet, moves })}
                onConfirm={(moves) => act(() => api.breakTable(id, sheet.table, moves), `Table ${sheet.table} broken`)}
              />
            )}
            {sheet.kind === 'balance' && (
              <MovePlan
                title="Balance tables"
                note="The tables are picked to balance the room. Pick the player who is big blind next, and the seat closest to the big blind."
                confirmText={sheet.moves.length > 1 ? `Move ${sheet.moves.length} players` : 'Move player'}
                choosePlayer
                moves={sheet.moves}
                entries={entries}
                tables={t.tables}
                onChange={(moves) => setSheet({ ...sheet, moves })}
                onConfirm={(moves) => act(() => api.balanceTables(id, moves), sheet.moves.length > 1 ? 'Tables balanced' : 'Player moved')}
              />
            )}
            {sheet.kind === 'handForHand' && (
              <>
                <p className="sheet-question">Pause the clock while playing hand for hand?</p>
                {view.running ? (
                  <>
                    <button
                      className="primary big"
                      onClick={() => act(() => api.handForHand(id, true, true), 'Hand for hand started, clock paused')}
                    >
                      Yes, pause the clock
                    </button>
                    <button className="big" onClick={() => act(() => api.handForHand(id, true, false), 'Hand for hand started')}>
                      No, keep the clock running
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted">The clock is already paused. It restarts when hand-for-hand play stops.</p>
                    <button className="primary big" onClick={() => act(() => api.handForHand(id, true), 'Hand for hand started')}>
                      Start hand for hand
                    </button>
                  </>
                )}
              </>
            )}
            {sheet.kind === 'confirm' && (
              <>
                <p className="sheet-question">{sheet.text}</p>
                <button className={`${sheet.danger ? 'danger' : 'primary'} big`} onClick={() => sheet.action()}>
                  Yes
                </button>
              </>
            )}
            <button className="big" onClick={() => setSheet(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="link"
              onClick={() => {
                const undo = toast.undo!;
                setToast(null);
                act(undo);
              }}
            >
              Undo
            </button>
          )}
          <button className="link" onClick={() => setToast(null)}>
            Close
          </button>
        </div>
      )}
    </main>
  );
}

/**
 * Where each moved player goes, for breaking or balancing tables. The tables
 * are fixed by the balancing; seats, and for balancing the players, can be changed.
 */
function MovePlan({
  title,
  note,
  confirmText,
  choosePlayer = false,
  moves,
  entries,
  tables,
  onChange,
  onConfirm,
}: {
  title: string;
  note: string;
  confirmText: string;
  choosePlayer?: boolean;
  moves: PlanMove[];
  entries: Entry[];
  tables: TableConfig[];
  onChange: (moves: PlanMove[]) => void;
  onConfirm: (moves: { entryId: number; to: Seat }[]) => void;
}) {
  const holder = (to: Seat, except: number) =>
    moves.find((m) => m.entry.id !== except && m.to.table === to.table && m.to.seat === to.seat);
  const clash = moves.find((m) => holder(m.to, m.entry.id));
  const update = (entryId: number, change: Partial<PlanMove>) =>
    onChange(moves.map((m) => (m.entry.id === entryId ? { ...m, ...change } : m)));
  return (
    <>
      <h2>{title}</h2>
      <p className="muted small">{note}</p>
      <ul className="list break-plan">
        {moves.map((m) => {
          const free = freeSeats(tables.find((x) => x.number === m.to.table)!, entries);
          // Players at the same table who are not already moving.
          const candidates = playersAt(entries, m.from).filter((p) => p.id === m.entry.id || !moves.some((o) => o.entry.id === p.id));
          return (
            <li key={m.entry.id}>
              {choosePlayer && candidates.length > 1 ? (
                <span className="break-to">
                  Table {m.from},{' '}
                  <select
                    aria-label={`Player to move from table ${m.from}`}
                    value={m.entry.id}
                    onChange={(e) => update(m.entry.id, { entry: candidates.find((p) => p.id === Number(e.target.value))! })}
                  >
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.playerName} (seat {p.seat})
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                <span>
                  <strong>{m.entry.playerName}</strong>{' '}
                  <span className="muted">
                    from {choosePlayer ? `table ${m.from}, ` : ''}seat {m.entry.seat}
                  </span>
                </span>
              )}
              <span className="break-to">
                to table {m.to.table}, seat{' '}
                {free.length > 1 ? (
                  <select
                    aria-label={`Seat for ${m.entry.playerName}`}
                    value={m.to.seat}
                    onChange={(e) => update(m.entry.id, { to: { ...m.to, seat: Number(e.target.value) } })}
                  >
                    {free.map((seat) => {
                      const other = holder({ table: m.to.table, seat }, m.entry.id);
                      return (
                        <option key={seat} value={seat}>
                          {seat}
                          {other ? ` (${other.entry.playerName})` : ''}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <b>{m.to.seat}</b>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {clash && (
        <p className="error">
          Two players have seat {clash.to.seat} at table {clash.to.table}.
        </p>
      )}
      <button
        className="primary big"
        disabled={!!clash}
        onClick={() => onConfirm(moves.map((m) => ({ entryId: m.entry.id, to: m.to })))}
      >
        {confirmText}
      </button>
    </>
  );
}
