import type { Permission } from '../auth/auth.types';

export type ClinicRow = {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
};

export type AdminUserRow = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  email: string;
  full_name: string | null;
  position: string | null;
  specialization: string | null;
  blocked_at: Date | null;
  password_created_at: Date;
  created_at: Date;
  updated_at: Date;
  permissions: Permission[];
};

