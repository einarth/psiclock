import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';

/** Where to go after signing in: the page that sent us here, if it is one of ours. */
function next() {
  const n = new URLSearchParams(location.search).get('next') ?? '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

export function Login() {
  const me = useSession();
  const [form, setForm] = useState({ username: '', displayName: '', password: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!me) return <main className="page muted">Loading...</main>;
  const setup = me.setupNeeded;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (setup && form.password !== form.repeat) {
      setError('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    try {
      if (setup) await api.setup(form);
      else await api.login(form.username, form.password);
      location.href = next();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text', auto?: string) => (
    <label>
      {label}
      <input
        type={type}
        required={key !== 'displayName'}
        autoComplete={auto}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <main className="page narrow">
      <header className="page-head">
        <h1>PSICLOCK</h1>
        <nav>
          <a href="/">Back</a>
        </nav>
      </header>
      <section className="card">
        {me.user && !setup && (
          <p className="muted">
            You are signed in as {me.user.displayName}. Sign in below to switch to another login.
          </p>
        )}
        {setup && !me.setupAllowed ? (
          <>
            <h2>First-time setup</h2>
            <p>
              No logins exist yet. For safety, the first one has to be made on the laptop running PSICLOCK: open{' '}
              <b>http://localhost:{location.port || 80}</b> there.
            </p>
          </>
        ) : (
          <form className="stack-form" onSubmit={submit}>
            <h2>{setup ? 'Create the first login' : 'Sign in'}</h2>
            {setup && <p className="muted">This login is the admin. You can add logins for the desk and floor staff afterwards.</p>}
            {field('username', 'Username', 'text', 'username')}
            {setup && field('displayName', 'Your name (optional)')}
            {field('password', 'Password', 'password', setup ? 'new-password' : 'current-password')}
            {setup && field('repeat', 'Password again', 'password', 'new-password')}
            {setup && <p className="muted small">At least 8 characters.</p>}
            <button type="submit" disabled={busy}>
              {setup ? 'Create login' : 'Sign in'}
            </button>
            {error && <p className="error">{error[0].toUpperCase() + error.slice(1)}.</p>}
          </form>
        )}
      </section>
      <p className="muted small">The big screens and the payout screen do not need a login.</p>
    </main>
  );
}

export function Account() {
  const me = useSession();
  const [form, setForm] = useState({ current: '', password: '', repeat: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.password !== form.repeat) {
      setError('The two new passwords are not the same.');
      return;
    }
    try {
      await api.changePassword(form.current, form.password);
      setForm({ current: '', password: '', repeat: '' });
      setMessage('Password changed. Any other devices using this login have been signed out.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="page narrow">
      <header className="page-head">
        <h1>Your login</h1>
        <nav>
          <a href="/">Back</a>
        </nav>
      </header>
      <section className="card">
        <p>
          {me?.user?.displayName} <span className="muted">({me?.user?.username})</span>
        </p>
        <form className="stack-form" onSubmit={submit}>
          <h2>Change password</h2>
          {(['current', 'password', 'repeat'] as const).map((k) => (
            <label key={k}>
              {{ current: 'Current password', password: 'New password', repeat: 'New password again' }[k]}
              <input
                type="password"
                required
                autoComplete={k === 'current' ? 'current-password' : 'new-password'}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit">Change password</button>
          {message && <p className="paid">{message}</p>}
          {error && <p className="error">{error[0].toUpperCase() + error.slice(1)}.</p>}
        </form>
      </section>
    </main>
  );
}
