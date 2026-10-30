import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Usuario { id: string; name: string; email: string; role: string; activo: boolean; mfaEnabled: boolean; especialidad: string | null }

const ROLES: Record<string, string> = {
  ADMIN: "Administrador",
  ODONTOLOGO: "Odontólogo",
  RECEPCIONISTA: "Recepcionista / Cajero",
  ASISTENTE: "Asistente dental",
  AUDITOR: "Auditor / Contador",
};
const CON_MFA = ["ODONTOLOGO", "RECEPCIONISTA", "ASISTENTE", "AUDITOR"];
const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");

function Nuevo({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", role: "RECEPCIONISTA", password: "", especialidad: "" });
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/usuarios", "POST", { ...f, especialidad: f.role === "ODONTOLOGO" && f.especialidad ? f.especialidad : undefined });
      onDone();
    } catch (x) {
      setError(msg(x));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-semibold">Nuevo usuario</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Nombre completo<input className={field} required minLength={3} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Correo<input className={field} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Rol<select className={field} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {f.role === "ODONTOLOGO" && <label>Especialidad<input className={field} placeholder="Odontología general" value={f.especialidad} onChange={(e) => setF({ ...f, especialidad: e.target.value })} /></label>}
        <label>Contraseña inicial<input className={field} type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      </div>
      <p className="text-xs text-slate-500">
        Mínimo 8 caracteres con letras y números.{CON_MFA.includes(f.role) && " Este rol deberá activar la verificación en dos pasos en su primer ingreso."}
      </p>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Crear usuario</button>
        <button type="button" onClick={onDone} className="px-3 py-2 text-slate-600">Cancelar</button>
      </div>
    </form>
  );
}

function CambiarPassword({ u, onClose }: { u: Usuario; onClose: (ok: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/usuarios/${u.id}/password`, "POST", { password });
      onClose(true);
    } catch (x) {
      setError(msg(x));
    }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Restablecer contraseña" className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 text-sm shadow-lg">
        <h3 className="font-semibold">Nueva contraseña para {u.name}</h3>
        <p className="text-slate-600">Se cerrarán sus sesiones abiertas.</p>
        <input className={field} type="password" required minLength={8} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => onClose(false)} className="px-3 py-1.5 text-slate-600">Cancelar</button>
          <button className="rounded-lg bg-sky-600 px-4 py-1.5 text-white">Guardar</button>
        </div>
      </form>
    </div>
  );
}

export default function Usuarios() {
  const { me } = useAuth();
  const [lista, setLista] = useState<Usuario[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [pwd, setPwd] = useState<Usuario | null>(null);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  const cargar = () => api<Usuario[]>("/usuarios").then(setLista);
  useEffect(() => {
    cargar();
  }, []);

  async function accion(fn: () => Promise<unknown>, ok: string) {
    setError("");
    setAviso("");
    try {
      await fn();
      setAviso(ok);
      await cargar();
    } catch (x) {
      setError(msg(x));
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold">Usuarios</h2>
        {!nuevo && <button onClick={() => setNuevo(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-white">Nuevo usuario</button>}
      </div>
      {nuevo && <Nuevo onDone={() => { setNuevo(false); cargar(); }} />}
      {aviso && <p className="rounded bg-green-50 p-2 text-sm text-green-800">{aviso}</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>{["Usuario", "Rol", "Estado", "MFA", "Acciones"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {lista.map((u) => {
              const yo = u.id === me?.id;
              return (
                <tr key={u.id} className={`border-t border-slate-100 align-top ${u.activo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.name}{yo && <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800">tú</span>}</div>
                    <div className="text-xs text-slate-500">{u.email}{u.especialidad ? ` · ${u.especialidad}` : ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    {yo ? (
                      ROLES[u.role]
                    ) : (
                      <select aria-label={`Rol de ${u.name}`} className="rounded border border-slate-300 px-2 py-1" value={u.role}
                        onChange={(e) => accion(() => api(`/usuarios/${u.id}`, "PATCH", { role: e.target.value }), `Rol de ${u.name} actualizado; sus sesiones se cerraron.`)}>
                        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${u.activo ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}`}>{u.activo ? "Activo" : "Desactivado"}</span></td>
                  <td className="px-3 py-2 text-xs">{u.mfaEnabled ? "Activo" : CON_MFA.includes(u.role) ? "Pendiente de activar" : "No requerido"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {!yo && (
                        <button className="rounded border border-slate-300 px-2 py-0.5"
                          onClick={() => (u.activo ? confirm(`¿Desactivar a ${u.name}? Perderá el acceso de inmediato.`) : true) && accion(() => api(`/usuarios/${u.id}`, "PATCH", { activo: !u.activo }), `Se ${u.activo ? "desactivó" : "activó"} la cuenta de ${u.name}.`)}>
                          {u.activo ? "Desactivar" : "Activar"}
                        </button>
                      )}
                      <button className="rounded border border-slate-300 px-2 py-0.5" onClick={() => setPwd(u)}>Contraseña</button>
                      {u.mfaEnabled && (
                        <button className="rounded border border-amber-400 px-2 py-0.5"
                          onClick={() => confirm(`¿Restablecer el MFA de ${u.name}? Tendrá que activarlo de nuevo al ingresar.`) && accion(() => api(`/usuarios/${u.id}/reset-mfa`, "POST"), `MFA de ${u.name} restablecido.`)}>
                          Restablecer MFA
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pwd && <CambiarPassword u={pwd} onClose={(ok) => { if (ok) setAviso(`Contraseña de ${pwd.name} restablecida; sus sesiones se cerraron.`); setPwd(null); }} />}
    </section>
  );
}
