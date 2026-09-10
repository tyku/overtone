import { useCallback, useEffect, useState } from 'react';
import { AdminApi } from '../../auth/auth-api';
import { useAuth } from '../../auth/AuthContext';
import type { AdminUser, Clinic, Permission } from '../../auth/auth.types';
import { ClinicSection } from '../../components/admin/ClinicSection';
import { OneTimePassword } from '../../components/admin/OneTimePassword';
import { UserSection } from '../../components/admin/UserSection';
import type { NewUser } from '../../components/admin/UserForm';

const api = new AdminApi();
type AdminSection = 'organizations' | 'users';

function sectionFromLocation(): AdminSection {
  return new URLSearchParams(location.search).get('section') === 'users' ? 'users' : 'organizations';
}

export function AdminPage() {
  const current = useAuth().user!;
  const [section, setSection] = useState<AdminSection>(sectionFromLocation);
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
  useEffect(() => {
    const updateSection = () => setSection(sectionFromLocation());
    window.addEventListener('popstate', updateSection);
    return () => window.removeEventListener('popstate', updateSection);
  }, []);

  const selectSection = (nextSection: AdminSection) => {
    const url = new URL(location.href);
    if (nextSection === 'organizations') url.searchParams.delete('section');
    else url.searchParams.set('section', nextSection);
    history.pushState(null, '', `${url.pathname}${url.search}`);
    setSection(nextSection);
  };

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
          <p>Организации, учётные записи и права пользователей</p>
        </div>
      </div>
      <nav className="admin-tabs" aria-label="Разделы администрирования" role="tablist">
        <button
          aria-controls="admin-organizations"
          aria-selected={section === 'organizations'}
          className={section === 'organizations' ? 'is-active' : ''}
          onClick={() => selectSection('organizations')}
          role="tab"
          type="button"
        >
          <span>Организации</span>
          <small>{clinics.length}</small>
        </button>
        <button
          aria-controls="admin-users"
          aria-selected={section === 'users'}
          className={section === 'users' ? 'is-active' : ''}
          onClick={() => selectSection('users')}
          role="tab"
          type="button"
        >
          <span>Пользователи</span>
          <small>{users.length}</small>
        </button>
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      {secret && <OneTimePassword {...secret} close={() => setSecret(null)} />}
      {section === 'organizations' && (
        <div id="admin-organizations" role="tabpanel">
          <ClinicSection clinics={clinics} create={async (name) => {
            try { await api.createClinic(name); await load(); } catch (cause) { fail(cause); }
          }} />
        </div>
      )}
      {section === 'users' && (
        <div id="admin-users" role="tabpanel">
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
        </div>
      )}
    </section>
  );
}
