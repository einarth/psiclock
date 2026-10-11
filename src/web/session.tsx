import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './api';
import { hasRole, roleNames, type Role } from '../shared/auth';

let cached: Promise<Me> | null = null;

/** Who is signed in. Fetched once per page load. */
export function useSession(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    cached ??= api.me();
    cached.then(setMe, () => setMe({ user: null, setupNeeded: false, setupAllowed: false }));
  }, []);
  return me;
}

export const signInUrl = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`;

export async function signOut() {
  await api.logout().catch(() => {});
  location.href = '/';
}

/** Shows the page only to signed-in staff with at least the given role. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const me = useSession();
  useEffect(() => {
    if (me && !me.user) location.replace(signInUrl());
  }, [me]);
  if (!me || !me.user) return <main className="page muted">Loading...</main>;
  if (!hasRole(me.user, role)) {
    return (
      <main className="page">
        <section className="card">
          <h2>This page needs a {roleNames[role]} login</h2>
          <p>
            You are signed in as {me.user.displayName} ({roleNames[me.user.role]}).
          </p>
          <p className="actions">
            <a href="/">Back to the start</a>
            <button className="link" onClick={signOut}>
              Sign in as someone else
            </button>
          </p>
        </section>
      </main>
    );
  }
  return (
    <>
      {children}
      <SessionFooter />
    </>
  );
}

export function SessionFooter() {
  const me = useSession();
  if (!me?.user) return null;
  return (
    <footer className="session-footer">
      Signed in as <b>{me.user.displayName}</b> ({roleNames[me.user.role]})
      <a href="/account">Change password</a>
      {me.user.role === 'admin' && <a href="/users">Logins</a>}
      <button className="link" onClick={signOut}>
        Sign out
      </button>
    </footer>
  );
}
