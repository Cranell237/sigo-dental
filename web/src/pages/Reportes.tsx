import { useEffect, useState } from "react";
import { api, ApiError, descargar } from "../api";

type Fila = Record<string, string | number | null>;
interface Reporte { resumen: Record<string, unknown>; filas: Fila[] }

const REPORTES = [
  { id: "corte-caja", label: "Corte de caja", periodo: true },
  { id: "honorarios", label: "Honorarios", periodo: true },
  { id: "inventario", label: "Inventario", periodo: false },
  { id: "ausentismo", label: "Ausentismo", periodo: true },
] as const;

const field = "mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm";
const hoy = () => new Date().toISOString().slice(0, 10);
// Columnas que son dinero en centavos.
const DINERO = new Set(["fondoInicial", "efectivo", "tarjetas", "transferencias", "seguros", "totalCobrado", "efectivoTeorico", "efectivoContado", "diferencia", "total", "valorizado", "valorTotal", "diferenciaTotal"]);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const celda = (k: string, v: string | number | null) => (v === null ? "—" : typeof v === "number" && DINERO.has(k) ? usd(v) : String(v));
const titulo = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export default function Reportes() {
  const [id, setId] = useState<(typeof REPORTES)[number]["id"]>("corte-caja");
  const [desde, setDesde] = useState(hoy().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy());
  const [data, setData] = useState<Reporte | null>(null);
  const [error, setError] = useState("");
  const def = REPORTES.find((r) => r.id === id)!;

  const qs = () => (def.periodo ? `?desde=${encodeURIComponent(new Date(`${desde}T00:00`).toISOString())}&hasta=${encodeURIComponent(new Date(`${hasta}T23:59:59`).toISOString())}` : "");

  async function cargar() {
    setError("");
    try { setData(await api<Reporte>(`/reportes/${id}${qs()}`)); } catch (e) { setError(e instanceof ApiError ? e.message : "Error"); }
  }
  useEffect(() => { setData(null); cargar(); }, [id]);

  const cols = data?.filas[0] ? Object.keys(data.filas[0]) : [];
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Reportes</h2>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {REPORTES.map((r) => <button key={r.id} onClick={() => setId(r.id)} className={`px-4 py-2 text-sm ${id === r.id ? "border-b-2 border-sky-600 font-semibold text-sky-700" : "text-slate-600"}`}>{r.label}</button>)}
      </nav>
      <div className="flex flex-wrap items-end gap-3">
        {def.periodo && (
          <>
            <label className="text-sm">Desde<input className={`${field} block`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label className="text-sm">Hasta<input className={`${field} block`} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </>
        )}
        <button onClick={cargar} className="rounded-lg bg-sky-600 px-4 py-2 text-white">Consultar</button>
        <button onClick={() => descargar(`/reportes/${id}${qs()}${qs() ? "&" : "?"}formato=csv`, `${id}.csv`)} className="rounded-lg border border-slate-300 px-4 py-2">Exportar CSV</button>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {data && (
        <>
          <dl className="flex flex-wrap gap-3">
            {Object.entries(data.resumen).filter(([, v]) => typeof v !== "object").map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 bg-white px-4 py-2"><dt className="text-xs text-slate-500">{titulo(k)}</dt><dd className="text-lg font-semibold">{celda(k, v as number | string)}</dd></div>
            ))}
          </dl>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left"><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{titulo(c)}</th>)}</tr></thead>
              <tbody>
                {data.filas.map((f, i) => <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c} className={`whitespace-nowrap px-3 py-2 ${c === "bajoMinimo" && f[c] === "SI" ? "font-semibold text-red-700" : ""}`}>{celda(c, f[c])}</td>)}</tr>)}
                {!data.filas.length && <tr><td className="px-3 py-6 text-center text-slate-500">Sin datos en el periodo.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
