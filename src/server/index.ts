import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { SqliteStorage } from './storage/sqlite.js';
import { defaultStructures } from '../shared/structures.js';

const port = Number(process.env.PORT ?? 3000);
const dbFile = resolve(process.env.PSICLOCK_DB ?? 'data/psiclock.db');
const webRoot = fileURLToPath(new URL('../../web', import.meta.url));

const storage = new SqliteStorage(dbFile);
await storage.init();
if ((await storage.listStructures()).length === 0) {
  for (const s of defaultStructures) await storage.createStructure(s);
}

const app = await buildApp({ storage, webRoot, logger: process.env.LOG === '1' });
await app.listen({ host: '0.0.0.0', port });

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n!.address}:${port}`);
console.log(`PSICLOCK is running. Database: ${dbFile}`);
console.log(`  On this laptop:     http://localhost:${port}`);
for (const url of lan) console.log(`  On the network:     ${url}`);

const shutdown = async () => {
  await app.close();
  await storage.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
