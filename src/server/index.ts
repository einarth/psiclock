import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { start } from './start.js';

await start({
  port: Number(process.env.PORT ?? 3000),
  dbFile: resolve(process.env.PSICLOCK_DB ?? 'data/psiclock.db'),
  webRoot: fileURLToPath(new URL('../../web', import.meta.url)),
});
