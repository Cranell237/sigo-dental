import { useState, type FormEvent } from "react";
import { ApiError } from "../api";

/** Re-autenticación para firmar (firma simple: contraseña + sello del contenido en el servidor). */
export function PasswordDialog({ titulo, descripcion, conTexto, onSubmit, onCancel }: { titulo: string; descripcion?: string; conTexto?: boolean; onSubmit: (password: string, texto: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await onSubmit(password, texto);
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Error");
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg">
        <h3 className="font-semibold">{titulo}</h3>
        {descripcion && <p className="text-sm text-slate-600">{descripcion}</p>}
        {conTexto && <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={3} required minLength={5} placeholder="Texto de la adenda" value={texto} onChange={(e) => setTexto(e.target.value)} />}
        <label className="block text-sm">Tu contraseña para firmar
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-slate-600">Cancelar</button>
          <button className="rounded-lg bg-sky-600 px-4 py-1.5 text-white">Firmar</button>
        </div>
      </form>
    </div>
  );
}
