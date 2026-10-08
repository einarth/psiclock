import { describe, expect, it } from 'vitest';
import {
  averageStack,
  defaultMoney,
  moneySummary,
  payoutAmounts,
  payoutsFor,
  suggestedPercents,
  suggestedPlacesPaid,
  withinLevel,
} from './money';
import type { Entry, Tournament } from './types';

const tournament = (over: Partial<Tournament> = {}): Tournament => ({
  id: 1,
  name: 'T',
  status: 'running',
  buyIn: 20000,
  fee: 2000,
  startingStack: 30000,
  levels: [],
  clock: { running: false, levelIndex: 0, elapsedMs: 0, anchorAt: 0 },
  theme: 'classic',
  tables: [],
  handForHand: false,
  money: { ...defaultMoney, rebuyPrice: 10000, rebuyFee: 1000, rebuyChips: 20000, addOnPrice: 10000, addOnChips: 25000 },
  payouts: null,
  createdAt: '',
  ...over,
});

const entry = (id: number, over: Partial<Entry> = {}): Entry => ({
  id,
  tournamentId: 1,
  playerId: id,
  playerName: `P${id}`,
  table: 1,
  seat: id,
  bustSeq: null,
  rebuys: 0,
  addOn: false,
  paidOut: 0,
  createdAt: '',
  ...over,
});

describe('money', () => {
  it('adds buy-ins, rebuys and add-ons into the pool and keeps fees apart', () => {
    const entries = [entry(1, { rebuys: 2 }), entry(2, { addOn: true }), entry(3, { bustSeq: 1 })];
    const s = moneySummary(tournament(), entries);
    expect(s).toMatchObject({ entries: 3, rebuys: 2, addOns: 1, collectedPool: 90000, fees: 8000, prizePool: 90000 });
    expect(s.totalChips).toBe(3 * 30000 + 2 * 20000 + 25000);
    expect(averageStack(tournament(), entries)).toBe(Math.round(s.totalChips / 2));
  });

  it('pays at least the guarantee', () => {
    const t = tournament({ money: { ...defaultMoney, guarantee: 1_000_000 } });
    expect(moneySummary(t, [entry(1)]).prizePool).toBe(1_000_000);
  });

  it('pays about 15% of the field', () => {
    expect(suggestedPlacesPaid(1)).toBe(1);
    expect(suggestedPlacesPaid(30)).toBe(5);
    expect(suggestedPlacesPaid(200)).toBe(30);
  });

  it('suggests a falling payout curve that adds up to 100', () => {
    for (const n of [1, 2, 5, 9, 18, 30]) {
      const p = suggestedPercents(n);
      expect(p).toHaveLength(n);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
      for (let i = 1; i < n; i++) expect(p[i]).toBeLessThanOrEqual(p[i - 1]);
    }
    expect(suggestedPercents(5)[0]).toBeGreaterThan(40);
  });

  it('rounds prizes down and gives the remainder to first place', () => {
    const a = payoutAmounts(1_234_567, [50, 30, 20], 1000);
    expect(a).toEqual([617_567, 370_000, 246_000].map((x, i) => (i === 0 ? 1_234_567 - 370_000 - 246_000 : x)));
    expect(a.reduce((x, y) => x + y, 0)).toBe(1_234_567);
  });

  it('uses the director’s own percentages when set', () => {
    const t = tournament({ buyIn: 10000, payouts: [60, 40] });
    expect(payoutsFor(t, [entry(1), entry(2), entry(3)])).toEqual([18000, 12000]);
  });

  it('treats 0 as no level limit', () => {
    expect(withinLevel(12, 0)).toBe(true);
    expect(withinLevel(6, 6)).toBe(true);
    expect(withinLevel(7, 6)).toBe(false);
  });
});
