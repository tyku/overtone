import type { Permission } from '../../auth/auth.types';

export const permissionOptions: Array<{ value: Permission; label: string }> = [
  { value: 'requests:use', label: 'Работа с приёмами' },
  { value: 'admin:access', label: 'Вход в админку' },
  { value: 'admin:clinics:manage', label: 'Управление клиниками' },
  { value: 'admin:users:manage', label: 'Управление пользователями' },
];

export function PermissionPicker({
  value,
  onChange,
}: {
  value: Permission[];
  onChange(value: Permission[]): void;
}) {
  return (
    <fieldset className="permissions">
      <legend>Права</legend>
      {permissionOptions.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={value.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, option.value]
                  : value.filter((item) => item !== option.value),
              )
            }
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

