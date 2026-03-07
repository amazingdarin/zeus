import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setAppLocale } from '../i18n/runtime';
import { User, getCurrentUser, login as apiLogin, register as apiRegister, logout as apiLogout, LoginRequest, RegisterRequest, getAccessToken } from '../api/auth';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      if (currentUser?.language) {
        void setAppLocale(currentUser.language);
      }
    } catch (error) {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const token = getAccessToken();
      if (token) {
        await refreshUser();
      }
      setIsLoading(false);
    };
    initAuth();
  }, [refreshUser]);

  const login = useCallback(async (data: LoginRequest) => {
    const result = await apiLogin(data);
    setUser(result.user);
    if (result.user.language) {
      await setAppLocale(result.user.language);
    }
  }, []);

  const register = useCallback(async (data: RegisterRequest) => {
    const result = await apiRegister(data);
    setUser(result.user);
    if (result.user.language) {
      await setAppLocale(result.user.language);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
