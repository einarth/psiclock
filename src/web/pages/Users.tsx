import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { roleDescriptions, roleNames, roles, type Role, type User } from '../../shared/auth';

const blank = { username: '', displayName: '', role: 'floor' as Role, password: '' };

/** Admin page: add logins for staff, change their role, reset passwords, turn logins off. */
export function Users() {
  const me = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(blank);
  const [reset, setReset] = useState<{ id: number; password: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => api.users().then(setUsers);
  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError('');
    setMessage('');
    try {
      await fn();
      if (done) setMessage(done);
      await load();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api.createUser(form);
      setForm(blank);
    }, `Login ${form.username} created.`);
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Logins</h1>
        <nav>
          <a href="/">Home</a>
        </nav>
      </header>

      <section className="card">
        <h2>Staff logins</h2>
        {error && <p className="error">{error[0].toUpperCase() + error.slice(1)}.</p>}
        {message && <p className="paid">{message}</p>}
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'past'}>
                <td>
                  {u.username}
                  {!u.active && ' (off)'}
                </td>
                <td>{u.displayName}</td>
                <td>
                  <select
                    value={u.role}
                    aria-label={`Role for ${u.username}`}
                    onChange={(e) => act(() => api.updateUser(u.id, { role: e.target.value as Role }), `${u.username} is now ${roleNames[e.target.value as Role]}.`)}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {roleNames[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="row-actions">
                  {reset?.id === u.id ? (
                    <form
                      className="row-actions"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(() => api.updateUser(u.id, { password: reset.password }), `New password set for ${u.username}.`).then((ok) => ok && setReset(null));
                      }}
                    >
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="New password"
                        value={reset.password}
                        onChange={(e) => setReset({ id: u.id, password: e.target.value })}
                      />
                      <button type="submit">Set</button>
                      <button type="button" onClick={() => setReset(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    u.id !== me?.user?.id && (
                      <button className="link" onClick={() => setReset({ id: u.id, password: '' })}>
                        Reset password
                      </button>
                    )
                  )}
                  {u.id === me?.user?.id ? (
                    <a href="/account">Change your password</a>
                  ) : (
                    <button className="link" onClick={() => act(() => api.updateUser(u.id, { active: !u.active }))}>
                      {u.active ? 'Turn off' : 'Turn on'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Add a login</h2>
        <form className="grid-form" onSubmit={create}>
          <label>
            Username
            <input required autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Name
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleNames[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <button type="submit">Add login</button>
        </form>
        <ul className="muted small role-help">
          {roles.map((r) => (
            <li key={r}>
              <b>{roleNames[r]}:</b> {roleDescriptions[r]}.
            </li>
          ))}
          <li>Without a login, anyone on the network can open the big screen and payout screen.</li>
        </ul>
      </section>
    </main>
  );
}
