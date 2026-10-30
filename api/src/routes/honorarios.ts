import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// RF-13: liquidación de honorarios. Todo el cálculo es en enteros (centavos y puntos básicos),
// por lo que no hay errores de redondeo de punto flotante.
export const honorariosRouter = Router();
honorariosRouter.use(authenticate, auditAccess("honorarios"));

export const MODALIDADES = ["PORCENTAJE", "MONTO_FIJO", "PORCENTAJE_NETO"] as const;
export type Modalidad = (typeof MODALIDADES)[number];

/**
 * - PORCENTAJE: `valor` en puntos básicos (4000 = 40,00 %) sobre el precio.
 * - MONTO_FIJO: `valor` en centavos por procedimiento.
 * - PORCENTAJE_NETO: puntos básicos sobre el precio menos materiales y laboratorio (nunca negativo).
 * El porcentaje se redondea al centavo más cercano (mitades hacia arriba), con aritmética entera.
 */
export function calcularComision(modalidad: Modalidad, valor: number, p: { precio: number; costoMateriales: number; costoLaboratorio: number }) {
  if (modalidad === "MONTO_FIJO") return { base: p.precio, comision: valor };
  const base = modalidad === "PORCENTAJE" ? p.precio : Math.max(0, p.precio - p.costoMateriales - p.costoLaboratorio);
  return { base, comision: Math.floor((base * valor + 5000) / 10000) };
}

const leer = requirePermission("honorarios:leer");

honorariosRouter.get("/reglas", leer, async (req, res) => {
  const profesionalId = z.string().optional().parse(req.query.profesionalId);
  res.json(await prisma.reglaHonorario.findMany({ where: { profesionalId }, orderBy: { profesionalId: "asc" } }));
});

const reglaSchema = z
  .object({ profesionalId: z.string(), procedimientoId: z.string().optional(), modalidad: z.enum(MODALIDADES), valor: z.number().int().min(0) })
  .refine((r) => r.modalidad === "MONTO_FIJO" || r.valor <= 10000, { message: "El porcentaje no puede superar 100 % (10000 puntos básicos)", path: ["valor"] });

// Una regla por profesional y procedimiento (o general): crear la misma combinación la reemplaza.
honorariosRouter.put("/reglas", requirePermission("honorarios:configurar"), async (req, res) => {
  const p = reglaSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  if (!(await prisma.profesional.findUnique({ where: { id: p.data.profesionalId } }))) return res.status(404).json({ error: "Profesional no encontrado" });
  const existente = await prisma.reglaHonorario.findFirst({ where: { profesionalId: p.data.profesionalId, procedimientoId: p.data.procedimientoId ?? null } });
  const regla = existente
    ? await prisma.reglaHonorario.update({ where: { id: existente.id }, data: { modalidad: p.data.modalidad, valor: p.data.valor } })
    : await prisma.reglaHonorario.create({ data: { ...p.data, procedimientoId: p.data.procedimientoId ?? null } });
  res.json(regla);
});

const periodoSchema = z.object({ profesionalId: z.string(), desde: z.coerce.date(), hasta: z.coerce.date() });

async function calcular(profesionalId: string, desde: Date, hasta: Date) {
  const [pendientes, reglas, procs] = await Promise.all([
    prisma.procedimientoRealizado.findMany({ where: { profesionalId, liquidacionId: null, realizadoAt: { gte: desde, lte: hasta } }, orderBy: { realizadoAt: "asc" } }),
    prisma.reglaHonorario.findMany({ where: { profesionalId } }),
    prisma.procedimiento.findMany(),
  ]);
  const lineas: { realizadoId: string; descripcion: string; base: number; modalidad: Modalidad; valor: number; comision: number }[] = [];
  const sinRegla: { realizadoId: string; descripcion: string }[] = [];
  for (const r of pendientes) {
    const regla = reglas.find((x) => x.procedimientoId === r.procedimientoId) ?? reglas.find((x) => x.procedimientoId === null);
    const descripcion = procs.find((x) => x.id === r.procedimientoId)?.nombre ?? r.procedimientoId;
    if (!regla) {
      sinRegla.push({ realizadoId: r.id, descripcion });
      continue;
    }
    const { base, comision } = calcularComision(regla.modalidad as Modalidad, regla.valor, r);
    lineas.push({ realizadoId: r.id, descripcion, base, modalidad: regla.modalidad as Modalidad, valor: regla.valor, comision });
  }
  return { lineas, sinRegla, total: lineas.reduce((s, l) => s + l.comision, 0) };
}

const gestionar = requirePermission("honorarios:gestionar");

honorariosRouter.get("/previsualizar", gestionar, async (req, res) => {
  const p = periodoSchema.safeParse(req.query);
  if (!p.success) return res.status(400).json({ error: "Indica profesionalId, desde y hasta" });
  res.json(await calcular(p.data.profesionalId, p.data.desde, p.data.hasta));
});

honorariosRouter.post("/liquidar", gestionar, async (req, res) => {
  const p = periodoSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Indica profesionalId, desde y hasta" });
  const calc = await calcular(p.data.profesionalId, p.data.desde, p.data.hasta);
  if (!calc.lineas.length) return res.status(409).json({ error: "No hay procedimientos pendientes de liquidar con regla de honorarios en ese periodo", sinRegla: calc.sinRegla });

  const liquidacion = await prisma.$transaction(async (tx) => {
    const l = await tx.liquidacion.create({
      data: { profesionalId: p.data.profesionalId, desde: p.data.desde, hasta: p.data.hasta, total: calc.total, creadaPorId: req.user!.id, lineas: { create: calc.lineas } },
      include: { lineas: true },
    });
    // Cada procedimiento se liquida una sola vez (el trigger impide volver a modificarlo).
    await tx.procedimientoRealizado.updateMany({ where: { id: { in: calc.lineas.map((x) => x.realizadoId) } }, data: { liquidacionId: l.id } });
    return l;
  });
  res.status(201).json({ ...liquidacion, sinRegla: calc.sinRegla });
});

honorariosRouter.get("/liquidaciones", leer, async (req, res) => {
  const profesionalId = z.string().optional().parse(req.query.profesionalId);
  res.json(await prisma.liquidacion.findMany({ where: { profesionalId }, include: { lineas: true }, orderBy: { createdAt: "desc" }, take: 50 }));
});
