import type { AdminUser, Clinic, Permission } from '../../auth/auth.types';
import { UserCard } from './UserCard';
import { UserForm, type NewUser } from './UserForm';

export function UserSection({
  users,
  clinics,
  currentUserId,
  create,
  save,
  setBlocked,
  regenerate,
}: {
  users: AdminUser[];
  clinics: Clinic[];
  currentUserId: string;
  create(input: NewUser): Promise<void>;
  save(id: string, input: { clinicId: string; permissions: Permission[] }): Promise<void>;
  setBlocked(id: string, blocked: boolean): Promise<void>;
  regenerate(user: AdminUser): Promise<void>;
}) {
  return (
    <section className="admin-section">
      <div><p className="eyebrow">Доступ к системе</p><h2>Пользователи</h2></div>
      <UserForm clinics={clinics} create={create} />
      <div className="user-list">
        {users.map((user) => <UserCard key={user.id} user={user} clinics={clinics} currentUserId={currentUserId} save={save} setBlocked={setBlocked} regenerate={regenerate} />)}
      </div>
    </section>
  );
}

