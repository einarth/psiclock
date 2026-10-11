import type { Storage } from './storage/storage.js';
import { hashPassword, startSession } from './auth.js';
import type { Role } from '../shared/auth.js';

/** Creates a user with the given role and returns a Cookie header value that signs requests in as them. */
export async function signedIn(storage: Storage, role: Role = 'admin', username = role): Promise<string> {
  const user = await storage.createUser({ username, displayName: username, role, passwordHash: await hashPassword('password123') });
  return (await startSession(storage, user.id)).split(';')[0];
}
