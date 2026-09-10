import { useState, type FormEvent } from 'react';
import type { Clinic, Permission } from '../../auth/auth.types';
import { PermissionPicker } from './permission-options';

export type NewUser = {
  email: string;
  clinicId: string;
  fullName: string | null;
  position: string | null;
  specialization: string | null;
  permissions: Permission[];
};

export function UserForm({
  clinics,
  create,
}: {
  clinics: Clinic[];
  create(input: NewUser): Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [permissions, setPermissions] = useState<Permission[]>(['requests:use']);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await create({
        email,
        clinicId,
        fullName: fullName.trim() || null,
        position: position.trim() || null,
        specialization: specialization.trim() || null,
        permissions,
      });
      setEmail('');
      setFullName('');
      setPosition('');
      setSpecialization('');
      setPermissions(['requests:use']);
    } catch {
      // The parent owns the visible error message.
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <label>Почта<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Клиника<select required value={clinicId} onChange={(event) => setClinicId(event.target.value)}><option value="">Выберите клинику</option>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
        <label>ФИО, опционально<input maxLength={300} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Должность, опционально<input maxLength={200} value={position} onChange={(event) => setPosition(event.target.value)} /></label>
        <label>Специализация, опционально<input maxLength={200} value={specialization} onChange={(event) => setSpecialization(event.target.value)} /></label>
      </div>
      <PermissionPicker value={permissions} onChange={setPermissions} />
      <button className="primary" disabled={saving || !clinics.length} type="submit">Создать пользователя</button>
    </form>
  );
}
