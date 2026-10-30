import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Profesional { id: string; nombre: string }
interface Proc { id: string; nombre: string }
interface Linea { realizadoId: string; descripcion: string; base: number; modalidad: string; valor: number; comision: number }
interface Calculo { lineas: Linea[]; sinRegla: { realizadoId: string; descripcion: string }[]; total: number }
interface Liquidacion { id: string; profesionalId: string; total: number; createdAt: string; lineas: Linea[] }
interface Regla { id: string; procedimientoId: string | null; modalidad: string; valor: number }

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const aCentavos = (s: string) => Math.round(parseFloat((s || "0").replace(",", ".")) * 100) || 0;
const aBp = (s: string) => Math.round(parseFloat((s || "0").replace(",", ".")) * 100) || 0; // % → puntos básicos
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");
const MODALIDAD: Record<string, string> = { PORCENTAJE: "% del precio", MONTO_FIJO: "Monto fijo", PORCENTAJE_NETO: "% neto (sin materiales ni laboratorio)" };
const valorTxt = (modalidad: string, valor: number) => (modalidad === "MONTO_FIJO" ? usd(valor) : `${(valor / 100).toFixed(2)} %`);
const hoy = () => new Date().toISOString().slice(0, 10);

export default function Honorarios() {
  const { me } = useAuth();
  const gestiona = !!me?.permissions.includes("honorarios:gestionar");
  const configura = !!me?.permissions.includes("honorarios:configurar");
  const [profs, setProfs] = useState<Profesional[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [profId, setProfId] = useState("");
  const [desde, setDesde] = useState(hoy().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy());
  const [calculo, setCalculo] = useState<Calculo | null>(null);
  const [liqs, setLiqs] = useState<Liquidacion[]>([]);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [regla, setRegla] = useState({ procedimientoId: "", modalidad: "PORCENTAJE", valor: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api<Profesional[]>("/catalogos/profesionales").then((p) => { setProfs(p); setProfId(p[0]?.id ?? ""); });
    api<Proc[]>("/catalogos/procedimientos").then(setProcs);
  }, []);
  const cargar = () => {
    if (!profId) return;
    api<Liquidacion[]>(`/honorarios/liquidaciones?profesionalId=${profId}`).then(setLiqs);
    api<Regla[]>(`/honorarios/reglas?profesionalId=${profId}`).then(setReglas);
  };
  useEffect(() => { setCalculo(null); cargar(); }, [profId]);

  const periodo = () => `profesionalId=${profId}&desde=${encodeURIComponent(new Date(`${desde}T00:00`).toISOString())}&hasta=${encodeURIComponent(new Date(`${hasta}T23:59:59`).toISOString())}`;

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); } catch (e) { setError(msg(e)); }
  }

  const nombreProc = (id: string | null) => (id ? procs.find((p) => p.id === id)?.nombre ?? id : "Todos los procedimientos");

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Honorarios</h2>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Profesional<select className={field} value={profId} onChange={(e) => setProfId(e.target.value)}>{profs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        {gestiona && (
          <>
            <label className="text-sm">Desde<input className={field} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="text-sm">Hasta<input className={field} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
            <button className="rounded-lg border border-slate-300 px-4 py-2" onClick={() => run(async () => setCalculo(await api<Calculo>(`/honorarios/previsualizar?${periodo()}`)))}>Previsualizar</button>
          </>
        )}
      </div>

      {calculo && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h3 className="font-semibold">Vista previa de la liquidación</h3>
          <ul className="divide-y divide-slate-100">
            {calculo.lineas.map((l) => <li key={l.realizadoId} className="flex flex-wrap gap-3 py-1"><span className="flex-1">{l.descripcion} <span className="text-xs text-slate-500">({MODALIDAD[l.modalidad]} {valorTxt(l.modalidad, l.valor)} sobre {usd(l.base)})</span></span><b>{usd(l.comision)}</b></li>)}
          </ul>
          {calculo.sinRegla.length > 0 && <p className="rounded bg-amber-50 p-2 text-amber-900">Sin regla de honorarios (no se liquidan): {calculo.sinRegla.map((s) => s.descripcion).join(", ")}</p>}
          <p>Total a pagar: <b>{usd(calculo.total)}</b></p>
          <button disabled={!calculo.lineas.length} className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-50"
            onClick={() => run(async () => { await api("/honorarios/liquidar", "POST", { profesionalId: profId, desde: new Date(`${desde}T00:00`).toISOString(), hasta: new Date(`${hasta}T23:59:59`).toISOString() }); setCalculo(null); cargar(); })}>
            Liquidar (no se puede deshacer)
          </button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">Reglas de honorarios</h3>
        <ul className="divide-y divide-slate-100">
          {reglas.map((r) => <li key={r.id} className="py-1">{nombreProc(r.procedimientoId)}: {MODALIDAD[r.modalidad]} <b>{valorTxt(r.modalidad, r.valor)}</b></li>)}
          {!reglas.length && <li className="py-1 text-slate-500">Sin reglas: nada se liquida hasta configurarlas.</li>}
        </ul>
        {configura && (
          <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/honorarios/reglas", "PUT", { profesionalId: profId, procedimientoId: regla.procedimientoId || undefined, modalidad: regla.modalidad, valor: regla.modalidad === "MONTO_FIJO" ? aCentavos(regla.valor) : aBp(regla.valor) }); cargar(); }); }}>
            <label>Procedimiento<select className={field} value={regla.procedimientoId} onChange={(e) => setRegla({ ...regla, procedimientoId: e.target.value })}><option value="">Todos (regla general)</option>{procs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label>Modalidad<select className={field} value={regla.modalidad} onChange={(e) => setRegla({ ...regla, modalidad: e.target.value })}>{Object.entries(MODALIDAD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>{regla.modalidad === "MONTO_FIJO" ? "Monto (USD)" : "Porcentaje (%)"}<input className={`${field} w-28`} inputMode="decimal" required value={regla.valor} onChange={(e) => setRegla({ ...regla, valor: e.target.value })} /></label>
            <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Guardar regla</button>
          </form>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h3 className="mb-2 font-semibold">Liquidaciones</h3>
        <ul className="divide-y divide-slate-100">
          {liqs.map((l) => <li key={l.id} className="flex flex-wrap gap-3 py-1"><span className="flex-1">{new Date(l.createdAt).toLocaleString("es-EC")} · {l.lineas.length} procedimientos</span><b>{usd(l.total)}</b></li>)}
          {!liqs.length && <li className="py-1 text-slate-500">Sin liquidaciones.</li>}
        </ul>
      </div>
    </section>
  );
}
