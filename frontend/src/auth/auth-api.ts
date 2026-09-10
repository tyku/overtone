import { apiCall } from '../shared/api-client';
import type { AdminUser, AuthUser, Clinic, Permission } from './auth.types';

export class AuthApi {
  session() {
    return apiCall<{ user: AuthUser }>('/api/auth/session');
  }

  login(email: string, password: string) {
    return apiCall<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }

  logout() {
    return apiCall<{ loggedOut: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  }

  updateProfile(input: {
    fullName: string | null;
    position: string | null;
    specialization: string | null;
  }) {
    return apiCall<{ user: AuthUser }>('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
}

export class AdminApi {
  clinics() {
    return apiCall<{ items: Clinic[] }>('/api/admin/clinics');
  }

  createClinic(name: string) {
    return apiCall<Clinic>('/api/admin/clinics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  users() {
    return apiCall<{ items: AdminUser[] }>('/api/admin/users');
  }

  createUser(input: {
    email: string;
    clinicId: string;
    fullName: string | null;
    position: string | null;
    specialization: string | null;
    permissions: Permission[];
  }) {
    return apiCall<{ user: AdminUser; password: string }>('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  updateUser(id: string, input: Partial<{
    clinicId: string;
    fullName: string | null;
    position: string | null;
    specialization: string | null;
    permissions: Permission[];
    blocked: boolean;
  }>) {
    return apiCall<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  regeneratePassword(id: string) {
    return apiCall<{ user: AdminUser; password: string }>(
      `/api/admin/users/${encodeURIComponent(id)}/regenerate-password`,
      { method: 'POST' },
    );
  }
}

