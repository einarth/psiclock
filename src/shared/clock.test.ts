import { describe, expect, it } from 'vitest';
import { applyClockCommand, clockAt, formatClock, initialClock, msUntilEndOfLevel, msUntilNextBreak } from './clock';
import type { Level } from './types';

const levels: Level[] = [
  { kind: 'level', smallBlind: 100, bigBlind: 200, ante: 200, minutes: 10 },
  { kind: 'level', smallBlind: 200, bigBlind: 400, ante: 400, minutes: 10 },
  { kind: 'break', minutes: 5 },
  { kind: 'level', smallBlind: 300, bigBlind: 600, ante: 600, minutes: 10 },
];
const MIN = 60_000;
const t0 = 1_000_000;

describe('clock', () => {
  it('does not move until started', () => {
    const v = clockAt(levels, initialClock(t0), t0 + 30 * MIN);
    expect(v.levelIndex).toBe(0);
    expect(v.remainingMs).toBe(10 * MIN);
  });

  it('counts down and rolls into the next levels, including breaks', () => {
    const s = applyClockCommand(levels, initialClock(t0), { type: 'clock.start' }, t0);
    expect(clockAt(levels, s, t0 + 3 * MIN).remainingMs).toBe(7 * MIN);
    const inBreak = clockAt(levels, s, t0 + 22 * MIN);
    expect(inBreak.level?.kind).toBe('break');
    expect(inBreak.remainingMs).toBe(3 * MIN);
    const after = clockAt(levels, s, t0 + 26 * MIN);
    expect(after.levelIndex).toBe(3);
    expect(after.levelNumber).toBe(3);
  });

  it('stops at the end of the last level', () => {
    const s = applyClockCommand(levels, initialClock(t0), { type: 'clock.start' }, t0);
    const v = clockAt(levels, s, t0 + 100 * MIN);
    expect(v.finished).toBe(true);
    expect(v.running).toBe(false);
    expect(v.remainingMs).toBe(0);
  });

  it('keeps its place across a pause', () => {
    let s = applyClockCommand(levels, initialClock(t0), { type: 'clock.start' }, t0);
    s = applyClockCommand(levels, s, { type: 'clock.pause' }, t0 + 12 * MIN);
    const paused = clockAt(levels, s, t0 + 60 * MIN);
    expect(paused.levelIndex).toBe(1);
    expect(paused.remainingMs).toBe(8 * MIN);
    s = applyClockCommand(levels, s, { type: 'clock.start' }, t0 + 60 * MIN);
    expect(clockAt(levels, s, t0 + 61 * MIN).remainingMs).toBe(7 * MIN);
  });

  it('adds and removes time within the current level only', () => {
    let s = applyClockCommand(levels, initialClock(t0), { type: 'clock.start' }, t0);
    s = applyClockCommand(levels, s, { type: 'clock.adjust', deltaMs: 5 * MIN }, t0 + 2 * MIN);
    expect(clockAt(levels, s, t0 + 2 * MIN).remainingMs).toBe(10 * MIN);
    s = applyClockCommand(levels, s, { type: 'clock.adjust', deltaMs: -20 * MIN }, t0 + 2 * MIN);
    expect(clockAt(levels, s, t0 + 2 * MIN).levelIndex).toBe(1);
  });

  it('jumps to a level and clamps out-of-range jumps', () => {
    let s = applyClockCommand(levels, initialClock(t0), { type: 'clock.setLevel', levelIndex: 3 }, t0);
    expect(clockAt(levels, s, t0).levelIndex).toBe(3);
    s = applyClockCommand(levels, s, { type: 'clock.setLevel', levelIndex: 99 }, t0);
    expect(clockAt(levels, s, t0).levelIndex).toBe(3);
    s = applyClockCommand(levels, s, { type: 'clock.setLevel', levelIndex: -1 }, t0);
    expect(clockAt(levels, s, t0).levelIndex).toBe(0);
  });

  it('formats remaining time', () => {
    expect(formatClock(9 * MIN + 5_000)).toBe('9:05');
    expect(formatClock(65 * MIN)).toBe('1:05:00');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('counts down to the end of a level and to the next break', () => {
    const running = applyClockCommand(levels, initialClock(t0), { type: 'clock.start' }, t0);
    const view = clockAt(levels, running, t0 + 3 * MIN);
    expect(msUntilEndOfLevel(levels, view, 1)).toBe(7 * MIN);
    expect(msUntilEndOfLevel(levels, view, 3)).toBe(32 * MIN);
    expect(msUntilEndOfLevel(levels, view, 9)).toBeNull();
    expect(msUntilNextBreak(levels, view)).toBe(17 * MIN);
    const later = clockAt(levels, running, t0 + 22 * MIN);
    expect(msUntilEndOfLevel(levels, later, 1)).toBeNull();
    expect(msUntilNextBreak(levels, later)).toBeNull();
  });
});
