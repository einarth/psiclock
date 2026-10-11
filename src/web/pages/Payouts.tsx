import { Display } from './Display';

/** Payout table for a second TV: the big screen pinned to the payouts scene. */
export function Payouts({ id }: { id: number }) {
  return <Display id={id} pin="payouts" />;
}
