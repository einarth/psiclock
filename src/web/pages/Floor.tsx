import { useMemo, useState } from 'react';
import { api } from '../api';
import { useClockView, useLiveTournament } from '../live';
import { formatClock } from '../../shared/clock';
import {
  fieldStats,
  finishingPlace,
  freeSeats,
  isAlive,
  nextBalanceMove,
  openTables,
  playersAt,
  tableToBreak,
} from '../../shared/seating';
import type { Entry, TableConfig } from '../../shared/types';
import { blindsText, num, ordinal, short } from '../format';
import { averageStack, payoutsFor } from '../../shared/money';

type Sheet =
  | { kind: 'player'; entry: Entry }
  | { kind: 'move'; entry: Entry; suggested?: number }
  | { kind: 'table'; table: TableConfig }
  | { kind: 'confirm'; text: string; action: () => Promise<unknown>; danger?: boolean };

/** The floor manager's phone or tablet view: bust players, move them, balance and break tables. */
export function Floor({ id }: { id: number }) {
  const { tournament: t, entries, offset, connected } = useLiveTournament(id);
  const view = useClockView(t, offset);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [picking, setPicking] = useState<{ from: number; to: number } | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<unknown> } | null>(null);
  const [error, setError] = useState('');

  const busted = useMemo(
    () => entries.filter((e) => !isAlive(e)).sort((a, b) => b.bustSeq! - a.bustSeq!),
    [entries],
  );

  if (!t || !view) return <main className="page">{connected ? 'Tournament not found.' : 'Connecting...'}</main>;

  const stats = fieldStats(entries, t.startingStack);
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

  const bust = (e: Entry) => {
    // Busting now places them just behind everyone else still in.
    const place = entries.filter(isAlive).length;
    const prize = payoutsFor(t, entries)[place - 1] ?? 0;
    const money = prize > 0 ? ` and win ${num(prize)}` : '';
    setSheet({
      kind: 'confirm',
      text: `Bust ${e.playerName} (table ${e.table}, seat ${e.seat})? They finish ${ordinal(place)}${money}.`,
      danger: true,
      action: () =>
        act(
          () => api.bust(id, e.id),
          `${e.playerName} out in ${ordinal(place)}${prize > 0 ? `, send to the desk for ${num(prize)}` : ''}`,
          () => api.restore(id, e.id),
        ),
    });
  };

  const tapPlayer = (e: Entry) => {
    if (picking && e.table === picking.from) {
      const to = picking.to;
      setPicking(null);
      act(() => api.move(id, e.id, to), `${e.playerName} moved to table ${to}`);
    } else {
      setSheet({ kind: 'player', entry: e });
    }
  };

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
        {t.handForHand && <div className="floor-alert hfh">Hand for hand</div>}
      </header>

      {error && (
        <div className="floor-alert danger" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {picking ? (
        <div className="floor-alert action">
          Tap a player at table {picking.from} to move to table {picking.to}.
          <button className="link" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      ) : (
        balance && (
          <div className="floor-alert action">
            Table {balance.from} has {playersAt(entries, balance.from).length}, table {balance.to} has{' '}
            {playersAt(entries, balance.to).length}. Move one player.
            <button onClick={() => setPicking(balance)}>Choose player</button>
          </div>
        )
      )}
      {breakable && !picking && (
        <div className="floor-alert action">
          Table {breakable} can be broken.
          <button
            onClick={() =>
              setSheet({
                kind: 'confirm',
                text: `Break table ${breakable} and draw new seats for its ${playersAt(entries, breakable).length} players?`,
                action: () => act(() => api.breakTable(id, breakable), `Table ${breakable} broken`),
              })
            }
          >
            Break table {breakable}
          </button>
        </div>
      )}

      <div className="floor-tools">
        <input placeholder="Find player" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button
          className={t.handForHand ? 'primary' : ''}
          onClick={() => act(() => api.handForHand(id, !t.handForHand))}
        >
          Hand for hand {t.handForHand ? 'on' : 'off'}
        </button>
      </div>

      <section className="floor-tables">
        {shownTables.map((tb) => {
          const players = playersAt(entries, tb.number);
          const bySeat = new Map(players.map((p) => [p.seat, p]));
          const highlight = picking?.from === tb.number ? ' pick-from' : picking?.to === tb.number ? ' pick-to' : '';
          return (
            <div key={tb.number} className={`floor-table${highlight}`}>
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
          {busted.slice(0, 10).map((e) => (
            <li key={e.id}>
              <span>
                {ordinal(finishingPlace(entries, e) ?? 0)} {e.playerName}
              </span>
              <button className="link" onClick={() => act(() => api.restore(id, e.id), `${e.playerName} back in`)}>
                Undo bust
              </button>
            </li>
          ))}
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
                <button
                  className="big"
                  onClick={() =>
                    setSheet({
                      kind: 'confirm',
                      text: `Break table ${sheet.table.number} and move its players?`,
                      action: () => act(() => api.breakTable(id, sheet.table.number), `Table ${sheet.table.number} broken`),
                    })
                  }
                >
                  Break this table
                </button>
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
