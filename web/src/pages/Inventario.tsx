import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface Lote { id: string; lote: string; vence?: string | null; cantidad: number }
interface Insumo { id: string; codigo: string; nombre: string; unidad: string; stockMinimo: number; costoUnitario: number; stock: number; bajoMinimo: boolean; lotes: Lote[] }
interface Consultorio { id: string; nombre: string }
interface Proc { id: string; nombre: string }
interface Consumo { insumoId: string; cantidad: number }

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const aCentavos = (s: string) => Math.round(parseFloat((s || "0").replace(",", ".")) * 100) || 0;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");

function Recetas({ insumos, procs }: { insumos: Insumo[]; procs: Proc[] }) {
  const [procId, setProcId] = useState(procs[0]?.id ?? "");
  const [items, setItems] = useState<Consumo[]>([]);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (procId) api<Consumo[]>(`/inventario/receta-consumo/${procId}`).then(setItems);
  }, [procId]);

  async function guardar() {
    setAviso("");
    try {
      await api(`/inventario/receta-consumo/${procId}`, "PUT", { items: items.filter((i) => i.cantidad > 0) });
      setAviso("Receta guardada");
    } catch (e) {
      setAviso(msg(e));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-semibold">Receta estándar de consumo (descargo automático)</h3>
      <label className="block">Procedimiento<select className={field} value={procId} onChange={(e) => setProcId(e.target.value)}>{procs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <ul className="space-y-1">
        {insumos.map((i) => (
          <li key={i.id} className="flex items-center gap-3">
            <span className="flex-1">{i.nombre} <span className="text-xs text-slate-500">({i.unidad})</span></span>
            <input aria-label={`Cantidad de ${i.nombre}`} className="w-20 rounded border border-slate-300 px-2 py-1" type="number" min={0} value={items.find((x) => x.insumoId === i.id)?.cantidad ?? 0}
              onChange={(e) => { const c = Number(e.target.value); setItems((prev) => (prev.some((x) => x.insumoId === i.id) ? prev.map((x) => (x.insumoId === i.id ? { ...x, cantidad: c } : x)) : [...prev, { insumoId: i.id, cantidad: c }])); }} />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3"><button onClick={guardar} className="rounded-lg bg-sky-600 px-4 py-2 text-white">Guardar receta</button>{aviso && <span className="text-slate-600">{aviso}</span>}</div>
    </div>
  );
}

export default function Inventario() {
  const { me } = useAuth();
  const puedeGestionar = !!me?.permissions.includes("inventario:gestionar");
  const esAdmin = !!me?.permissions.includes("catalogos:gestionar");
  const [consultorios, setConsultorios] = useState<Consultorio[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [consultorioId, setConsultorioId] = useState("");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [entrada, setEntrada] = useState({ insumoId: "", lote: "", vence: "", cantidad: "" });
  const [nuevo, setNuevo] = useState({ codigo: "", nombre: "", unidad: "", stockMinimo: "0", costo: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    api<Consultorio[]>("/catalogos/consultorios").then((c) => { setConsultorios(c); setConsultorioId(c[0]?.id ?? ""); });
    api<Proc[]>("/catalogos/procedimientos").then(setProcs);
  }, []);
  const cargar = () => consultorioId && api<Insumo[]>(`/inventario?consultorioId=${consultorioId}`).then(setInsumos);
  useEffect(() => { cargar(); }, [consultorioId]);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await cargar(); } catch (e) { setError(msg(e)); }
  }

  const registrarEntrada = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/inventario/entradas", "POST", { insumoId: entrada.insumoId, consultorioId, lote: entrada.lote, vence: entrada.vence ? new Date(entrada.vence).toISOString() : undefined, cantidad: Number(entrada.cantidad) });
      setEntrada({ insumoId: "", lote: "", vence: "", cantidad: "" });
    });
  };

  const crearInsumo = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/inventario/insumos", "POST", { codigo: nuevo.codigo, nombre: nuevo.nombre, unidad: nuevo.unidad, stockMinimo: Number(nuevo.stockMinimo), costoUnitario: aCentavos(nuevo.costo) });
      setNuevo({ codigo: "", nombre: "", unidad: "", stockMinimo: "0", costo: "" });
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-lg font-semibold">Inventario</h2>
        <label className="text-sm">Consultorio<select className={field} value={consultorioId} onChange={(e) => setConsultorioId(e.target.value)}>{consultorios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left"><tr>{["Insumo", "Stock", "Mínimo", "Costo u.", "Lotes (vence)"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {insumos.map((i) => (
              <tr key={i.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">{i.nombre} <span className="text-xs text-slate-500">{i.codigo}</span></td>
                <td className={`px-3 py-2 font-semibold ${i.bajoMinimo ? "text-red-700" : ""}`}>{i.stock} {i.unidad}{i.bajoMinimo && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs">Bajo el mínimo</span>}</td>
                <td className="px-3 py-2">{i.stockMinimo}</td>
                <td className="px-3 py-2">{usd(i.costoUnitario)}</td>
                <td className="px-3 py-2 text-xs">{i.lotes.map((l) => <div key={l.id}>{l.lote}: {l.cantidad}{l.vence ? ` (vence ${l.vence.slice(0, 10)})` : ""}</div>)}</td>
              </tr>
            ))}
            {!insumos.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Sin insumos.</td></tr>}
          </tbody>
        </table>
      </div>

      {puedeGestionar && (
        <form onSubmit={registrarEntrada} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h3 className="w-full font-semibold">Registrar entrada de lote</h3>
          <label>Insumo<select className={field} required value={entrada.insumoId} onChange={(e) => setEntrada({ ...entrada, insumoId: e.target.value })}><option value="">…</option>{insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}</select></label>
          <label>Lote<input className={field} required value={entrada.lote} onChange={(e) => setEntrada({ ...entrada, lote: e.target.value })} /></label>
          <label>Vence<input className={field} type="date" value={entrada.vence} onChange={(e) => setEntrada({ ...entrada, vence: e.target.value })} /></label>
          <label>Cantidad<input className={`${field} w-24`} type="number" min={1} required value={entrada.cantidad} onChange={(e) => setEntrada({ ...entrada, cantidad: e.target.value })} /></label>
          <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Registrar</button>
        </form>
      )}

      {esAdmin && (
        <>
          <form onSubmit={crearInsumo} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h3 className="w-full font-semibold">Nuevo insumo</h3>
            <label>Código<input className={field} required value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} /></label>
            <label>Nombre<input className={field} required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
            <label>Unidad<input className={`${field} w-24`} required value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} /></label>
            <label>Mínimo<input className={`${field} w-24`} type="number" min={0} value={nuevo.stockMinimo} onChange={(e) => setNuevo({ ...nuevo, stockMinimo: e.target.value })} /></label>
            <label>Costo u. (USD)<input className={`${field} w-28`} inputMode="decimal" value={nuevo.costo} onChange={(e) => setNuevo({ ...nuevo, costo: e.target.value })} /></label>
            <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Crear</button>
          </form>
          {insumos.length > 0 && procs.length > 0 && <Recetas insumos={insumos} procs={procs} />}
        </>
      )}
    </section>
  );
}
