import type { ClockState, ClockCommand, Level } from './types.js';

export interface ClockView {
  levelIndex: number;
  level: Level | null;
  nextLevel: Level | null;
  remainingMs: number;
  running: boolean;
  /** True once the last level has run out. */
  finished: boolean;
  /** Number of play levels (not breaks) up to and including the current one. */
  levelNumber: number;
}

export const minutesToMs = (m: number) => Math.round(m * 60_000);

export function initialClock(now: number): ClockState {
  return { running: false, levelIndex: 0, elapsedMs: 0, anchorAt: now };
}

/** Where the clock is at `now`, rolling over into later levels as time passes. */
export function clockAt(levels: Level[], state: ClockState, now: number): ClockView {
  let index = state.levelIndex;
  let elapsed = state.elapsedMs + (state.running ? Math.max(0, now - state.anchorAt) : 0);
  while (index < levels.length && elapsed >= minutesToMs(levels[index].minutes)) {
    elapsed -= minutesToMs(levels[index].minutes);
    index++;
  }
  const finished = index >= levels.length;
  if (finished) index = Math.max(0, levels.length - 1);
  const level = levels[index] ?? null;
  return {
    levelIndex: index,
    level,
    nextLevel: levels[index + 1] ?? null,
    remainingMs: finished || !level ? 0 : minutesToMs(level.minutes) - elapsed,
    running: state.running && !finished,
    finished,
    levelNumber: levels.slice(0, index + 1).filter((l) => l.kind === 'level').length,
  };
}

/** Freeze the derived position into a new anchor so later changes start from it. */
function settle(levels: Level[], state: ClockState, now: number): ClockState {
  const view = clockAt(levels, state, now);
  const elapsedMs = view.level ? minutesToMs(view.level.minutes) - view.remainingMs : 0;
  return { running: view.running, levelIndex: view.levelIndex, elapsedMs, anchorAt: now };
}

export function applyClockCommand(levels: Level[], state: ClockState, cmd: ClockCommand, now: number): ClockState {
  const s = settle(levels, state, now);
  switch (cmd.type) {
    case 'clock.start':
      return { ...s, running: true };
    case 'clock.pause':
      return { ...s, running: false };
    case 'clock.adjust': {
      // Positive delta adds time to the current level; never past its full length or below zero.
      const full = levels[s.levelIndex] ? minutesToMs(levels[s.levelIndex].minutes) : 0;
      const elapsedMs = Math.min(full, Math.max(0, s.elapsedMs - cmd.deltaMs));
      return { ...s, elapsedMs };
    }
    case 'clock.setLevel': {
      const levelIndex = Math.min(Math.max(0, cmd.levelIndex), Math.max(0, levels.length - 1));
      return { ...s, levelIndex, elapsedMs: 0 };
    }
  }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
