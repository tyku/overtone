import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

export function ProfilePage() {
  const auth = useAuth();
  const user = auth.user!;
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [position, setPosition] = useState(user.position ?? '');
  const [specialization, setSpecialization] = useState(user.specialization ?? '');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    try {
      await auth.updateProfile({
        fullName: fullName.trim() || null,
        position: position.trim() || null,
        specialization: specialization.trim() || null,
      });
      setNotice('Профиль сохранён');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Не удалось сохранить профиль');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="narrow-page">
      <div className="page-heading">
        <div><p className="eyebrow">{user.clinicName}</p><h1>Профиль</h1></div>
      </div>
      <form className="panel form-stack" onSubmit={(event) => void submit(event)}>
        <label>Почта<input value={user.email} disabled /></label>
        <label>ФИО<input value={fullName} maxLength={300} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Должность<input value={position} maxLength={200} onChange={(event) => setPosition(event.target.value)} /></label>
        <label>Специализация<input value={specialization} maxLength={200} onChange={(event) => setSpecialization(event.target.value)} /></label>
        {notice && <p className="notice" role="status">{notice}</p>}
        <button className="primary" disabled={saving} type="submit">Сохранить</button>
      </form>
    </section>
  );
}

