import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Sillon { id: string; nombre: string }
interface Consultorio { id: string; nombre: string; sillones: Sillon[] }
interface Profesional { id: string; nombre: string; especialidad: string }
interface PacienteMin { id: string; nombres: string; apellidos: string; alertas: string[] }
interface Cita {
  id: string;
  inicio: string;
  fin: string;
  estado: string;
  motivo?: string | null;
  patient: { id: string; nombres: string; apellidos: string };
  profesional: Profesional;
  sillon: Sillon & { consultorio: { nombre: string } };
}

const ETIQUETA: Record<string, string> = {
  PROGRAMADO: "Programado",
  CONFIRMADO: "Confirmado",
  EN_SALA_ESPERA: "En sala de espera",
  EN_ATENCION: "En atención",
  ATENDIDO: "Atendido",
  CANCELADO: "Cancelado",
  NO_ASISTIO: "No asistió",
};
const COLOR: Record<string, string> = {
  PROGRAMADO: "bg-slate-100 text-slate-700",
  CONFIRMADO: "bg-sky-100 text-sky-800",
  EN_SALA_ESPERA: "bg-amber-100 text-amber-800",
  EN_ATENCION: "bg-violet-100 text-violet-800",
  ATENDIDO: "bg-green-100 text-green-800",
  CANCELADO: "bg-red-100 text-red-800",
  NO_ASISTIO: "bg-orange-100 text-orange-800",
};
// Mismas transiciones que valida el API (RF-10).
const SIGUIENTES: Record<string, string[]> = {
  PROGRAMADO: ["CONFIRMADO", "CANCELADO", "NO_ASISTIO"],
  CONFIRMADO: ["EN_SALA_ESPERA", "CANCELADO", "NO_ASISTIO"],
  EN_SALA_ESPERA: ["EN_ATENCION", "CANCELADO", "NO_ASISTIO"],
  EN_ATENCION: ["ATENDIDO"],
  ATENDIDO: [],
  CANCELADO: [],
  NO_ASISTIO: [],
};

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

function NuevaCita({ consultorios, profesionales, dia, onDone }: { consultorios: Consultorio[]; profesionales: Profesional[]; dia: string; onDone: () => void }) {
  const sillones = consultorios.flatMap((c) => c.sillones.map((s) => ({ ...s, label: `${c.nombre} · ${s.nombre}` })));
  const [pacientes, setPacientes] = useState<PacienteMin[]>([]);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ patientId: "", profesionalId: profesionales[0]?.id ?? "", sillonId: sillones[0]?.id ?? "", inicio: `${dia}T09:00`, fin: `${dia}T09:30`, motivo: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api<PacienteMin[]>(`/pacientes?q=${encodeURIComponent(q)}`).then(setPacientes);
  }, [q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/citas", "POST", {
        ...f,
        inicio: new Date(f.inicio).toISOString(),
        fin: new Date(f.fin).toISOString(),
        motivo: f.motivo || undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Nueva cita</h3>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Buscar paciente
          <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cédula o nombre" />
        </label>
        <label className="block text-sm">Paciente
          <select className={field} required value={f.patientId} onChange={(e) => setF({ ...f, patientId: e.target.value })}>
            <option value="">Selecciona…</option>
            {pacientes.map((p) => <option key={p.id} value={p.id}>{p.apellidos}, {p.nombres}{p.alertas.length ? " ⚠" : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm">Profesional
          <select className={field} value={f.profesionalId} onChange={(e) => setF({ ...f, profesionalId: e.target.value })}>
            {profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="block text-sm">Sillón
          <select className={field} value={f.sillonId} onChange={(e) => setF({ ...f, sillonId: e.target.value })}>
            {sillones.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">Inicio<input className={field} type="datetime-local" required value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></label>
        <label className="block text-sm">Fin<input className={field} type="datetime-local" required value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></label>
      </div>
      <label className="block text-sm">Motivo<input className={field} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></label>
      <div className="flex gap-3">
        <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Agendar</button>
        <button type="button" onClick={onDone} className="px-4 py-2 text-slate-600">Cancelar</button>
      </div>
    </form>
  );
}

export default function Agenda() {
  const { me } = useAuth();
  const puedeEditar = me?.permissions.includes("agenda:gestionar");
  const [dia, setDia] = useState(toDate(new Date()));
  const [semana, setSemana] = useState(false);
  const [sillonId, setSillonId] = useState("");
  const [profesionalId, setProfesionalId] = useState("");
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Consultorio[]>("/catalogos/consultorios").then(setConsultorios);
    api<Profesional[]>("/catalogos/profesionales").then(setProfesionales);
  }, []);

  const cargar = useCallback(() => {
    const desde = new Date(`${dia}T00:00`);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + (semana ? 7 : 1));
    const qs = new URLSearchParams({ desde: desde.toISOString(), hasta: hasta.toISOString() });
    if (sillonId) qs.set("sillonId", sillonId);
    if (profesionalId) qs.set("profesionalId", profesionalId);
    api<Cita[]>(`/citas?${qs}`).then(setCitas);
  }, [dia, semana, sillonId, profesionalId]);
  useEffect(cargar, [cargar]);

  async function cambiarEstado(id: string, estado: string) {
    setError("");
    try {
      await api(`/citas/${id}/estado`, "PATCH", { estado });
      cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error");
    }
  }

  if (nueva) return <NuevaCita consultorios={consultorios} profesionales={profesionales} dia={dia} onDone={() => { setNueva(false); cargar(); }} />;

  const porDia = citas.reduce<Record<string, Cita[]>>((acc, c) => {
    (acc[toDate(new Date(c.inicio))] ??= []).push(c);
    return acc;
  }, {});

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-lg font-semibold">Agenda</h2>
        <label className="text-sm">Fecha<input className={field} type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
        <label className="text-sm">Vista
          <select className={field} value={semana ? "semana" : "dia"} onChange={(e) => setSemana(e.target.value === "semana")}><option value="dia">Día</option><option value="semana">Semana</option></select>
        </label>
        <label className="text-sm">Sillón
          <select className={field} value={sillonId} onChange={(e) => setSillonId(e.target.value)}>
            <option value="">Todos</option>
            {consultorios.flatMap((c) => c.sillones.map((s) => <option key={s.id} value={s.id}>{c.nombre} · {s.nombre}</option>))}
          </select>
        </label>
        <label className="text-sm">Profesional
          <select className={field} value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)}>
            <option value="">Todos</option>
            {profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        {puedeEditar && <button onClick={() => setNueva(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-white">Nueva cita</button>}
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {!citas.length && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">No hay citas en este periodo.</p>}
      {Object.entries(porDia).map(([d, lista]) => (
        <div key={d}>
          {semana && <h3 className="mb-2 text-sm font-semibold text-slate-600">{new Date(`${d}T12:00`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" })}</h3>}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {lista.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-28 font-mono text-sm">{hhmm(c.inicio)}–{hhmm(c.fin)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{c.patient.apellidos}, {c.patient.nombres}</span>
                  <span className="block text-sm text-slate-500">{c.sillon.consultorio.nombre} · {c.sillon.nombre} · {c.profesional.nombre}{c.motivo ? ` · ${c.motivo}` : ""}</span>
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${COLOR[c.estado]}`}>{ETIQUETA[c.estado]}</span>
                {puedeEditar && SIGUIENTES[c.estado].map((e) => (
                  <button key={e} onClick={() => cambiarEstado(c.id, e)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">→ {ETIQUETA[e]}</button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
