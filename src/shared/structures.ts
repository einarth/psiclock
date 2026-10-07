import type { Level, NewBlindStructure } from './types.js';

const lvl = (smallBlind: number, bigBlind: number, ante: number, minutes: number): Level => ({
  kind: 'level',
  smallBlind,
  bigBlind,
  ante,
  minutes,
});
const brk = (minutes: number, note?: string): Level => ({ kind: 'break', minutes, ...(note ? { note } : {}) });

/** Starter templates seeded into a new database. Edit or replace them in the director view. */
export const defaultStructures: NewBlindStructure[] = [
  {
    name: 'Standard 30 min, big blind ante',
    levels: [
      lvl(100, 200, 200, 30),
      lvl(200, 300, 300, 30),
      lvl(200, 400, 400, 30),
      lvl(300, 600, 600, 30),
      brk(15, 'Colour up the 100 chips'),
      lvl(400, 800, 800, 30),
      lvl(500, 1000, 1000, 30),
      lvl(600, 1200, 1200, 30),
      lvl(800, 1600, 1600, 30),
      brk(15),
      lvl(1000, 2000, 2000, 30),
      lvl(1500, 3000, 3000, 30),
      lvl(2000, 4000, 4000, 30),
      lvl(3000, 6000, 6000, 30),
      brk(15, 'Colour up the 500 chips'),
      lvl(4000, 8000, 8000, 30),
      lvl(5000, 10000, 10000, 30),
      lvl(6000, 12000, 12000, 30),
      lvl(8000, 16000, 16000, 30),
      lvl(10000, 20000, 20000, 30),
    ],
  },
  {
    name: 'Turbo 15 min',
    levels: [
      lvl(100, 200, 200, 15),
      lvl(200, 400, 400, 15),
      lvl(300, 600, 600, 15),
      lvl(400, 800, 800, 15),
      brk(10),
      lvl(600, 1200, 1200, 15),
      lvl(1000, 2000, 2000, 15),
      lvl(1500, 3000, 3000, 15),
      lvl(2000, 4000, 4000, 15),
      lvl(3000, 6000, 6000, 15),
    ],
  },
];
