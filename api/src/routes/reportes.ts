import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// 3.4: reportes para el auditor/contador. Cada uno devuelve { resumen, filas }; con ?formato=csv se exporta `filas`.
export const reportesRouter = Router();
reportesRouter.use(authenticate, requirePermission("reportes:leer"), auditAccess("reportes"));

const periodo = z.object({ desde: z.coerce.date(), hasta: z.coerce.date(), formato: z.enum(["json", "csv"]).default("json") });

type Fila = Record<string, string | number | null>;

const csvCelda = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Se neutralizan fórmulas (=, +, -, @) para evitar inyección en hojas de cálculo.
  const seguro = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

function responder(req: Request, res: Response, nombre: string, resumen: object, filas: Fila[]) {
  if (req.query.formato === "csv") {
    const cols = filas.length ? Object.keys(filas[0]) : [];
    const csv = [cols.join(","), ...filas.map((f) => cols.map((c) => csvCelda(f[c])).join(","))].join("\n");
    return res.type("text/csv").attachment(`${nombre}.csv`).send(csv);
  }
  res.json({ resumen, filas });
}

const parse = (req: Request, res: Response) => {
  const p = periodo.safeParse(req.query);
  if (!p.success) res.status(400).json({ error: "Indica desde y hasta" });
  return p.success ? p.data : null;
};

// Corte de caja: lo cobrado por método en los turnos cerrados del periodo, con el cuadre de efectivo.
reportesRouter.get("/corte-caja", async (req, res) => {
  const p = parse(req, res);
  if (!p) return;
  const turnos = await prisma.cajaTurno.findMany({
    where: { estado: "CERRADA", cerradaAt: { gte: p.desde, lte: p.hasta } },
    include: { cobros: { include: { pagos: true } } },
    orderBy: { cerradaAt: "asc" },
  });
  const usuarios = await prisma.user.findMany({ where: { id: { in: turnos.map((t) => t.userId) } } });
  const porMetodo: Record<string, number> = {};
  const filas = turnos.map((t) => {
    const pagos = t.cobros.flatMap((c) => c.pagos);
    for (const x of pagos) porMetodo[x.metodo] = (porMetodo[x.metodo] ?? 0) + x.monto;
    const suma = (m: string) => pagos.filter((x) => x.metodo === m).reduce((s, x) => s + x.monto, 0);
    return {
      turno: t.id,
      cajero: usuarios.find((u) => u.id === t.userId)?.name ?? t.userId,
      cerradaAt: t.cerradaAt!.toISOString(),
      cobros: t.cobros.length,
      fondoInicial: t.fondoInicial,
      efectivo: suma("EFECTIVO"),
      tarjetas: suma("TARJETA_CREDITO") + suma("TARJETA_DEBITO") + suma("PASARELA"),
      transferencias: suma("TRANSFERENCIA"),
      seguros: suma("SEGURO"),
      totalCobrado: pagos.reduce((s, x) => s + x.monto, 0),
      efectivoTeorico: t.totalTeorico,
      efectivoContado: t.conteoEfectivo,
      diferencia: t.diferencia,
    };
  });
  responder(req, res, "corte-caja", { turnos: filas.length, totalCobrado: filas.reduce((s, f) => s + f.totalCobrado, 0), diferenciaTotal: filas.reduce((s, f) => s + (f.diferencia ?? 0), 0), porMetodo }, filas);
});

// Honorarios liquidados en el periodo, por profesional.
reportesRouter.get("/honorarios", async (req, res) => {
  const p = parse(req, res);
  if (!p) return;
  const liqs = await prisma.liquidacion.findMany({ where: { createdAt: { gte: p.desde, lte: p.hasta } }, include: { lineas: true }, orderBy: { createdAt: "asc" } });
  const profs = await prisma.profesional.findMany();
  const filas = liqs.map((l) => ({
    liquidacion: l.id,
    profesional: profs.find((x) => x.id === l.profesionalId)?.nombre ?? l.profesionalId,
    creada: l.createdAt.toISOString(),
    desde: l.desde.toISOString(),
    hasta: l.hasta.toISOString(),
    procedimientos: l.lineas.length,
    total: l.total,
  }));
  const pendientes = await prisma.procedimientoRealizado.count({ where: { liquidacionId: null } });
  responder(req, res, "honorarios", { liquidaciones: filas.length, total: filas.reduce((s, f) => s + f.total, 0), procedimientosSinLiquidar: pendientes }, filas);
});

// Inventario actual por consultorio, con alertas de stock mínimo y lotes por vencer (≤ 30 días).
reportesRouter.get("/inventario", async (req, res) => {
  const [insumos, lotes, consultorios] = await Promise.all([prisma.insumo.findMany(), prisma.loteInsumo.findMany(), prisma.consultorio.findMany()]);
  const limite = Date.now() + 30 * 864e5;
  const filas: Fila[] = [];
  for (const c of consultorios) {
    for (const i of insumos) {
      const suyos = lotes.filter((l) => l.consultorioId === c.id && l.insumoId === i.id);
      const stock = suyos.reduce((s, l) => s + l.cantidad, 0);
      const porVencer = suyos.filter((l) => l.cantidad > 0 && l.vence && l.vence.getTime() <= limite).reduce((s, l) => s + l.cantidad, 0);
      filas.push({ consultorio: c.nombre, insumo: i.nombre, unidad: i.unidad, stock, stockMinimo: i.stockMinimo, bajoMinimo: stock < i.stockMinimo ? "SI" : "NO", porVencer30Dias: porVencer, valorizado: stock * i.costoUnitario });
    }
  }
  responder(req, res, "inventario", { bajoMinimo: filas.filter((f) => f.bajoMinimo === "SI").length, valorTotal: filas.reduce((s, f) => s + (f.valorizado as number), 0) }, filas);
});

// Ausentismo: solo cuentan las citas ya vencidas y resueltas (atendidas, canceladas o no-show).
reportesRouter.get("/ausentismo", async (req, res) => {
  const p = parse(req, res);
  if (!p) return;
  const citas = await prisma.appointment.findMany({ where: { inicio: { gte: p.desde, lte: p.hasta, lt: new Date() } }, include: { profesional: true } });
  const resueltas = ["ATENDIDO", "CANCELADO", "NO_ASISTIO"];
  const tasa = (cs: typeof citas) => {
    const base = cs.filter((c) => resueltas.includes(c.estado));
    const noShow = base.filter((c) => c.estado === "NO_ASISTIO").length;
    return { base: base.length, noShow, tasaPct: base.length ? Math.round((noShow * 10000) / base.length) / 100 : 0 };
  };
  const nombres = [...new Set(citas.map((c) => c.profesional.nombre))];
  const filas = nombres.map((n) => {
    const cs = citas.filter((c) => c.profesional.nombre === n);
    const t = tasa(cs);
    return { profesional: n, citas: cs.length, atendidas: cs.filter((c) => c.estado === "ATENDIDO").length, canceladas: cs.filter((c) => c.estado === "CANCELADO").length, noAsistio: t.noShow, tasaNoShowPct: t.tasaPct };
  });
  responder(req, res, "ausentismo", { citas: citas.length, ...tasa(citas) }, filas);
});
