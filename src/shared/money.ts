import type { Entry, MoneyConfig, Tournament } from './types.js';
import { isAlive } from './seating.js';

export const defaultMoney: MoneyConfig = {
  allowRebuys: false,
  allowAddOn: false,
  rebuyPrice: 0,
  rebuyFee: 0,
  rebuyChips: 0,
  rebuyUntilLevel: 0,
  addOnPrice: 0,
  addOnFee: 0,
  addOnChips: 0,
  lateRegUntilLevel: 0,
  guarantee: 0,
  rounding: 1000,
};

/**
 * Fills in missing money settings. Tournaments saved before rebuys had their
 * own switch counted a rebuy or add-on price above 0 as switched on.
 */
export function normalizeMoney(m: Partial<MoneyConfig> | undefined): MoneyConfig {
  const raw = m ?? {};
  return {
    ...defaultMoney,
    ...raw,
    allowRebuys: raw.allowRebuys ?? (raw.rebuyPrice ?? 0) > 0,
    allowAddOn: raw.allowAddOn ?? (raw.addOnPrice ?? 0) > 0,
  };
}

export interface MoneySummary {
  entries: number;
  rebuys: number;
  addOns: number;
  /** What players paid into the prize pool, before any guarantee. */
  collectedPool: number;
  /** Fees kept by the organiser. */
  fees: number;
  /** The pool that is paid out: set by hand, or else collected or the guarantee, whichever is larger. */
  prizePool: number;
  /** The pool without a hand-set amount: collected or the guarantee, whichever is larger. */
  automaticPool: number;
  /** Where the prize pool comes from. */
  poolSource: 'collected' | 'guarantee' | 'set';
  totalChips: number;
}

export function moneySummary(t: Tournament, entries: Entry[]): MoneySummary {
  const m = t.money;
  const rebuys = entries.reduce((n, e) => n + e.rebuys, 0);
  const addOns = entries.filter((e) => e.addOn).length;
  const collectedPool = entries.length * t.buyIn + rebuys * m.rebuyPrice + addOns * m.addOnPrice;
  const automaticPool = Math.max(collectedPool, m.guarantee);
  return {
    entries: entries.length,
    rebuys,
    addOns,
    collectedPool,
    fees: entries.length * t.fee + rebuys * m.rebuyFee + addOns * m.addOnFee,
    prizePool: t.prizePoolOverride ?? automaticPool,
    automaticPool,
    poolSource: t.prizePoolOverride !== null ? 'set' : automaticPool > collectedPool ? 'guarantee' : 'collected',
    totalChips: entries.length * t.startingStack + rebuys * m.rebuyChips + addOns * m.addOnChips,
  };
}

export function averageStack(t: Tournament, entries: Entry[]): number {
  const remaining = entries.filter(isAlive).length;
  return remaining ? Math.round(moneySummary(t, entries).totalChips / remaining) : 0;
}

/** About 15% of the field gets paid, at least one place. */
export function suggestedPlacesPaid(entries: number): number {
  return Math.max(1, Math.round(entries * 0.15));
}

/**
 * A smooth, top-heavy payout curve: place i gets a share proportional to
 * 1 / i^1.1. With 5 places that is about 46/22/14/10/8; with 30 places first
 * gets about 29%. Returned as percentages with one decimal that sum to 100.
 */
export function suggestedPercents(places: number): number[] {
  const weights = Array.from({ length: places }, (_, i) => 1 / Math.pow(i + 1, 1.1));
  const total = weights.reduce((a, b) => a + b, 0);
  const pct = weights.map((w) => Math.floor((w / total) * 1000) / 10);
  const rest = Math.round((100 - pct.reduce((a, b) => a + b, 0)) * 10) / 10;
  pct[0] = Math.round((pct[0] + rest) * 10) / 10;
  return pct;
}

/** The percentages in force: the director's own table, or the suggestion for the current field. */
export function payoutPercents(t: Tournament, entries: Entry[]): number[] {
  return t.payouts ?? suggestedPercents(suggestedPlacesPaid(entries.length));
}

/** Prize per place, rounded down to the rounding unit, with the remainder added to first place. */
export function payoutAmounts(pool: number, percents: number[], rounding: number): number[] {
  const unit = Math.max(1, rounding);
  const amounts = percents.map((p) => Math.floor((pool * p) / 100 / unit) * unit);
  if (amounts.length) amounts[0] += pool - amounts.reduce((a, b) => a + b, 0);
  return amounts;
}

export function payoutsFor(t: Tournament, entries: Entry[]): number[] {
  return payoutAmounts(moneySummary(t, entries).prizePool, payoutPercents(t, entries), t.money.rounding);
}

/** True while the given level number is within a limit, where 0 means no limit. */
export const withinLevel = (levelNumber: number, until: number) => until === 0 || levelNumber <= until;

/**
 * True once late registration and rebuys have both closed, so the prize pool
 * and payout table stop changing. A limit left at 0 counts as closed once the
 * clock has started, so screens still show payouts when no limit was set.
 */
export function moneyFinal(t: Tournament, levelNumber: number): boolean {
  const m = t.money;
  const open = (until: number) => (until ? levelNumber <= until : t.status === 'setup');
  return !open(m.lateRegUntilLevel) && !(m.allowRebuys && open(m.rebuyUntilLevel));
}
