import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Item { id: string; fase: number; sesion: number; descripcion: string; diente?: string | null; cantidad: number; precioUnitario: number; costoLaboratorio: number; estado: string }
interface Totales { subtotal: number; descuento: number; total: number; totalAprobado: number; porFase: Record<string, number> }
interface Presupuesto { id: string; estado: string; createdAt: string; items: Item[]; totales: Totales }
interface Pac { id: string; nombres: string; apellidos: string; cedula: string }
interface Proc { id: string; nombre: string; precioBase: number }
interface Consultorio { sillones: { id: string; nombre: string }[]; nombre: string }
interface Profesional { id: string; nombre: string }

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const aCentavos = (s: string) => Math.round(parseFloat((s || "0").replace(",", ".")) * 100) || 0;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");
const totalItem = (i: Item) => i.cantidad * i.precioUnitario + i.costoLaboratorio;

const ESTADO: Record<string, string> = { BORRADOR: "Borrador", PRESENTADO: "Presentado", APROBADO: "Aprobado", APROBADO_PARCIAL: "Aprobado parcial", RECHAZADO: "Rechazado", PENDIENTE: "Pendiente", AGENDADO: "Agendado" };

function Nuevo({ pid, procs, onDone }: { pid: string; procs: Proc[]; onDone: () => void }) {
  type Fila = { fase: string; sesion: string; procedimientoId: string; diente: string; cantidad: string; lab: string; honorario: string };
  const vacia = (): Fila => ({ fase: "1", sesion: "1", procedimientoId: procs[0]?.id ?? "", diente: "", cantidad: "1", lab: "", honorario: "" });
  const [filas, setFilas] = useState<Fila[]>([vacia()]);
  const [descuento, setDescuento] = useState("");
  const [error, setError] = useState("");
  const set = (i: number, k: keyof Fila, v: string) => setFilas(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/presupuestos", "POST", {
        patientId: pid,
        descuento: aCentavos(descuento),
        items: filas.map((f) => ({ fase: +f.fase, sesion: +f.sesion, procedimientoId: f.procedimientoId, diente: f.diente || undefined, cantidad: +f.cantidad, costoLaboratorio: aCentavos(f.lab), honorario: aCentavos(f.honorario) })),
      });
      onDone();
    } catch (x) {
      setError(msg(x));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Nuevo presupuesto</h3>
      {filas.map((f, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-3 sm:grid-cols-6">
          <label className="text-xs">Fase<input className={field} type="number" min={1} value={f.fase} onChange={(e) => set(i, "fase", e.target.value)} /></label>
          <label className="text-xs">Sesión<input className={field} type="number" min={1} value={f.sesion} onChange={(e) => set(i, "sesion", e.target.value)} /></label>
          <label className="col-span-2 text-xs sm:col-span-2">Procedimiento
            <select className={field} value={f.procedimientoId} onChange={(e) => set(i, "procedimientoId", e.target.value)}>{procs.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {usd(p.precioBase)}</option>)}</select>
          </label>
          <label className="text-xs">Diente<input className={field} value={f.diente} onChange={(e) => set(i, "diente", e.target.value)} /></label>
          <label className="text-xs">Cantidad<input className={field} type="number" min={1} value={f.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} /></label>
          <label className="text-xs">Laboratorio (USD)<input className={field} inputMode="decimal" value={f.lab} onChange={(e) => set(i, "lab", e.target.value)} /></label>
          <label className="text-xs">Honorario/u. (USD)<input className={field} inputMode="decimal" value={f.honorario} onChange={(e) => set(i, "honorario", e.target.value)} /></label>
          {filas.length > 1 && <button type="button" className="text-xs text-red-700" onClick={() => setFilas(filas.filter((_, j) => j !== i))}>Quitar</button>}
        </div>
      ))}
      <button type="button" className="text-sm text-sky-700" onClick={() => setFilas([...filas, { ...vacia(), fase: filas[filas.length - 1].fase }])}>+ Agregar ítem</button>
      <label className="block max-w-48 text-sm">Descuento autorizado (USD)<input className={field} inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} /></label>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Guardar borrador</button>
        <button type="button" onClick={onDone} className="px-3 py-2 text-slate-600">Cancelar</button>
      </div>
    </form>
  );
}

function Tarjeta({ p, puedeGestionar, puedeAprobar, puedeAgendar, onChange, consultorios, profesionales }: { p: Presupuesto; puedeGestionar: boolean; puedeAprobar: boolean; puedeAgendar: boolean; onChange: () => void; consultorios: Consultorio[]; profesionales: Profesional[] }) {
  const [elegidos, setElegidos] = useState<Set<string>>(new Set(p.items.map((i) => i.id)));
  const [agendando, setAgendando] = useState<Item | null>(null);
  const [cita, setCita] = useState({ sillonId: "", profesionalId: "", inicio: "", fin: "" });
  const [error, setError] = useState("");
  const sillones = consultorios.flatMap((c) => c.sillones.map((s) => ({ id: s.id, label: `${c.nombre} · ${s.nombre}` })));

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      onChange();
    } catch (x) {
      setError(msg(x));
    }
  }

  const fases = [...new Set(p.items.map((i) => i.fase))];
  return (
    <article className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <header className="flex flex-wrap items-center gap-2">
        <b>{new Date(p.createdAt).toLocaleDateString("es-EC")}</b>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{ESTADO[p.estado]}</span>
        <span className="ml-auto">Total <b>{usd(p.totales.total)}</b>{p.totales.descuento > 0 && <span className="text-slate-500"> (desc. {usd(p.totales.descuento)})</span>}</span>
      </header>
      {fases.map((f) => (
        <div key={f}>
          <p className="mb-1 text-xs font-semibold text-slate-500">Fase {f} · {usd(p.totales.porFase[f])}</p>
          <ul className="divide-y divide-slate-100 rounded border border-slate-100">
            {p.items.filter((i) => i.fase === f).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                {p.estado === "PRESENTADO" && puedeAprobar && (
                  <input type="checkbox" aria-label={`Aprobar ${i.descripcion}`} checked={elegidos.has(i.id)} onChange={(e) => setElegidos((s) => { const n = new Set(s); e.target.checked ? n.add(i.id) : n.delete(i.id); return n; })} />
                )}
                <span className="w-16 text-xs text-slate-500">Ses. {i.sesion}</span>
                <span className="min-w-0 flex-1">{i.cantidad} × {i.descripcion}{i.diente ? ` (diente ${i.diente})` : ""}{i.costoLaboratorio > 0 && <span className="text-xs text-slate-500"> + lab {usd(i.costoLaboratorio)}</span>}</span>
                <span>{usd(totalItem(i))}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${i.estado === "APROBADO" ? "bg-green-100 text-green-800" : i.estado === "AGENDADO" ? "bg-sky-100 text-sky-800" : i.estado === "RECHAZADO" ? "bg-red-100 text-red-800" : "bg-slate-100"}`}>{ESTADO[i.estado]}</span>
                {i.estado === "APROBADO" && puedeAgendar && <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => setAgendando(i)}>Agendar</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {p.estado !== "BORRADOR" && p.estado !== "PRESENTADO" && <p className="text-xs text-slate-600">Total aprobado por el paciente: <b>{usd(p.totales.totalAprobado)}</b></p>}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {p.estado === "BORRADOR" && puedeGestionar && <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-white" onClick={() => run(() => api(`/presupuestos/${p.id}/presentar`, "POST"))}>Presentar al paciente</button>}
        {p.estado === "PRESENTADO" && puedeAprobar && (
          <button className="rounded-lg bg-green-700 px-3 py-1.5 text-white" onClick={() => run(() => api(`/presupuestos/${p.id}/aprobar`, "POST", { itemIds: [...elegidos] }))}>
            {elegidos.size === p.items.length ? "Registrar aprobación total" : `Registrar aprobación parcial (${elegidos.size} de ${p.items.length})`}
          </button>
        )}
      </div>
      {agendando && (
        <form
          className="flex flex-wrap items-end gap-2 rounded border border-sky-200 bg-sky-50 p-3"
          onSubmit={(e) => { e.preventDefault(); run(async () => { await api(`/presupuestos/items/${agendando.id}/agendar`, "POST", { ...cita, inicio: new Date(cita.inicio).toISOString(), fin: new Date(cita.fin).toISOString() }); setAgendando(null); }); }}
        >
          <p className="w-full font-medium">Agendar: {agendando.descripcion}</p>
          <label className="text-xs">Sillón<select className={field} required value={cita.sillonId} onChange={(e) => setCita({ ...cita, sillonId: e.target.value })}><option value="">…</option>{sillones.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="text-xs">Profesional<select className={field} required value={cita.profesionalId} onChange={(e) => setCita({ ...cita, profesionalId: e.target.value })}><option value="">…</option>{profesionales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
          <label className="text-xs">Inicio<input className={field} type="datetime-local" required value={cita.inicio} onChange={(e) => setCita({ ...cita, inicio: e.target.value })} /></label>
          <label className="text-xs">Fin<input className={field} type="datetime-local" required value={cita.fin} onChange={(e) => setCita({ ...cita, fin: e.target.value })} /></label>
          <button className="rounded bg-sky-600 px-3 py-1.5 text-white">Crear cita</button>
          <button type="button" className="px-2 text-slate-600" onClick={() => setAgendando(null)}>Cancelar</button>
        </form>
      )}
    </article>
  );
}

export default function Presupuestos() {
  const { me } = useAuth();
  const can = (p: string) => !!me?.permissions.includes(p);
  const [q, setQ] = useState("");
  const [pacientes, setPacientes] = useState<Pac[]>([]);
  const [paciente, setPaciente] = useState<Pac | null>(null);
  const [lista, setLista] = useState<Presupuesto[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [nuevo, setNuevo] = useState(false);

  useEffect(() => {
    api<Pac[]>(`/pacientes?q=${encodeURIComponent(q)}`).then(setPacientes);
  }, [q]);
  useEffect(() => {
    api<Proc[]>("/catalogos/procedimientos").then(setProcs);
    api<Consultorio[]>("/catalogos/consultorios").then(setConsultorios);
    api<Profesional[]>("/catalogos/profesionales").then(setProfesionales);
  }, []);
  const cargar = () => paciente && api<Presupuesto[]>(`/presupuestos?patientId=${paciente.id}`).then(setLista);
  useEffect(() => {
    cargar();
  }, [paciente]);

  if (!paciente) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Presupuestos</h2>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Buscar paciente por cédula o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {pacientes.map((p) => <li key={p.id}><button onClick={() => setPaciente(p)} className="w-full px-4 py-3 text-left hover:bg-slate-50"><b>{p.apellidos}, {p.nombres}</b> <span className="text-sm text-slate-500">{p.cedula}</span></button></li>)}
        </ul>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <button onClick={() => { setPaciente(null); setNuevo(false); }} className="text-sm text-sky-700">← Cambiar paciente</button>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Presupuestos de {paciente.nombres} {paciente.apellidos}</h2>
        {can("presupuestos:gestionar") && !nuevo && <button onClick={() => setNuevo(true)} className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-white">Nuevo presupuesto</button>}
      </div>
      {nuevo && <Nuevo pid={paciente.id} procs={procs} onDone={() => { setNuevo(false); cargar(); }} />}
      {lista.map((p) => (
        <Tarjeta key={p.id + p.estado + p.items.map((i) => i.estado).join()} p={p} puedeGestionar={can("presupuestos:gestionar")} puedeAprobar={can("presupuestos:aprobar")} puedeAgendar={can("agenda:gestionar")} onChange={cargar} consultorios={consultorios} profesionales={profesionales} />
      ))}
      {!lista.length && !nuevo && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">Sin presupuestos.</p>}
    </section>
  );
}
