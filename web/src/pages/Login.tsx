import { useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api";
import { useAuth } from "../auth";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500";
const button = "w-full rounded-lg bg-sky-600 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-50";

export default function Login() {
  const { startSession, expired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api("/auth/login", "POST", { email, password }, false);
      if (r.mfaRequired) setMfaToken(r.mfaToken);
      else await startSession(r as Session);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => startSession(await api<Session>("/auth/login/mfa", "POST", { mfaToken, code }, false)));
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-sky-700 text-center">SIGO-Dental</h1>
        <p className="text-center text-sm text-slate-500 mb-6">Gestión odontológica</p>

        {expired && <p className="mb-4 rounded bg-amber-50 p-2 text-sm text-amber-800">Tu sesión se cerró por inactividad.</p>}
        {error && <p role="alert" className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        {!mfaToken ? (
          <form onSubmit={submitCredentials} className="space-y-4">
            <label className="block text-sm">
              Correo
              <input className={input} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block text-sm">
              Contraseña
              <input className={input} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className={button} disabled={busy}>Ingresar</button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="space-y-4">
            <p className="text-sm text-slate-600">Ingresa el código de 6 dígitos de tu app autenticadora.</p>
            <input
              className={`${input} text-center tracking-widest text-lg`}
              inputMode="numeric"
              maxLength={6}
              pattern="\d{6}"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className={button} disabled={busy || code.length !== 6}>Verificar</button>
            <button type="button" className="w-full text-sm text-slate-500" onClick={() => { setMfaToken(null); setCode(""); }}>
              Volver
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
