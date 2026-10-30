import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, descargar } from "../api";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const fecha = (iso: string) => new Date(iso).toLocaleString("es-EC");
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Error");

// ---------- Firma manuscrita en canvas (tablet o mouse) ----------

function FirmaCanvas({ onFirma }: { onFirma: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);

  const punto = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * ref.current!.width) / r.width, y: ((e.clientY - r.top) * ref.current!.height) / r.height };
  };

  function inicio(e: React.PointerEvent) {
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    const { x, y } = punto(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    dibujando.current = true;
    ref.current!.setPointerCapture(e.pointerId);
  }
  function mover(e: React.PointerEvent) {
    if (!dibujando.current) return;
    const { x, y } = punto(e);
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function fin() {
    if (!dibujando.current) return;
    dibujando.current = false;
    onFirma(ref.current!.toDataURL("image/png"));
  }
  function limpiar() {
    ref.current!.getContext("2d")!.clearRect(0, 0, 400, 160);
    onFirma(null);
  }

  return (
    <div className="space-y-1">
      <canvas ref={ref} width={400} height={160} aria-label="Área de firma" className="w-full max-w-md touch-none rounded-lg border border-slate-300 bg-white" onPointerDown={inicio} onPointerMove={mover} onPointerUp={fin} onPointerLeave={fin} />
      <button type="button" onClick={limpiar} className="text-xs text-slate-600">Borrar firma</button>
    </div>
  );
}

// ---------- Consentimientos ----------

interface Consentimiento { id: string; titulo: string; metodo: string; estado: string; firmanteNombre?: string; createdAt: string; firmadoAt?: string }
interface Proc { id: string; nombre: string }

export function Consentimientos({ pid, puedeEscribir }: { pid: string; puedeEscribir: boolean }) {
  const [lista, setLista] = useState<Consentimiento[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [procId, setProcId] = useState("");
  const [metodo, setMetodo] = useState<"FIRMA" | "OTP">("FIRMA");
  const [firmando, setFirmando] = useState<{ c: Consentimiento; otpDemo?: string } | null>(null);
  const [firma, setFirma] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");

  const cargar = () => api<Consentimiento[]>(`/consentimientos?patientId=${pid}`).then(setLista);
  useEffect(() => {
    cargar();
    api<Proc[]>("/catalogos/procedimientos").then(setProcs);
  }, [pid]);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const c = await api<Consentimiento & { otpDemo?: string }>("/consentimientos", "POST", { patientId: pid, metodo, procedimientoId: procId || undefined });
      setFirmando({ c, otpDemo: c.otpDemo });
      setFirma(null);
      setOtp("");
      cargar();
    } catch (x) {
      setError(msg(x));
    }
  }

  async function firmar() {
    setError("");
    try {
      await api(`/consentimientos/${firmando!.c.id}/firmar`, "POST", firmando!.c.metodo === "FIRMA" ? { firma } : { otp });
      setFirmando(null);
      cargar();
    } catch (x) {
      setError(msg(x));
    }
  }

  return (
    <div className="space-y-4">
      {puedeEscribir && (
        <form onSubmit={crear} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="text-sm">Procedimiento
            <select className={field} value={procId} onChange={(e) => setProcId(e.target.value)}>
              <option value="">Consentimiento general</option>
              {procs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="text-sm">Método de firma
            <select className={field} value={metodo} onChange={(e) => setMetodo(e.target.value as "FIRMA" | "OTP")}>
              <option value="FIRMA">Firma en pantalla</option>
              <option value="OTP">Código OTP al paciente</option>
            </select>
          </label>
          <button className="rounded-lg bg-sky-600 px-4 py-2 text-white">Generar consentimiento</button>
        </form>
      )}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {firmando && (
        <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm">
          <h3 className="font-semibold">{firmando.c.titulo}</h3>
          {firmando.c.metodo === "FIRMA" ? (
            <>
              <p>El paciente (o su tutor legal si es menor) firma en el recuadro.</p>
              <FirmaCanvas onFirma={setFirma} />
            </>
          ) : (
            <>
              <p>Se envió un código de 6 dígitos al paciente (canal simulado). Escríbelo para firmar.</p>
              {firmando.otpDemo && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Modo demostración: el código es <b>{firmando.otpDemo}</b>.</p>}
              <input className={`${field} max-w-40 text-center tracking-widest`} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </>
          )}
          <div className="flex gap-3">
            <button onClick={firmar} disabled={firmando.c.metodo === "FIRMA" ? !firma : otp.length !== 6} className="rounded-lg bg-sky-600 px-4 py-2 text-white disabled:opacity-50">Firmar y generar PDF</button>
            <button onClick={() => setFirmando(null)} className="px-3 py-2 text-slate-600">Más tarde</button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {lista.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1"><b>{c.titulo}</b><span className="block text-xs text-slate-500">{fecha(c.createdAt)}{c.firmanteNombre ? ` · firmó ${c.firmanteNombre}` : ""}</span></span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${c.estado === "FIRMADO" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{c.estado === "FIRMADO" ? "Firmado" : "Pendiente"}</span>
            {c.estado === "FIRMADO" ? (
              <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => descargar(`/consentimientos/${c.id}/pdf`, `consentimiento-${c.id}.pdf`)}>Descargar PDF</button>
            ) : (
              puedeEscribir && c.metodo === "FIRMA" && <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setFirmando({ c }); setFirma(null); }}>Firmar</button>
            )}
          </li>
        ))}
        {!lista.length && <li className="px-4 py-6 text-center text-slate-500">Sin consentimientos.</li>}
      </ul>
    </div>
  );
}

// ---------- Recetas ----------

interface Item { medicamento: string; dosis: string; frecuencia: string; duracion: string; indicaciones?: string }
interface Receta { id: string; createdAt: string; diagnostico?: string; items: Item[] }
const itemVacio = (): Item => ({ medicamento: "", dosis: "", frecuencia: "", duracion: "", indicaciones: "" });

export function Recetas({ pid, puedeFirmar }: { pid: string; puedeFirmar: boolean }) {
  const [lista, setLista] = useState<Receta[]>([]);
  const [diagnostico, setDiagnostico] = useState("");
  const [items, setItems] = useState<Item[]>([itemVacio()]);
  const [error, setError] = useState("");
  const [alergia, setAlergia] = useState<string | null>(null);

  const cargar = () => api<Receta[]>(`/recetas?patientId=${pid}`).then(setLista);
  useEffect(() => {
    cargar();
  }, [pid]);

  async function emitir(confirmarAlergia = false) {
    setError("");
    try {
      await api("/recetas", "POST", { patientId: pid, diagnostico: diagnostico || undefined, items: items.map((i) => ({ ...i, indicaciones: i.indicaciones || undefined })), confirmarAlergia });
      setItems([itemVacio()]);
      setDiagnostico("");
      setAlergia(null);
      cargar();
    } catch (x) {
      if (x instanceof ApiError && (x.data as { code?: string })?.code === "ALERGIA") setAlergia(x.message);
      else setError(msg(x));
    }
  }

  const set = (i: number, k: keyof Item, v: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div className="space-y-4">
      {puedeFirmar && (
        <form onSubmit={(e) => { e.preventDefault(); emitir(); }} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-semibold">Nueva receta</h3>
          <label className="block text-sm">Diagnóstico<input className={field} value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} /></label>
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-4">
              <label className="text-xs sm:col-span-2">Medicamento<input className={field} required value={it.medicamento} onChange={(e) => set(i, "medicamento", e.target.value)} /></label>
              <label className="text-xs">Dosis<input className={field} required value={it.dosis} onChange={(e) => set(i, "dosis", e.target.value)} /></label>
              <label className="text-xs">Frecuencia<input className={field} required value={it.frecuencia} onChange={(e) => set(i, "frecuencia", e.target.value)} /></label>
              <label className="text-xs">Duración<input className={field} required value={it.duracion} onChange={(e) => set(i, "duracion", e.target.value)} /></label>
              <label className="text-xs sm:col-span-3">Indicaciones<input className={field} value={it.indicaciones} onChange={(e) => set(i, "indicaciones", e.target.value)} /></label>
              {items.length > 1 && <button type="button" className="text-xs text-red-700" onClick={() => setItems(items.filter((_, j) => j !== i))}>Quitar</button>}
            </div>
          ))}
          <button type="button" className="text-sm text-sky-700" onClick={() => setItems([...items, itemVacio()])}>+ Agregar medicamento</button>
          {alergia && (
            <div role="alert" className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <p><b>⚠ {alergia}</b></p>
              <button type="button" onClick={() => emitir(true)} className="rounded bg-red-700 px-3 py-1 text-white">Recetar de todos modos</button>
            </div>
          )}
          {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button className="block rounded-lg bg-sky-600 px-4 py-2 text-white">Emitir receta (PDF)</button>
        </form>
      )}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {lista.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1"><b>{r.items.map((i) => i.medicamento).join(", ")}</b><span className="block text-xs text-slate-500">{fecha(r.createdAt)}{r.diagnostico ? ` · ${r.diagnostico}` : ""}</span></span>
            <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => descargar(`/recetas/${r.id}/pdf`, `receta-${r.id}.pdf`)}>Descargar PDF</button>
          </li>
        ))}
        {!lista.length && <li className="px-4 py-6 text-center text-slate-500">Sin recetas.</li>}
      </ul>
    </div>
  );
}
