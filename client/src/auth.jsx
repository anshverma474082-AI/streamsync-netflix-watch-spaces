import { createContext, useContext, useEffect, useState } from 'react';
import { api, setTokens, clearTokens, getAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    api.me().then((r) => setUser(r.user)).catch(() => clearTokens()).finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const r = await api.login({ email, password });
    setTokens(r.accessToken, r.refreshToken);
    setUser(r.user);
    return r.user;
  }

  async function register(fields) {
    const r = await api.register(fields);
    setTokens(r.accessToken, r.refreshToken);
    setUser(r.user);
    return r.user;
  }

  function logout() {
    clearTokens();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
