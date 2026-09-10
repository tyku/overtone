import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { navigate } from '../app/router';

export function LoginPage({ destination = '/requests' }: { destination?: string }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await auth.login(email, password);
      navigate(destination, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Overtone</p>
        <h1 id="login-title">Вход</h1>
        <p className="muted">Используйте почту и пароль, полученные от администратора.</p>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label>
            Почта
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary" disabled={submitting} type="submit">
            {submitting ? 'Входим…' : 'Войти'}
          </button>
        </form>
      </section>
    </main>
  );
}
