import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { FILAS, PUNTOS_PERIO } from "../dental";
import Odontograma, { type Hallazgo } from "./Odontograma";
import { Consentimientos, Recetas } from "./Documentos";
import { PasswordDialog } from "./PasswordDialog";
import { AlertBadges } from "./Pacientes";

interface PacienteMin { id: string; nombres: string; apellidos: string; cedula: string; alertas: string[] }
interface Punto { punto: string; profundidad: number; margen: number; sangrado: boolean; nic: number }
interface PerioDiente { id?: string; diente: string; puntos: Punto[]; furca: number; movilidad: number }
interface Examen { id: string; createdAt: string; dientes: PerioDiente[] }
interface Nota {
  id: string;
  createdAt: string;
  subjetivo: string;
  objetivo: string;
  evaluacion: string;
  plan: string;
  firmada: boolean;
  bloqueada: boolean;
  bloqueaEn: string;
  autorId: string;
  adendas: { id: string; texto: string; createdAt: string }[];
}

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const fecha = (iso: string) => new Date(iso).toLocaleString("es-EC");

// ---------- Periodontograma ----------

function Periodontograma({ pid, examenes, puedeEscribir, onChange }: { pid: string; examenes: Examen[]; puedeEscribir: boolean; onChange: () => void }) {
  const vacio = () => PUNTOS_PERIO.map((punto) => ({ punto, profundidad: "3", margen: "0", sangrado: false }));
  const dientes = [...FILAS.permanente.superior, ...FILAS.permanente.inferior].sort();
  const [diente, setDiente] = useState("16");
  const [puntos, setPuntos] = useState(vacio());
  const [furca, setFurca] = useState(0);
  const [movilidad, setMovilidad] = useState(0);
  const [pendientes, setPendientes] = useState<PerioDiente[]>([]);
  const [error, setError] = useState("");

  const num = (s: string) => parseInt(s, 10) || 0;
  const agregar = () => {
    setPendientes([
      ...pendientes.filter((p) => p.diente !== diente),
      { diente, furca, movilidad, puntos: puntos.map((p) => ({ punto: p.punto, profundidad: num(p.profundidad), margen: num(p.margen), sangrado: p.sangrado, nic: num(p.profundidad) + num(p.margen) })) },
    ]);
    setPuntos(vacio());
    setFurca(0);
    setMovilidad(0);
  };

  async function guardar() {
    setError("");
    try {
      await api(`/clinico/pacientes/${pid}/periodontograma`, "POST", { dientes: pendientes.map(({ diente, furca, movilidad, puntos }) => ({ diente, furca, movilidad, puntos: puntos.map(({ nic: _n, ...p }) => p) })) });
      setPendientes([]);
      onChange();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Error");
    }
  }

  const tabla = (ds: PerioDiente[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-100"><tr><th className="px-2 py-1 text-left">Diente</th>{PUNTOS_PERIO.map((p) => <th key={p} className="px-2 py-1">{p} (PS/Rec/NIC)</th>)}<th className="px-2">Furca</th><th className="px-2">Mov.</th></tr></thead>
        <tbody>
          {ds.map((d) => (
            <tr key={d.diente} className="border-t border-slate-100 text-center">
              <td className="px-2 py-1 text-left font-mono">{d.diente}</td>
              {d.puntos.map((p) => <td key={p.punto} className={p.sangrado ? "bg-red-50 text-red-700" : ""}>{p.profundidad}/{p.margen}/<b>{p.nic}</b>{p.sangrado ? " •" : ""}</td>)}
              <td>{d.furca}</td><td>{d.movilidad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      {puedeEscribir && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">Nuevo examen periodontal</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">Diente<select className={field} value={diente} onChange={(e) => setDiente(e.target.value)}>{dientes.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="text-sm">Furca (0-3)<input className={`${field} w-20`} type="number" min={0} max={3} value={furca} onChange={(e) => setFurca(num(e.target.value))} /></label>
            <label className="text-sm">Movilidad (0-3)<input className={`${field} w-24`} type="number" min={0} max={3} value={movilidad} onChange={(e) => setMovilidad(num(e.target.value))} /></label>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {puntos.map((p, i) => (
              <div key={p.punto} className="space-y-1 rounded border border-slate-200 p-2 text-xs">
                <b>{p.punto}</b>
                <label className="block">Prof. (mm)<input className="w-full rounded border border-slate-300 px-1" type="number" min={0} max={15} value={p.profundidad} onChange={(e) => setPuntos(puntos.map((x, j) => (j === i ? { ...x, profundidad: e.target.value } : x)))} /></label>
                <label className="block">Recesión<input className="w-full rounded border border-slate-300 px-1" type="number" min={-10} max={15} value={p.margen} onChange={(e) => setPuntos(puntos.map((x, j) => (j === i ? { ...x, margen: e.target.value } : x)))} /></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={p.sangrado} onChange={(e) => setPuntos(puntos.map((x, j) => (j === i ? { ...x, sangrado: e.target.checked } : x)))} />Sangra</label>
                <p>NIC: <b>{num(p.profundidad) + num(p.margen)}</b></p>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={agregar} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Agregar diente {diente}</button>
            {pendientes.length > 0 && <button onClick={guardar} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm text-white">Guardar examen ({pendientes.length} dientes)</button>}
          </div>
          {pendientes.length > 0 && tabla(pendientes)}
          {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
      {examenes.map((e) => (
        <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Examen del {fecha(e.createdAt)} <span className="font-normal text-slate-500">(no editable)</span></h3>
          {tabla(e.dientes)}
        </div>
      ))}
      {!examenes.length && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">Sin exámenes periodontales.</p>}
    </div>
  );
}

// ---------- Notas SOEP ----------

function Notas({ pid, notas, meId, puedeEscribir, puedeFirmar, onChange }: { pid: string; notas: Nota[]; meId: string; puedeEscribir: boolean; puedeFirmar: boolean; onChange: () => void }) {
  const [f, setF] = useState({ subjetivo: "", objetivo: "", evaluacion: "", plan: "" });
  const [error, setError] = useState("");
  const [firma, setFirma] = useState<{ nota: Nota; adenda: boolean } | null>(null);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clinico/pacientes/${pid}/notas`, "POST", f);
      setF({ subjetivo: "", objetivo: "", evaluacion: "", plan: "" });
      onChange();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Error");
    }
  }

  const campo = (k: keyof typeof f, label: string) => (
    <label className="block text-sm">{label}<textarea className={field} rows={2} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );

  return (
    <div className="space-y-4">
      {puedeEscribir && (
        <form onSubmit={crear} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">Nueva nota de evolución (SOEP)</h3>
          <div className="grid gap-3 sm:grid-cols-2">{campo("subjetivo", "S — Subjetivo")}{campo("objetivo", "O — Objetivo")}{campo("evaluacion", "E — Evaluación")}{campo("plan", "P — Plan")}</div>
          {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Guardar nota</button>
          <p className="text-xs text-slate-500">Podrás editarla hasta que se firme o venza el plazo; después solo admite adendas firmadas.</p>
        </form>
      )}
      {notas.map((n) => (
        <article key={n.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <header className="flex flex-wrap items-center gap-2">
            <b>{fecha(n.createdAt)}</b>
            <span className={`rounded-full px-2 py-0.5 text-xs ${n.firmada ? "bg-green-100 text-green-800" : n.bloqueada ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
              {n.firmada ? "Firmada" : n.bloqueada ? "Bloqueada sin firma" : `Editable hasta ${fecha(n.bloqueaEn)}`}
            </span>
            <span className="ml-auto flex gap-2">
              {!n.firmada && puedeFirmar && <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => setFirma({ nota: n, adenda: false })}>Firmar</button>}
              {n.bloqueada && puedeFirmar && <button className="rounded border border-amber-400 px-2 py-0.5 text-xs" onClick={() => setFirma({ nota: n, adenda: true })}>Adenda</button>}
            </span>
          </header>
          <dl className="grid gap-2 sm:grid-cols-2">
            {([["S", n.subjetivo], ["O", n.objetivo], ["E", n.evaluacion], ["P", n.plan]] as const).map(([k, v]) => <div key={k}><dt className="text-xs font-semibold text-slate-500">{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {n.adendas.map((a) => <p key={a.id} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Adenda firmada ({fecha(a.createdAt)}): {a.texto}</p>)}
          {!n.bloqueada && n.autorId !== meId && <p className="text-xs text-slate-500">Solo su autor puede editarla.</p>}
        </article>
      ))}
      {!notas.length && <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">Sin notas de evolución.</p>}

      {firma && (
        <PasswordDialog
          titulo={firma.adenda ? "Adenda a una nota bloqueada" : "Firmar nota de evolución"}
          descripcion={firma.adenda ? undefined : "Tras la firma la nota no podrá modificarse."}
          conTexto={firma.adenda}
          onCancel={() => setFirma(null)}
          onSubmit={async (password, texto) => {
            await api(`/clinico/pacientes/${pid}/notas/${firma.nota.id}/${firma.adenda ? "adenda" : "firmar"}`, "POST", firma.adenda ? { password, texto } : { password });
            setFirma(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

// ---------- Expediente ----------

export default function Expediente() {
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<PacienteMin[]>([]);
  const [paciente, setPaciente] = useState<PacienteMin | null>(null);
  const [tab, setTab] = useState<"odontograma" | "periodontograma" | "notas" | "consentimientos" | "recetas">("odontograma");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [examenes, setExamenes] = useState<Examen[]>([]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const puedeEscribir = !!me?.permissions.includes("clinico:escribir");
  const puedeFirmar = !!me?.permissions.includes("clinico:firmar");

  useEffect(() => {
    api<PacienteMin[]>(`/pacientes?q=${encodeURIComponent(q)}`).then(setLista);
  }, [q]);

  const cargar = useCallback(async () => {
    if (!paciente) return;
    const base = `/clinico/pacientes/${paciente.id}`;
    const [o, p, n] = await Promise.all([api<{ hallazgos: Hallazgo[] }>(`${base}/odontograma`), api<Examen[]>(`${base}/periodontograma`), api<Nota[]>(`${base}/notas`)]);
    setHallazgos(o.hallazgos);
    setExamenes(p);
    setNotas(n);
  }, [paciente]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!paciente) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Expediente clínico</h2>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Buscar paciente por cédula o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {lista.map((p) => (
            <li key={p.id}>
              <button onClick={() => setPaciente(p)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50">
                <span className="font-medium">{p.apellidos}, {p.nombres} <span className="text-sm font-normal text-slate-500">{p.cedula}</span></span>
                <AlertBadges alertas={p.alertas} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const tabs = [["odontograma", "Odontograma"], ["periodontograma", "Periodontograma"], ["notas", "Notas SOEP"], ["consentimientos", "Consentimientos"], ["recetas", "Recetas"]] as const;
  return (
    <section className="space-y-4">
      <button onClick={() => setPaciente(null)} className="text-sm text-sky-700">← Cambiar paciente</button>
      <header className="sticky top-0 z-[1] space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-xl font-semibold">{paciente.nombres} {paciente.apellidos} <span className="text-sm font-normal text-slate-500">{paciente.cedula}</span></h2>
        <AlertBadges alertas={paciente.alertas} />
      </header>
      <nav className="flex gap-1 border-b border-slate-200">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm ${tab === id ? "border-b-2 border-sky-600 font-semibold text-sky-700" : "text-slate-600"}`}>{label}</button>
        ))}
      </nav>
      {tab === "odontograma" && <Odontograma pid={paciente.id} hallazgos={hallazgos} puedeEscribir={puedeEscribir} puedeFirmar={puedeFirmar} onChange={cargar} />}
      {tab === "periodontograma" && <Periodontograma pid={paciente.id} examenes={examenes} puedeEscribir={puedeEscribir} onChange={cargar} />}
      {tab === "consentimientos" && <Consentimientos pid={paciente.id} puedeEscribir={puedeEscribir} />}
      {tab === "recetas" && <Recetas pid={paciente.id} puedeFirmar={puedeFirmar} />}
      {tab === "notas" && <Notas pid={paciente.id} notas={notas} meId={me!.id} puedeEscribir={puedeEscribir} puedeFirmar={puedeFirmar} onChange={cargar} />}
    </section>
  );
}
