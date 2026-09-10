import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiClientError } from '../shared/api-client';
import { AuthApi } from './auth-api';
import type { AuthUser } from './auth.types';

const authApi = new AuthApi();

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateProfile(input: {
    fullName: string | null;
    position: string | null;
    specialization: string | null;
  }): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void authApi
      .session()
      .then((result) => setUser(result.user))
      .catch((cause) => {
        if (!(cause instanceof ApiClientError) || cause.status !== 401) {
          setError(cause instanceof Error ? cause.message : 'Ошибка загрузки сессии');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      async login(email, password) {
        const result = await authApi.login(email, password);
        setUser(result.user);
        setError('');
      },
      async logout() {
        try {
          await authApi.logout();
        } finally {
          setUser(null);
        }
      },
      async updateProfile(input) {
        const result = await authApi.updateProfile(input);
        setUser(result.user);
      },
    }),
    [error, loading, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}

