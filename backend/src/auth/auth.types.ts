export const PERMISSIONS = [
  'requests:use',
  'admin:access',
  'admin:clinics:manage',
  'admin:users:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AuthenticatedUser = {
  id: string;
  clinicId: string;
  clinicName: string;
  email: string;
  fullName: string | null;
  position: string | null;
  specialization: string | null;
  permissions: Permission[];
};

export type AuthenticatedRequest = Request & {
  auth: AuthenticatedUser;
};

export type UserRow = {
  id: string;
  clinic_id: string;
  clinic_name: string;
  email: string;
  password_hash: string | null;
  full_name: string | null;
  position: string | null;
  specialization: string | null;
  blocked_at: Date | null;
  permissions: string[];
};
import type { Request } from 'express';

