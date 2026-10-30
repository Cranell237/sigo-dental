import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

interface Turno {
  id: string;
  estado: string;
  fondoInicial: number;
  conteoEfectivo?: number;
  totalTeorico?: number;
  diferencia?: number;
}
interface Proc { id: string; codigo: string; nombre: string; precioBase: number }
interface Pac { id: string; nombres: string; apellidos: string }
interface Cobro {
  id: number;
  comprobante?: string;
  total: number;
  lineas: { descripcion: string; cantidad: number; precioUnitario: number }[];
  pagos: { metodo: string; monto: number }[];
  factura?: { secuencial: number; claveAcceso: string; estado: string };
}

const METODOS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA_CREDITO: "Tarjeta de crédito",
  TARJETA_DEBITO: "Tarjeta de débito",
  TRANSFERENCIA: "Transferencia",
  SEGURO: "Seguro",
  PASARELA: "Pasarela de pagos",
};
// Tokens de prueba de la pasarela simulada (nunca se escriben números de tarjeta).
const TOKENS: Record<string, string> = { tok_visa: "Visa de prueba (aprueba)", tok_mastercard: "Mastercard de prueba (aprueba)", tok_declined: "Tarjeta rechazada", tok_sinfondos: "Fondos insuficientes" };
const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
// Los importes viajan como enteros en centavos; el usuario escribe dólares.
const aCentavos = (s: string) => Math.round(parseFloat(s.replace(",", ".")) * 100);
const err = (e: unknown) => (e instanceof ApiError ? e.message : "Error");

function Cobrar({ procs, pacientes, onDone }: { procs: Proc[]; pacientes: Pac[]; onDone: (c: Cobro) => void }) {
  const [patientId, setPatientId] = useState("");
  const [lineas, setLineas] = useState<{ procedimientoId: string; cantidad: number }[]>([{ procedimientoId: procs[0]?.id ?? "", cantidad: 1 }]);
  const [pagos, setPagos] = useState<{ metodo: string; monto: string; token?: string }[]>([{ metodo: "EFECTIVO", monto: "" }]);
  const [error, setError] = useState("");

  const total = lineas.reduce((s, l) => s + (procs.find((p) => p.id === l.procedimientoId)?.precioBase ?? 0) * l.cantidad, 0);
  const pagado = pagos.reduce((s, p) => s + (aCentavos(p.monto) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const c = await api<Cobro>("/caja/cobros", "POST", {
        patientId,
        lineas,
        pagos: pagos.map((p) => ({ metodo: p.metodo, monto: aCentavos(p.monto), token: p.metodo === "PASARELA" ? p.token ?? "tok_visa" : undefined })),
      });
      onDone(c);
    } catch (x) {
      setError(err(x));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Nuevo cobro</h3>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <label className="block text-sm">Paciente
        <select className={field} required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          <option value="">Selecciona…</option>
          {pacientes.map((p) => <option key={p.id} value={p.id}>{p.apellidos}, {p.nombres}</option>)}
        </select>
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Procedimientos</p>
        {lineas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <select className={field} value={l.procedimientoId} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, procedimientoId: e.target.value } : x)))}>
              {procs.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {usd(p.precioBase)}</option>)}
            </select>
            <input className={`${field} w-20`} type="number" min={1} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x)))} />
            {lineas.length > 1 && <button type="button" className="px-2 text-slate-500" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button type="button" className="text-sm text-sky-700" onClick={() => setLineas([...lineas, { procedimientoId: procs[0]?.id ?? "", cantidad: 1 }])}>+ Agregar procedimiento</button>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Pagos (pueden combinarse)</p>
        {pagos.map((p, i) => (
          <div key={i} className="flex gap-2">
            <select className={field} value={p.metodo} onChange={(e) => setPagos(pagos.map((x, j) => (j === i ? { ...x, metodo: e.target.value, token: e.target.value === "PASARELA" ? "tok_visa" : undefined } : x)))}>
              {Object.entries(METODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {p.metodo === "PASARELA" && <select aria-label="Token de pago" className={field} value={p.token} onChange={(e) => setPagos(pagos.map((x, j) => (j === i ? { ...x, token: e.target.value } : x)))}>{Object.entries(TOKENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
            <input className={field} inputMode="decimal" placeholder="0.00" required value={p.monto} onChange={(e) => setPagos(pagos.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))} />
            {pagos.length > 1 && <button type="button" className="px-2 text-slate-500" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        <button type="button" className="text-sm text-sky-700" onClick={() => setPagos([...pagos, { metodo: "TARJETA_CREDITO", monto: "" }])}>+ Agregar forma de pago</button>
      </div>
      <p className={`text-sm ${pagado === total ? "text-green-700" : "text-slate-600"}`}>Total: <b>{usd(total)}</b> · Pagado: <b>{usd(pagado)}</b></p>
      <button className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-50" disabled={!patientId || pagado !== total}>Cobrar y facturar</button>
    </form>
  );
}

function Comprobante({ c, onClose }: { c: Cobro; onClose: () => void }) {
  async function xml() {
    const res = await fetch(`/api/caja/cobros/${c.id}/factura.xml`, { headers: { Authorization: `Bearer ${JSON.parse(sessionStorage.getItem("sigo.session") ?? "{}").token}` } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `factura-${c.factura?.secuencial}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3 rounded-lg border border-green-300 bg-green-50 p-4">
      <h3 className="font-semibold text-green-800">Cobro registrado · CI-{String(c.id).padStart(6, "0")}</h3>
      <ul className="text-sm">
        {c.lineas.map((l, i) => <li key={i}>{l.cantidad} × {l.descripcion} — {usd(l.cantidad * l.precioUnitario)}</li>)}
      </ul>
      <p className="text-sm">{c.pagos.map((p) => `${METODOS[p.metodo]} ${usd(p.monto)}`).join(" + ")} = <b>{usd(c.total)}</b></p>
      {c.factura && <p className="break-all text-xs text-slate-600">Factura simulada #{c.factura.secuencial} · {c.factura.estado} · clave {c.factura.claveAcceso}</p>}
      <div className="flex gap-3">
        {c.factura && <button onClick={xml} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm">Descargar XML</button>}
        <button onClick={onClose} className="rounded-lg bg-sky-600 px-3 py-1 text-sm text-white">Nuevo cobro</button>
      </div>
    </div>
  );
}

export default function Caja() {
  const [turno, setTurno] = useState<Turno | null | undefined>(undefined);
  const [cerrado, setCerrado] = useState<Turno | null>(null);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [pacientes, setPacientes] = useState<Pac[]>([]);
  const [ultimo, setUltimo] = useState<Cobro | null>(null);
  const [fondo, setFondo] = useState("");
  const [conteo, setConteo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Turno | null>("/caja/turno").then(setTurno);
    api<Proc[]>("/catalogos/procedimientos").then(setProcs);
    api<Pac[]>("/pacientes").then(setPacientes);
  }, []);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setCerrado(null);
      setTurno(await api<Turno>("/caja/apertura", "POST", { fondoInicial: aCentavos(fondo || "0") }));
    } catch (x) {
      setError(err(x));
    }
  }

  async function cerrar(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setCerrado(await api<Turno>("/caja/cierre", "POST", { conteoEfectivo: aCentavos(conteo) }));
      setTurno(null);
      setConteo("");
    } catch (x) {
      setError(err(x));
    }
  }

  if (turno === undefined) return <p className="text-slate-500">Cargando…</p>;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Caja</h2>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {cerrado && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold">Turno cerrado</h3>
          <p>Efectivo contado: <b>{usd(cerrado.conteoEfectivo!)}</b></p>
          <p>Efectivo teórico del sistema: <b>{usd(cerrado.totalTeorico!)}</b></p>
          <p className={cerrado.diferencia === 0 ? "text-green-700" : "text-red-700"}>
            Diferencia: <b>{usd(cerrado.diferencia!)}</b> {cerrado.diferencia === 0 ? "(cuadra)" : cerrado.diferencia! < 0 ? "(faltante)" : "(sobrante)"}
          </p>
        </div>
      )}

      {!turno ? (
        <form onSubmit={abrir} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-sm">Fondo inicial (USD)
            <input className={field} inputMode="decimal" placeholder="0.00" value={fondo} onChange={(e) => setFondo(e.target.value)} />
          </label>
          <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Abrir turno</button>
        </form>
      ) : (
        <>
          <p className="text-sm text-slate-600">Turno abierto · fondo inicial {usd(turno.fondoInicial)}</p>
          {ultimo ? <Comprobante c={ultimo} onClose={() => setUltimo(null)} /> : <Cobrar procs={procs} pacientes={pacientes} onDone={setUltimo} />}
          <form onSubmit={cerrar} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-sm">Cierre ciego: efectivo contado (USD)
              <input className={field} inputMode="decimal" placeholder="0.00" required value={conteo} onChange={(e) => setConteo(e.target.value)} />
            </label>
            <button className="rounded-lg border border-slate-300 px-4 py-2">Cerrar turno</button>
            <p className="w-full text-xs text-slate-500">El total teórico se muestra solo después de registrar tu conteo.</p>
          </form>
        </>
      )}
    </section>
  );
}
