import { useState, type FormEvent } from 'react';
import type { Clinic } from '../../auth/auth.types';

type Props = {
  clinics: Clinic[];
  create(name: string): Promise<void>;
};

export function ClinicSection({ clinics, create }: Props) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await create(name.trim());
      setName('');
    } catch {
      // The parent owns the visible error message.
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-section">
      <div><p className="eyebrow">Юридические лица</p><h2>Клиники</h2></div>
      <form className="inline-form" onSubmit={(event) => void submit(event)}>
        <label className="grow">Название клиники<input value={name} maxLength={300} onChange={(event) => setName(event.target.value)} required /></label>
        <button className="primary" disabled={saving} type="submit">Создать клинику</button>
      </form>
      <div className="data-list">
        {clinics.map((clinic) => (
          <div className="data-row" key={clinic.id}>
            <div><strong>{clinic.name}</strong><small>{clinic.id}</small></div>
            <span className="badge">Пользователей: {clinic.userCount}</span>
          </div>
        ))}
        {!clinics.length && <p className="muted">Сначала создайте клинику.</p>}
      </div>
    </section>
  );
}
