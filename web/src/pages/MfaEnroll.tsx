import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api";
import { useAuth } from "../auth";

export default function MfaEnroll() {
  const { startSession, logout } = useAuth();
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ secret: string }>("/auth/mfa/setup", "POST")
      .then((r) => setSecret(r.secret))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Error"));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await startSession(await api<Session>("/auth/mfa/enable", "POST", { code }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-sky-700">Activa la verificación en dos pasos</h1>
        <p className="text-sm text-slate-600">
          Tu rol maneja datos clínicos o financieros, así que el MFA es obligatorio. Agrega esta clave en Google Authenticator
          (o similar) y escribe el código que muestre.
        </p>
        <code className="block break-all rounded bg-slate-100 p-3 text-center text-sm select-all">{secret || "…"}</code>
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center tracking-widest text-lg"
          inputMode="numeric"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <button className="w-full rounded-lg bg-sky-600 py-2 font-medium text-white disabled:opacity-50" disabled={code.length !== 6}>
          Activar
        </button>
        <button type="button" className="w-full text-sm text-slate-500" onClick={logout}>
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
