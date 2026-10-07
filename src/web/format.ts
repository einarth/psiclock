import type { Level } from '../shared/types';

export const num = (n: number) => n.toLocaleString('is-IS');

export function blindsText(l: Level | null): string {
  if (!l) return '';
  if (l.kind === 'break') return `Break, ${l.minutes} min`;
  return `${num(l.smallBlind)} / ${num(l.bigBlind)}${l.ante ? `  ante ${num(l.ante)}` : ''}`;
}
