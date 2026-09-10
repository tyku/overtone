import { useCallback, useEffect, useState } from 'react';
import { AdminApi } from '../../auth/auth-api';
import { useAuth } from '../../auth/AuthContext';
import type { AdminUser, Clinic, Permission } from '../../auth/auth.types';
import { ClinicSection } from '../../components/admin/ClinicSection';
import { OneTimePassword } from '../../components/admin/OneTimePassword';
import { UserSection } from '../../components/admin/UserSection';
import type { NewUser } from '../../components/admin/UserForm';

const api = new AdminApi();

export function AdminPage() {
  const current = useAuth().user!;
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [clinicPage, userPage] = await Promise.all([api.clinics(), api.users()]);
      setClinics(clinicPage.items);
      setUsers(userPage.items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить админку');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fail = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Операция не выполнена');
    throw cause;
  };

  return (
    <section className="admin-page">
      <div className="admin-hero">
        <div className="admin-hero-icon" aria-hidden="true">A</div>
        <div>
          <p className="admin-kicker">Системное администрирование</p>
          <h1>Управление доступом</h1>
          <p>Клиники, учётные записи и права пользователей</p>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {secret && <OneTimePassword {...secret} close={() => setSecret(null)} />}
      <ClinicSection clinics={clinics} create={async (name) => {
        try { await api.createClinic(name); await load(); } catch (cause) { fail(cause); }
      }} />
      <UserSection
        clinics={clinics}
        users={users}
        currentUserId={current.id}
        create={async (input: NewUser) => {
          try { const result = await api.createUser(input); setSecret({ email: result.user.email, password: result.password }); await load(); } catch (cause) { fail(cause); }
        }}
        save={async (id: string, input: { clinicId: string; permissions: Permission[] }) => {
          try { await api.updateUser(id, input); await load(); } catch (cause) { fail(cause); }
        }}
        setBlocked={async (id, blocked) => {
          try { await api.updateUser(id, { blocked }); await load(); } catch (cause) { fail(cause); }
        }}
        regenerate={async (user) => {
          try { const result = await api.regeneratePassword(user.id); setSecret({ email: user.email, password: result.password }); await load(); } catch (cause) { fail(cause); }
        }}
      />
    </section>
  );
}
