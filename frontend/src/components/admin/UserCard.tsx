import { useState } from 'react';
import type { AdminUser, Clinic, Permission } from '../../auth/auth.types';
import { formatDate } from '../../shared/format';
import { PermissionPicker } from './permission-options';

type Props = {
  user: AdminUser;
  clinics: Clinic[];
  currentUserId: string;
  save(id: string, input: { clinicId: string; permissions: Permission[] }): Promise<void>;
  setBlocked(id: string, blocked: boolean): Promise<void>;
  regenerate(user: AdminUser): Promise<void>;
};

export function UserCard({ user, clinics, currentUserId, save, setBlocked, regenerate }: Props) {
  const [clinicId, setClinicId] = useState(user.clinicId);
  const [permissions, setPermissions] = useState<Permission[]>(user.permissions);
  const [saving, setSaving] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    try { await work(); } catch {
      // The parent owns the visible error message.
    } finally { setSaving(false); }
  };

  return (
    <article className={`user-card${user.blocked ? ' is-blocked' : ''}`}>
      <div className="user-card-heading">
        <div><strong>{user.fullName || user.email}</strong>{user.fullName && <small>{user.email}</small>}</div>
        <span className="badge">{user.blocked ? 'Заблокирован' : 'Активен'}</span>
      </div>
      <div className="form-grid compact">
        <label>Клиника<select value={clinicId} onChange={(event) => setClinicId(event.target.value)}>{clinics.map((clinic) => <option value={clinic.id} key={clinic.id}>{clinic.name}</option>)}</select></label>
        <div><span className="field-label">Пароль создан</span><span>{formatDate(user.passwordCreatedAt)}</span></div>
      </div>
      <PermissionPicker value={permissions} onChange={setPermissions} />
      <div className="actions">
        <button className="secondary" disabled={saving} onClick={() => void run(() => save(user.id, { clinicId, permissions }))}>Сохранить права</button>
        <button className="secondary" disabled={saving} onClick={() => void run(() => regenerate(user))}>Пересоздать пароль</button>
        <button className="danger" disabled={saving || user.id === currentUserId} onClick={() => void run(() => setBlocked(user.id, !user.blocked))}>{user.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
      </div>
    </article>
  );
}
