export type Permission =
  | 'requests:use'
  | 'admin:access'
  | 'admin:clinics:manage'
  | 'admin:users:manage';

export interface AuthUser {
  id: string;
  clinicId: string;
  clinicName: string;
  email: string;
  fullName: string | null;
  position: string | null;
  specialization: string | null;
  permissions: Permission[];
}

export interface Clinic {
  id: string;
  name: string;
  userCount: number;
  createdAt: string;
}

export interface AdminUser extends AuthUser {
  blocked: boolean;
  blockedAt: string | null;
  passwordCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

