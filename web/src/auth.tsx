import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getSession, setOnExpire, setSession, type Session } from "./api";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  me: Me | null;
  enrollRequired: boolean;
  loading: boolean;
  startSession: (s: Session) => Promise<void>;
  logout: () => Promise<void>;
  expired: boolean;
}

const IDLE_MS = 15 * 60 * 1000; // RNF-05: cierre por 15 min de inactividad
const Ctx = createContext<AuthState>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [enrollRequired, setEnroll] = useState(false);
  const [loading, setLoading] = useState(!!getSession());
  const [expired, setExpired] = useState(false);

  const clear = useCallback(() => {
    setSession(null);
    setMe(null);
    setEnroll(false);
  }, []);

  const startSession = useCallback(async (s: Session) => {
    setSession(s);
    setExpired(false);
    setEnroll(!!s.mfaEnrollRequired);
    setMe(await api<Me>("/auth/me"));
  }, []);

  const logout = useCallback(async () => {
    const s = getSession();
    if (s) await api("/auth/logout", "POST", { refreshToken: s.refreshToken }, false).catch(() => {});
    clear();
  }, [clear]);

  useEffect(() => {
    setOnExpire(() => {
      clear();
      setExpired(true);
    });
    const s = getSession();
    if (!s) return;
    api<Me & { mfaVerified: boolean; mfaEnabled: boolean }>("/auth/me")
      .then((m) => {
        setMe(m);
        setEnroll(!m.mfaVerified && ["ODONTOLOGO", "ASISTENTE", "RECEPCIONISTA", "AUDITOR"].includes(m.role));
      })
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear]);

  // Cierre de sesión tras 15 min sin actividad del usuario.
  useEffect(() => {
    if (!me) return;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        logout().then(() => setExpired(true));
      }, IDLE_MS);
    };
    const events = ["mousemove", "keydown", "click", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [me, logout]);

  return <Ctx.Provider value={{ me, enrollRequired, loading, startSession, logout, expired }}>{children}</Ctx.Provider>;
}
