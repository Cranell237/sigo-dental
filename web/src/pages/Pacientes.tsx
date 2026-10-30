import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Paciente {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  sexo: string;
  telefono: string;
  email?: string | null;
  emergenciaNombre: string;
  emergenciaTelefono: string;
  tutorNombre?: string | null;
  tutorTelefono?: string | null;
  seguro?: string | null;
  esMenor: boolean;
  alertas: string[];
  anamnesis?: { enfermedades?: string | null; cirugias?: string | null; observaciones?: string | null };
}

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

/** Badge de alta visibilidad para alergias y condiciones críticas (RF-02). */
export function AlertBadges({ alertas }: { alertas: string[] }) {
  if (!alertas.length) return null;
  return (
    <div role="alert" className="flex flex-wrap gap-2">
      {alertas.map((a) => (
        <span key={a} className="rounded-full bg-red-600 px-3 py-1 text-sm font-semibold text-white">⚠ {a}</span>
      ))}
    </div>
  );
}

function Detalle({ id, onBack }: { id: string; onBack: () => void }) {
  const [p, setP] = useState<Paciente | null>(null);
  useEffect(() => {
    api<Paciente>(`/pacientes/${id}`).then(setP);
  }, [id]);
  if (!p) return <p className="text-slate-500">Cargando…</p>;
  const fila = (k: string, v?: string | null) => (v ? <div><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div> : null);
  return (
    <section className="space-y-4">
      <button onClick={onBack} className="text-sm text-sky-700">← Volver</button>
      <header className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="text-xl font-semibold">{p.nombres} {p.apellidos}</h2>
        <AlertBadges alertas={p.alertas} />
      </header>
      <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        {fila("Cédula", p.cedula)}
        {fila("Nacimiento", p.fechaNacimiento.slice(0, 10) + (p.esMenor ? " (menor de edad)" : ""))}
        {fila("Teléfono", p.telefono)}
        {fila("Correo", p.email)}
        {fila("Contacto de emergencia", `${p.emergenciaNombre} · ${p.emergenciaTelefono}`)}
        {fila("Tutor legal", p.tutorNombre && `${p.tutorNombre} · ${p.tutorTelefono}`)}
        {fila("Seguro / convenio", p.seguro)}
        {fila("Enfermedades sistémicas", p.anamnesis?.enfermedades)}
        {fila("Antecedentes quirúrgicos", p.anamnesis?.cirugias)}
        {fila("Observaciones", p.anamnesis?.observaciones)}
      </dl>
    </section>
  );
}

function Nuevo({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ sexo: "F" });
  const [alergias, setAlergias] = useState("");
  const [anticoagulado, setAnti] = useState(false);
  const [coagulopatia, setCoag] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
    body.anamnesis = {
      alergias: alergias.split(",").map((s) => s.trim()).filter(Boolean),
      anticoagulado,
      coagulopatia,
      enfermedades: f.enfermedades || undefined,
      cirugias: f.cirugias || undefined,
      observaciones: f.observaciones || undefined,
    };
    for (const k of ["enfermedades", "cirugias", "observaciones"]) delete body[k];
    try {
      await api("/pacientes", "POST", body);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  const input = (k: string, label: string, props: object = {}) => (
    <label className="block text-sm">{label}<input className={field} value={f[k] ?? ""} onChange={set(k)} {...props} /></label>
  );

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Nuevo paciente</h2>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {input("cedula", "Cédula", { required: true })}
        {input("nombres", "Nombres", { required: true })}
        {input("apellidos", "Apellidos", { required: true })}
        {input("fechaNacimiento", "Fecha de nacimiento", { type: "date", required: true })}
        <label className="block text-sm">Sexo
          <select className={field} value={f.sexo} onChange={set("sexo")}><option value="F">Femenino</option><option value="M">Masculino</option><option value="O">Otro</option></select>
        </label>
        {input("telefono", "Teléfono", { required: true })}
        {input("email", "Correo", { type: "email" })}
        {input("emergenciaNombre", "Contacto de emergencia", { required: true })}
        {input("emergenciaTelefono", "Teléfono de emergencia", { required: true })}
        {input("tutorNombre", "Tutor legal (menores)")}
        {input("tutorCedula", "Cédula del tutor")}
        {input("tutorTelefono", "Teléfono del tutor")}
        {input("seguro", "Seguro dental")}
        {input("convenio", "Convenio")}
      </div>
      <fieldset className="space-y-3 rounded-lg bg-slate-50 p-3">
        <legend className="px-1 text-sm font-semibold">Anamnesis (obligatoria)</legend>
        <label className="block text-sm">Alergias a fármacos (separadas por coma; vacío si ninguna)
          <input className={field} value={alergias} onChange={(e) => setAlergias(e.target.value)} placeholder="Penicilina, Ibuprofeno" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={anticoagulado} onChange={(e) => setAnti(e.target.checked)} /> Paciente anticoagulado</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={coagulopatia} onChange={(e) => setCoag(e.target.checked)} /> Coagulopatía</label>
        {input("enfermedades", "Enfermedades sistémicas")}
        {input("cirugias", "Antecedentes quirúrgicos")}
        {input("observaciones", "Observaciones")}
      </fieldset>
      <div className="flex gap-3">
        <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Guardar</button>
        <button type="button" onClick={onDone} className="px-4 py-2 text-slate-600">Cancelar</button>
      </div>
    </form>
  );
}

export default function Pacientes() {
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Paciente[]>([]);
  const [view, setView] = useState<"lista" | "nuevo" | string>("lista");

  const load = useCallback(() => api<Paciente[]>(`/pacientes?q=${encodeURIComponent(q)}`).then(setRows), [q]);
  useEffect(() => {
    if (view === "lista") load();
  }, [view, load]);

  if (view === "nuevo") return <Nuevo onDone={() => setView("lista")} />;
  if (view !== "lista") return <Detalle id={view} onBack={() => setView("lista")} />;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Pacientes</h2>
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Buscar por cédula o nombre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {me?.permissions.includes("pacientes:escribir") && (
          <button onClick={() => setView("nuevo")} className="rounded-lg bg-sky-600 px-4 py-2 text-white">Nuevo paciente</button>
        )}
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((p) => (
          <li key={p.id}>
            <button onClick={() => setView(p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50">
              <span><span className="font-medium">{p.apellidos}, {p.nombres}</span> <span className="text-sm text-slate-500">{p.cedula}</span></span>
              <AlertBadges alertas={p.alertas} />
            </button>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-6 text-center text-slate-500">Sin resultados</li>}
      </ul>
    </section>
  );
}
