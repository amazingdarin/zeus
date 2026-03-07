import { getServerUrl } from '../config/api';

export interface LoginRequest {
  email: string;
  password: string;
  remember_me?: boolean;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  display_name?: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  status: string;
  created_at: string;
  language: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

const AUTH_TOKEN_KEY = 'zeus_access_token';
const REFRESH_TOKEN_KEY = 'zeus_refresh_token';
const REMEMBERED_EMAIL_KEY = 'zeus_remembered_email';

export function getAccessToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getRememberedEmail(): string | null {
  return localStorage.getItem(REMEMBERED_EMAIL_KEY);
}

export function setRememberedEmail(email: string) {
  localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
}

export function clearRememberedEmail() {
  localStorage.removeItem(REMEMBERED_EMAIL_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const response = await fetch(`${getServerUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Login failed');
  }
  
  const result = await response.json();
  setTokens(result.access_token, result.refresh_token);
  
  // 如果选择了"记住密码"，保存邮箱
  if (data.remember_me) {
    setRememberedEmail(data.email);
  } else {
    clearRememberedEmail();
  }
  
  return result;
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await fetch(`${getServerUrl()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Registration failed');
  }
  
  const result = await response.json();
  setTokens(result.access_token, result.refresh_token);
  return result;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  
  if (refreshToken) {
    try {
      await fetch(`${getServerUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch (error) {
      // Ignore logout errors
    }
  }
  
  clearTokens();
}

export async function refreshAccessToken(): Promise<RefreshResponse | null> {
  const refreshToken = getRefreshToken();
  
  if (!refreshToken) {
    return null;
  }
  
  const response = await fetch(`${getServerUrl()}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  
  if (!response.ok) {
    clearTokens();
    return null;
  }
  
  const result = await response.json();
  setTokens(result.access_token, result.refresh_token);
  return result;
}

export async function getCurrentUser(): Promise<User | null> {
  const token = getAccessToken();
  
  if (!token) {
    return null;
  }
  
  const response = await fetch(`${getServerUrl()}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      // Try to refresh token
      const refreshResult = await refreshAccessToken();
      if (refreshResult) {
        return getCurrentUser();
      }
      clearTokens();
    }
    return null;
  }
  
  return response.json();
}
