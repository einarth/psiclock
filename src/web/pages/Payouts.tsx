import type { CSSProperties } from 'react';
import { useLiveTournament } from '../live';
import { num, ordinal } from '../format';
import { finishingPlace, isAlive } from '../../shared/seating';
import { moneySummary, payoutsFor } from '../../shared/money';

/** Payout table for a second TV, with each place's winner filled in as players bust. */
export function Payouts({ id }: { id: number }) {
  const { tournament: t, entries, connected } = useLiveTournament(id);
  const theme = new URLSearchParams(location.search).get('theme') ?? t?.theme ?? 'classic';
  if (!t) return <div className="display" data-theme={theme}>Connecting...</div>;

  const summary = moneySummary(t, entries);
  const prizes = payoutsFor(t, entries).filter((p) => p > 0);
  const winners = new Map<number, string>();
  for (const e of entries) {
    const place = finishingPlace(entries, e);
    if (place && place <= prizes.length) winners.set(place, e.playerName);
  }
  // Up to 12 rows per column; text shrinks as the table grows.
  const rows = Math.min(12, Math.max(1, prizes.length));
  const columns = Math.ceil(prizes.length / rows);
  const size = `${Math.min(6, 60 / rows / Math.max(1, columns * 0.8))}vh`;

  return (
    <div className="display payout-screen" data-theme={theme}>
      <header className="display-title">{t.name}</header>
      <div className="display-level">Payouts</div>
      <div className="payout-pool">{num(summary.prizePool)}</div>
      <div className="display-next">
        {prizes.length} paid of {summary.entries} entries, {entries.filter(isAlive).length} still in
      </div>
      <div className="payout-grid" style={{ '--rows': rows, '--size': size } as CSSProperties}>
        {prizes.map((p, i) => (
          <div key={i} className={winners.has(i + 1) ? 'done' : ''}>
            <span className="place">{ordinal(i + 1)}</span>
            {winners.has(i + 1) && <span className="who">{winners.get(i + 1)}</span>}
            <span>{num(p)}</span>
          </div>
        ))}
      </div>
      {!connected && <div className="display-offline">Reconnecting to server...</div>}
    </div>
  );
}
