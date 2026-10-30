import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { ESTADO_LABEL, FILAS, SUPERFICIES, TIPOS, fdiAUniversal } from "../dental";
import { PasswordDialog } from "./PasswordDialog";

export interface Hallazgo {
  id: string;
  diente: string;
  superficie: string | null;
  tipo: string;
  estado: string;
  nota?: string | null;
  adendas: { id: string; texto: string; createdAt: string }[];
}

type Sel = { diente: string; superficie: string | null } | null;

// Cinco superficies dibujadas como cruz dentro de un cuadrado (RF-03).
const POLIGONOS: Record<"top" | "bottom" | "left" | "right" | "center", string> = {
  top: "0,0 40,0 28,12 12,12",
  bottom: "0,40 40,40 28,28 12,28",
  left: "0,0 12,12 12,28 0,40",
  right: "40,0 40,40 28,28 28,12",
  center: "12,12 28,12 28,28 12,28",
};

function superficiesDe(diente: string, superior: boolean) {
  const izquierdaPantalla = ["1", "4", "5", "8"].includes(diente[0]); // el centro de la boca queda a la derecha
  return {
    top: superior ? "V" : "L",
    bottom: superior ? "L" : "V",
    left: izquierdaPantalla ? "D" : "M",
    right: izquierdaPantalla ? "M" : "D",
    center: "O",
  };
}

function Diente({ diente, superior, universal, hallazgos, sel, onSel }: { diente: string; superior: boolean; universal: boolean; hallazgos: Hallazgo[]; sel: Sel; onSel: (s: Sel) => void }) {
  const mapa = superficiesDe(diente, superior);
  const deDiente = hallazgos.filter((h) => h.diente === diente);
  const colorDe = (sup: string) => {
    const h = [...deDiente].reverse().find((x) => x.superficie === sup);
    return h ? TIPOS[h.tipo].color : "#fff";
  };
  const enteros = deDiente.filter((h) => !h.superficie);
  const etiqueta = universal ? fdiAUniversal(diente) : diente;
  const dienteSel = sel?.diente === diente;

  return (
    <div className="flex flex-col items-center" style={{ width: 44 }}>
      {superior && <button onClick={() => onSel({ diente, superficie: null })} className={`text-xs ${dienteSel && !sel?.superficie ? "font-bold text-sky-700" : "text-slate-600"}`}>{etiqueta}</button>}
      <svg viewBox="-2 -2 44 44" width={42} height={42} role="group" aria-label={`Diente ${etiqueta}`}>
        {(Object.keys(POLIGONOS) as (keyof typeof POLIGONOS)[]).map((k) => {
          const sup = mapa[k];
          const activo = dienteSel && sel?.superficie === sup;
          return (
            <polygon
              key={k}
              points={POLIGONOS[k]}
              fill={colorDe(sup)}
              stroke={activo ? "#0284c7" : "#475569"}
              strokeWidth={activo ? 2.5 : 1}
              className="cursor-pointer"
              onClick={() => onSel({ diente, superficie: sup })}
            >
              <title>{SUPERFICIES.find((s) => s.id === sup)?.nombre}</title>
            </polygon>
          );
        })}
        {enteros.some((h) => h.tipo === "EXODONCIA") && (
          <g stroke="#111827" strokeWidth={3} pointerEvents="none"><line x1={2} y1={2} x2={38} y2={38} /><line x1={38} y1={2} x2={2} y2={38} /></g>
        )}
        {enteros.some((h) => h.tipo === "AUSENTE") && <line x1={2} y1={20} x2={38} y2={20} stroke="#6b7280" strokeWidth={3} pointerEvents="none" />}
      </svg>
      {!superior && <button onClick={() => onSel({ diente, superficie: null })} className={`text-xs ${dienteSel && !sel?.superficie ? "font-bold text-sky-700" : "text-slate-600"}`}>{etiqueta}</button>}
      <div className="flex h-4 flex-wrap justify-center gap-0.5">
        {enteros
          .filter((h) => TIPOS[h.tipo].marca && !["EXODONCIA", "AUSENTE"].includes(h.tipo))
          .map((h) => (
            <span key={h.id} className="rounded px-0.5 text-[9px] font-bold text-white" style={{ background: TIPOS[h.tipo].color, opacity: h.estado === "REQUERIDO" ? 0.6 : 1 }} title={`${TIPOS[h.tipo].nombre} (${ESTADO_LABEL[h.estado]})`}>
              {TIPOS[h.tipo].marca}
            </span>
          ))}
      </div>
    </div>
  );
}

function NuevoHallazgo({ pid, sel, onDone }: { pid: string; sel: NonNullable<Sel>; onDone: () => void }) {
  const [tipo, setTipo] = useState(sel.superficie ? "CARIES" : "ENDODONCIA");
  const [estado, setEstado] = useState("EXISTENTE");
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const porSup = TIPOS[tipo].porSuperficie;
  const opciones = Object.entries(TIPOS).filter(([, t]) => t.porSuperficie === !!sel.superficie);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clinico/pacientes/${pid}/hallazgos`, "POST", { diente: sel.diente, superficie: porSup ? sel.superficie : undefined, tipo, estado, nota: nota || undefined });
      onDone();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
      <p className="w-full font-medium">
        Diente {sel.diente} {sel.superficie ? `· superficie ${SUPERFICIES.find((s) => s.id === sel.superficie)?.nombre}` : "· diente completo"}
      </p>
      <label>Hallazgo<select className="mt-1 block rounded border border-slate-300 px-2 py-1" value={tipo} onChange={(e) => setTipo(e.target.value)}>{opciones.map(([k, t]) => <option key={k} value={k}>{t.nombre}</option>)}</select></label>
      <label>Estado<select className="mt-1 block rounded border border-slate-300 px-2 py-1" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="EXISTENTE">Existente</option><option value="REQUERIDO">Requerido</option></select></label>
      <label className="min-w-40 flex-1">Nota<input className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      <button className="rounded bg-sky-600 px-3 py-1.5 text-white">Agregar</button>
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
    </form>
  );
}

function Realizar({ pid, h, onCancel, onDone }: { pid: string; h: Hallazgo; onCancel: () => void; onDone: () => void }) {
  const [procs, setProcs] = useState<{ id: string; nombre: string }[]>([]);
  const [consultorios, setConsultorios] = useState<{ id: string; nombre: string }[]>([]);
  const [procId, setProcId] = useState("");
  const [consultorioId, setConsultorioId] = useState("");
  const [lab, setLab] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ id: string; nombre: string }[]>("/catalogos/procedimientos").then(setProcs);
    api<{ id: string; nombre: string }[]>("/catalogos/consultorios").then((c) => { setConsultorios(c); setConsultorioId(c[0]?.id ?? ""); });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/clinico/pacientes/${pid}/hallazgos/${h.id}/realizar`, "POST", procId ? { procedimientoId: procId, consultorioId, costoLaboratorio: Math.round(parseFloat((lab || "0").replace(",", ".")) * 100) || 0 } : {});
      onDone();
    } catch (x) {
      const d = x instanceof ApiError ? (x.data as { faltantes?: { insumo: string; requerido: number; disponible: number }[] }) : undefined;
      setError(x instanceof ApiError ? x.message + (d?.faltantes ? ": " + d.faltantes.map((f) => `${f.insumo} (necesita ${f.requerido}, hay ${f.disponible})`).join("; ") : "") : "Error");
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Marcar como realizado" className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 text-sm shadow-lg">
        <h3 className="font-semibold">Marcar como realizado: {TIPOS[h.tipo].nombre} · diente {h.diente}</h3>
        <p className="text-slate-600">Lo realizado no podrá modificarse ni borrarse. Si eliges el procedimiento, se descuentan sus insumos del consultorio y queda listo para liquidar honorarios.</p>
        <label className="block">Procedimiento del catálogo<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={procId} onChange={(e) => setProcId(e.target.value)}><option value="">Sin descargo de insumos</option>{procs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        {procId && (
          <>
            <label className="block">Consultorio<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={consultorioId} onChange={(e) => setConsultorioId(e.target.value)}>{consultorios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
            <label className="block">Costo de laboratorio (USD)<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" inputMode="decimal" value={lab} onChange={(e) => setLab(e.target.value)} /></label>
          </>
        )}
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="px-3 py-1.5 text-slate-600">Cancelar</button><button className="rounded-lg bg-sky-600 px-4 py-1.5 text-white">Confirmar</button></div>
      </form>
    </div>
  );
}

export default function Odontograma({ pid, hallazgos, puedeEscribir, puedeFirmar, onChange }: { pid: string; hallazgos: Hallazgo[]; puedeEscribir: boolean; puedeFirmar: boolean; onChange: () => void }) {
  const [dentadura, setDentadura] = useState<"permanente" | "temporal">("permanente");
  const [universal, setUniversal] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [adenda, setAdenda] = useState<Hallazgo | null>(null);
  const [realizar, setRealizar] = useState<Hallazgo | null>(null);
  const [error, setError] = useState("");
  const filas = FILAS[dentadura];
  const lista = [...hallazgos].sort((a, b) => a.diente.localeCompare(b.diente));

  async function accion(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      onChange();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {(["permanente", "temporal"] as const).map((d) => (
            <button key={d} onClick={() => { setDentadura(d); setSel(null); }} className={`px-3 py-1.5 ${dentadura === d ? "bg-sky-600 text-white" : "bg-white"}`}>
              {d === "permanente" ? "Permanente (32)" : "Temporal (20)"}
            </button>
          ))}
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {[false, true].map((u) => (
            <button key={String(u)} onClick={() => setUniversal(u)} className={`px-3 py-1.5 ${universal === u ? "bg-sky-600 text-white" : "bg-white"}`}>{u ? "Universal" : "FDI"}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {["CARIES", "RESTAURACION", "SELLANTE"].map((k) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-slate-400" style={{ background: TIPOS[k].color }} />{TIPOS[k].nombre}</span>)}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3">
        <div className="mx-auto w-max space-y-3">
          {(["superior", "inferior"] as const).map((arcada) => (
            <div key={arcada} className="flex gap-1">
              {filas[arcada].map((d, i) => (
                <div key={d} className={i === filas[arcada].length / 2 ? "ml-3 border-l border-dashed border-slate-300 pl-3" : ""}>
                  <Diente diente={d} superior={arcada === "superior"} universal={universal} hallazgos={hallazgos} sel={sel} onSel={setSel} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">Toca una superficie para marcarla o el número del diente para un hallazgo de diente completo.</p>
      </div>

      {sel && puedeEscribir && <NuevoHallazgo key={`${sel.diente}${sel.superficie}`} pid={pid} sel={sel} onDone={() => { setSel(null); onChange(); }} />}
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {lista.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="w-16 font-mono">{h.diente}{h.superficie ? `·${h.superficie}` : ""}</span>
            <span className="flex-1"><b style={{ color: TIPOS[h.tipo].color }}>{TIPOS[h.tipo].nombre}</b>{h.nota ? ` — ${h.nota}` : ""}
              {h.adendas.map((a) => <span key={a.id} className="mt-1 block rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Adenda firmada: {a.texto}</span>)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${h.estado === "REALIZADO" ? "bg-green-100 text-green-800" : h.estado === "REQUERIDO" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{ESTADO_LABEL[h.estado]}</span>
            {h.estado === "REQUERIDO" && puedeFirmar && <button className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => setRealizar(h)}>Marcar realizado</button>}
            {h.estado !== "REALIZADO" && puedeEscribir && <button className="px-2 text-xs text-red-700" onClick={() => accion(() => api(`/clinico/pacientes/${pid}/hallazgos/${h.id}`, "DELETE"))}>Eliminar</button>}
            {h.estado === "REALIZADO" && puedeFirmar && <button className="rounded border border-amber-400 px-2 py-0.5 text-xs" onClick={() => setAdenda(h)}>Adenda</button>}
          </li>
        ))}
        {!lista.length && <li className="px-4 py-6 text-center text-slate-500">Sin hallazgos registrados.</li>}
      </ul>

      {realizar && <Realizar pid={pid} h={realizar} onCancel={() => setRealizar(null)} onDone={() => { setRealizar(null); onChange(); }} />}

      {adenda && (
        <PasswordDialog
          titulo={`Adenda al hallazgo ${adenda.diente}`}
          descripcion="Lo realizado no se modifica ni se borra. La corrección queda como adenda firmada."
          conTexto
          onCancel={() => setAdenda(null)}
          onSubmit={async (password, texto) => {
            await api(`/clinico/pacientes/${pid}/hallazgos/${adenda.id}/adenda`, "POST", { password, texto });
            setAdenda(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}
