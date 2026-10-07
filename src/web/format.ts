import type { Level } from '../shared/types';

export const num = (n: number) => n.toLocaleString('is-IS');

export function blindsText(l: Level | null): string {
  if (!l) return '';
  if (l.kind === 'break') return `Break, ${l.minutes} min`;
  return `${num(l.smallBlind)} / ${num(l.bigBlind)}${l.ante ? `  ante ${num(l.ante)}` : ''}`;
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Compact stack sizes for small screens: 97500 -> "97.5k". */
export function short(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${+(n / 1000).toFixed(1)}k`;
  return num(n);
}
