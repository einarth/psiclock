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

/** An ISO time as the value of a datetime-local input, in this computer's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local input's value as an ISO time; null when it is empty. */
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** A date and time for people to read: "Sat 18 Oct, 19:00". */
export function startText(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
