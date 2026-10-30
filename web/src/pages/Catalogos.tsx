import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

interface Consultorio { id: string; nombre: string; sillones: { id: string; nombre: string }[] }
interface Procedimiento { id: string; codigo: string; nombre: string; precioBase: number }
interface Profesional { id: string; nombre: string; especialidad: string; userId: string | null }

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const aCentavos = (s: string) => Math.round(parseFloat((s || "0").replace(",", ".")) * 100) || 0;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");
const card = "space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm";

export default function Catalogos() {
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [procs, setProcs] = useState<Procedimiento[]>([]);
  const [profs, setProfs] = useState<Profesional[]>([]);
  const [nuevoConsultorio, setNuevoConsultorio] = useState("");
  const [sillon, setSillon] = useState<Record<string, string>>({});
  const [proc, setProc] = useState({ codigo: "", nombre: "", precio: "" });
  const [prof, setProf] = useState({ nombre: "", especialidad: "" });
  const [error, setError] = useState("");

  const cargar = async () => {
    const [c, p, f] = await Promise.all([
      api<Consultorio[]>("/catalogos/consultorios"),
      api<Procedimiento[]>("/catalogos/procedimientos"),
      api<Profesional[]>("/catalogos/profesionales"),
    ]);
    setConsultorios(c);
    setProcs(p);
    setProfs(f);
  };
  useEffect(() => {
    cargar();
  }, []);

  const run = (fn: () => Promise<unknown>, limpiar: () => void) => async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await fn();
      limpiar();
      await cargar();
    } catch (x) {
      setError(msg(x));
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Catálogos</h2>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className={card}>
        <h3 className="font-semibold">Consultorios y sillones</h3>
        <ul className="space-y-2">
          {consultorios.map((c) => (
            <li key={c.id} className="rounded border border-slate-100 p-3">
              <div className="font-medium">{c.nombre}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {c.sillones.map((s) => <span key={s.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{s.nombre}</span>)}
              </div>
              <form className="mt-2 flex gap-2" onSubmit={run(() => api(`/catalogos/consultorios/${c.id}/sillones`, "POST", { nombre: sillon[c.id] }), () => setSillon({ ...sillon, [c.id]: "" }))}>
                <input aria-label={`Nuevo sillón en ${c.nombre}`} className={`${field} flex-1`} placeholder="Nuevo sillón" required value={sillon[c.id] ?? ""} onChange={(e) => setSillon({ ...sillon, [c.id]: e.target.value })} />
                <button className="rounded-lg border border-slate-300 px-3">Agregar</button>
              </form>
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={run(() => api("/catalogos/consultorios", "POST", { nombre: nuevoConsultorio }), () => setNuevoConsultorio(""))}>
          <input aria-label="Nuevo consultorio" className={`${field} flex-1`} placeholder="Nombre del nuevo consultorio" required value={nuevoConsultorio} onChange={(e) => setNuevoConsultorio(e.target.value)} />
          <button className="rounded-lg bg-sky-600 px-4 text-white">Crear consultorio</button>
        </form>
      </div>

      <div className={card}>
        <h3 className="font-semibold">Procedimientos y precios</h3>
        <table className="w-full">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Código</th><th>Procedimiento</th><th className="text-right">Precio base</th></tr></thead>
          <tbody>
            {procs.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="py-1 font-mono">{p.codigo}</td><td>{p.nombre}</td><td className="text-right">{usd(p.precioBase)}</td></tr>)}
          </tbody>
        </table>
        <form className="flex flex-wrap gap-2" onSubmit={run(() => api("/catalogos/procedimientos", "POST", { codigo: proc.codigo, nombre: proc.nombre, precioBase: aCentavos(proc.precio) }), () => setProc({ codigo: "", nombre: "", precio: "" }))}>
          <input aria-label="Código" className={`${field} w-24`} placeholder="Código" required value={proc.codigo} onChange={(e) => setProc({ ...proc, codigo: e.target.value })} />
          <input aria-label="Nombre del procedimiento" className={`${field} min-w-40 flex-1`} placeholder="Nombre" required value={proc.nombre} onChange={(e) => setProc({ ...proc, nombre: e.target.value })} />
          <input aria-label="Precio en dólares" className={`${field} w-28`} inputMode="decimal" placeholder="Precio USD" required value={proc.precio} onChange={(e) => setProc({ ...proc, precio: e.target.value })} />
          <button className="rounded-lg bg-sky-600 px-4 text-white">Agregar</button>
        </form>
      </div>

      <div className={card}>
        <h3 className="font-semibold">Profesionales</h3>
        <ul className="divide-y divide-slate-100">
          {profs.map((p) => (
            <li key={p.id} className="py-1.5">
              {p.nombre} <span className="text-slate-500">· {p.especialidad}</span>
              {!p.userId && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">sin usuario</span>}
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap gap-2" onSubmit={run(() => api("/catalogos/profesionales", "POST", prof), () => setProf({ nombre: "", especialidad: "" }))}>
          <input aria-label="Nombre del profesional" className={`${field} min-w-40 flex-1`} placeholder="Nombre" required value={prof.nombre} onChange={(e) => setProf({ ...prof, nombre: e.target.value })} />
          <input aria-label="Especialidad" className={`${field} min-w-40 flex-1`} placeholder="Especialidad" required value={prof.especialidad} onChange={(e) => setProf({ ...prof, especialidad: e.target.value })} />
          <button className="rounded-lg bg-sky-600 px-4 text-white">Agregar</button>
        </form>
        <p className="text-xs text-slate-500">Para que un odontólogo inicie sesión y firme, créalo desde Usuarios: queda registrado aquí automáticamente.</p>
      </div>
    </section>
  );
}
