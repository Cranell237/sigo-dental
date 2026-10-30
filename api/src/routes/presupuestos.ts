import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { can } from "../roles.js";
import { Conflicto, crearCitaEn } from "./citas.js";

// RF-07 / RF-08: presupuestos por fases y sesiones, aprobación total o parcial y paso a citas.
// Todos los importes son enteros en centavos.
export const presupuestosRouter = Router();
presupuestosRouter.use(authenticate, auditAccess("presupuestos"));

type Item = { cantidad: number; precioUnitario: number; costoLaboratorio: number; estado: string; fase: number; sesion: number };
const totalItem = (i: Pick<Item, "cantidad" | "precioUnitario" | "costoLaboratorio">) => i.cantidad * i.precioUnitario + i.costoLaboratorio;

/** Descuento prorrateado sobre el subtotal aprobado (el redondeo se hace una sola vez, en enteros). */
export function totales(items: Item[], descuento: number) {
  const subtotal = items.reduce((s, i) => s + totalItem(i), 0);
  const aprobados = items.filter((i) => i.estado === "APROBADO" || i.estado === "AGENDADO");
  const subtotalAprobado = aprobados.reduce((s, i) => s + totalItem(i), 0);
  const descuentoAprobado = subtotal ? Math.round((descuento * subtotalAprobado) / subtotal) : 0;
  const porFase: Record<string, number> = {};
  for (const i of items) porFase[i.fase] = (porFase[i.fase] ?? 0) + totalItem(i);
  return { subtotal, descuento, total: subtotal - descuento, subtotalAprobado, totalAprobado: subtotalAprobado - descuentoAprobado, porFase };
}

const conTotales = <T extends { items: Item[]; descuento: number }>(p: T) => ({ ...p, totales: totales(p.items, p.descuento) });
const incluir = { items: { orderBy: [{ fase: "asc" as const }, { sesion: "asc" as const }] } };

const itemSchema = z.object({
  fase: z.number().int().min(1),
  sesion: z.number().int().min(1),
  procedimientoId: z.string(),
  diente: z.string().optional(),
  cantidad: z.number().int().min(1).default(1),
  honorario: z.number().int().min(0).default(0),
  costoLaboratorio: z.number().int().min(0).default(0),
});

const crearSchema = z.object({ patientId: z.string(), items: z.array(itemSchema).min(1), descuento: z.number().int().min(0).default(0) });

presupuestosRouter.post("/", requirePermission("presupuestos:gestionar"), async (req, res) => {
  const p = crearSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  if (!(await prisma.patient.findUnique({ where: { id: p.data.patientId } }))) return res.status(404).json({ error: "Paciente no encontrado" });

  const procs = await prisma.procedimiento.findMany({ where: { id: { in: p.data.items.map((i) => i.procedimientoId) } } });
  const items = p.data.items.map((i) => {
    const proc = procs.find((x) => x.id === i.procedimientoId);
    return proc ? { ...i, descripcion: proc.nombre, precioUnitario: proc.precioBase } : null;
  });
  if (items.includes(null)) return res.status(404).json({ error: "Algún procedimiento no existe en el catálogo" });
  const validos = items as NonNullable<(typeof items)[number]>[];

  if (validos.some((i) => i.honorario > i.precioUnitario)) return res.status(400).json({ error: "El honorario por unidad no puede superar el precio del procedimiento" });
  const subtotal = validos.reduce((s, i) => s + totalItem({ ...i, estado: "" } as Item), 0);
  if (p.data.descuento > subtotal) return res.status(400).json({ error: "El descuento no puede superar el subtotal" });
  // Solo quien puede firmar clínicamente (el odontólogo) autoriza descuentos.
  if (p.data.descuento > 0 && !can(req.user!.role, "clinico:firmar")) return res.status(403).json({ error: "El descuento requiere autorización del odontólogo" });

  const creado = await prisma.presupuesto.create({
    data: {
      patientId: p.data.patientId,
      autorId: req.user!.id,
      descuento: p.data.descuento,
      autorizadoPorId: p.data.descuento > 0 ? req.user!.id : null,
      items: { create: validos },
    },
    include: incluir,
  });
  res.status(201).json(conTotales(creado));
});

presupuestosRouter.get("/", requirePermission("presupuestos:leer"), async (req, res) => {
  const patientId = z.string().safeParse(req.query.patientId);
  if (!patientId.success) return res.status(400).json({ error: "Indica patientId" });
  const filas = await prisma.presupuesto.findMany({ where: { patientId: patientId.data }, include: incluir, orderBy: { createdAt: "desc" } });
  res.json(filas.map(conTotales));
});

// Ítems aprobados que aún no tienen cita: las "tareas agendables".
presupuestosRouter.get("/agendables", requirePermission("presupuestos:leer"), async (req, res) => {
  const patientId = z.string().safeParse(req.query.patientId);
  if (!patientId.success) return res.status(400).json({ error: "Indica patientId" });
  res.json(await prisma.presupuestoItem.findMany({ where: { estado: "APROBADO", presupuesto: { patientId: patientId.data } }, orderBy: [{ fase: "asc" }, { sesion: "asc" }] }));
});

presupuestosRouter.post("/:id/presentar", requirePermission("presupuestos:gestionar"), async (req, res) => {
  const p = await prisma.presupuesto.findUnique({ where: { id: String(req.params.id) } });
  if (!p) return res.status(404).json({ error: "Presupuesto no encontrado" });
  if (p.estado !== "BORRADOR") return res.status(409).json({ error: "Solo un borrador puede presentarse" });
  res.json(conTotales(await prisma.presupuesto.update({ where: { id: p.id }, data: { estado: "PRESENTADO" }, include: incluir })));
});

// RF-08: aprobación total (sin itemIds) o parcial (itemIds). Lo no elegido queda rechazado.
presupuestosRouter.post("/:id/aprobar", requirePermission("presupuestos:aprobar"), async (req, res) => {
  const body = z.object({ itemIds: z.array(z.string()).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Datos inválidos" });
  const p = await prisma.presupuesto.findUnique({ where: { id: String(req.params.id) }, include: incluir });
  if (!p) return res.status(404).json({ error: "Presupuesto no encontrado" });
  if (p.estado !== "PRESENTADO") return res.status(409).json({ error: "El presupuesto debe estar presentado al paciente para aprobarse" });

  const elegidos = new Set(body.data.itemIds ?? p.items.map((i) => i.id));
  if ([...elegidos].some((id) => !p.items.some((i) => i.id === id))) return res.status(400).json({ error: "Algún ítem no pertenece a este presupuesto" });

  const estado = elegidos.size === 0 ? "RECHAZADO" : elegidos.size === p.items.length ? "APROBADO" : "APROBADO_PARCIAL";
  await prisma.$transaction([
    ...p.items.map((i) => prisma.presupuestoItem.update({ where: { id: i.id }, data: { estado: elegidos.has(i.id) ? "APROBADO" : "RECHAZADO" } })),
    prisma.presupuesto.update({ where: { id: p.id }, data: { estado, aprobadoAt: new Date() } }),
  ]);
  res.json(conTotales((await prisma.presupuesto.findUniqueOrThrow({ where: { id: p.id }, include: incluir }))));
});

const agendarSchema = z
  .object({ profesionalId: z.string(), sillonId: z.string(), inicio: z.coerce.date(), fin: z.coerce.date() })
  .refine((c) => c.fin > c.inicio, { message: "La hora de fin debe ser posterior al inicio", path: ["fin"] });

// Convierte un ítem aprobado en una cita real, respetando la regla de no solapamiento (RN-03).
presupuestosRouter.post("/items/:iid/agendar", requirePermission("agenda:gestionar"), async (req, res) => {
  const p = agendarSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const item = await prisma.presupuestoItem.findUnique({ where: { id: String(req.params.iid) }, include: { presupuesto: true } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });
  if (item.estado !== "APROBADO") return res.status(409).json({ error: "Solo un ítem aprobado y sin cita puede agendarse" });

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const cita = await crearCitaEn(tx, { ...p.data, patientId: item.presupuesto.patientId, motivo: `${item.descripcion}${item.diente ? ` (diente ${item.diente})` : ""}` });
      const actualizado = await tx.presupuestoItem.update({ where: { id: item.id }, data: { estado: "AGENDADO", appointmentId: cita.id } });
      return { item: actualizado, cita };
    });
    res.status(201).json(resultado);
  } catch (e) {
    if (e instanceof Conflicto) return res.status(409).json({ error: "El sillón ya está ocupado en ese horario" });
    throw e;
  }
});
