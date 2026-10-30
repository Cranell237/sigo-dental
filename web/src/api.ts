export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Session {
  token: string;
  refreshToken: string;
  user: User;
  mfaEnrollRequired?: boolean;
}

const KEY = "sigo.session";
let session: Session | null = null;
let onExpire: () => void = () => {};

try {
  session = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
} catch {
  session = null;
}

export const getSession = () => session;
export const setOnExpire = (fn: () => void) => (onExpire = fn);

export function setSession(s: Session | null) {
  session = s;
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

async function raw(path: string, method: string, body?: unknown, auth = true) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && session) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, data };
}

/** Rota el refresh token. Falla si pasaron más de 15 min sin actividad. */
async function refresh(): Promise<boolean> {
  if (!session) return false;
  const { res, data } = await raw("/auth/refresh", "POST", { refreshToken: session.refreshToken }, false);
  if (!res.ok) return false;
  setSession({ ...session, token: data.token, refreshToken: data.refreshToken });
  return true;
}

export async function api<T = any>(path: string, method = "GET", body?: unknown, auth = true): Promise<T> {
  let { res, data } = await raw(path, method, body, auth);
  if (res.status === 401 && auth && session) {
    if (await refresh()) ({ res, data } = await raw(path, method, body, auth));
    else onExpire();
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Error de red", data);
  return data as T;
}
