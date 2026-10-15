import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { buildApp } from './app.js';
import { SqliteStorage } from './storage/sqlite.js';
import { defaultStructures } from '../shared/structures.js';
import { BACKUP_EVERY_MS, HEARTBEAT_MS, backupDatabase, noteAlive, pauseAfterRestart } from './safety.js';

export interface StartOptions {
  port: number;
  dbFile: string;
  /** Folder with the built web app (npm start). */
  webRoot?: string;
  /** The web app embedded in the packaged .exe, by path such as 'index.html'. */
  webFiles?: (path: string) => Buffer | null;
}

/** Opens the database, starts the server and prints the addresses to open. */
export async function start({ port, dbFile, webRoot, webFiles }: StartOptions) {
  const storage = new SqliteStorage(dbFile);
  await storage.init();
  if ((await storage.listStructures()).length === 0) {
    for (const s of defaultStructures) await storage.createStructure(s);
  }
  const paused = await pauseAfterRestart(storage);
  await noteAlive(storage);

  // A copy of the database at start and every few minutes while a tournament runs.
  const backupDir = join(dirname(dbFile), 'backups');
  const backup = async () => {
    try {
      await backupDatabase(storage, backupDir);
    } catch (err) {
      console.error(`Could not back up the database to ${backupDir}: ${(err as Error).message}`);
    }
  };
  if ((await storage.listTournaments()).length) await backup();

  const app = await buildApp({ storage, webRoot, webFiles, logger: process.env.LOG === '1' });
  try {
    await app.listen({ host: '0.0.0.0', port });
  } catch (err) {
    await storage.close();
    throw err;
  }

  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n!.address}:${port}`);
  console.log(`PSICLOCK is running. Database: ${dbFile}`);
  console.log(`  On this laptop:     http://localhost:${port}`);
  for (const url of lan) console.log(`  On the network:     ${url}`);
  if ((await storage.countUsers()) === 0) {
    console.log(`\nNo logins yet. Open http://localhost:${port}/login on this laptop to create the first (admin) login.`);
  }

  if (paused.length) {
    console.log(`\nPaused the clock of ${paused.join(', ')} where it stood when the server stopped. Resume it from Manage.`);
  }

  const heartbeat = setInterval(() => void noteAlive(storage), HEARTBEAT_MS);
  const backups = setInterval(async () => {
    if ((await storage.listTournaments()).some((t) => t.status === 'running')) await backup();
  }, BACKUP_EVERY_MS);

  const shutdown = async () => {
    clearInterval(heartbeat);
    clearInterval(backups);
    await noteAlive(storage);
    await app.close();
    await storage.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
