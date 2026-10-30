import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

export const citasRouter = Router();
citasRouter.use(authenticate, auditAccess("citas"));

// RF-10: estados y transiciones válidas.
export const ESTADOS = ["PROGRAMADO", "CONFIRMADO", "EN_SALA_ESPERA", "EN_ATENCION", "ATENDIDO", "CANCELADO", "NO_ASISTIO"] as const;
export type Estado = (typeof ESTADOS)[number];

export const TRANSICIONES: Record<Estado, Estado[]> = {
  PROGRAMADO: ["CONFIRMADO", "CANCELADO", "NO_ASISTIO"],
  CONFIRMADO: ["EN_SALA_ESPERA", "CANCELADO", "NO_ASISTIO"],
  EN_SALA_ESPERA: ["EN_ATENCION", "CANCELADO", "NO_ASISTIO"],
  EN_ATENCION: ["ATENDIDO"],
  ATENDIDO: [],
  CANCELADO: [],
  NO_ASISTIO: [],
};

// Las citas canceladas o con no-show liberan el sillón.
const LIBERAN = ["CANCELADO", "NO_ASISTIO"];

class Conflicto extends Error {}

const createSchema = z
  .object({
    patientId: z.string(),
    profesionalId: z.string(),
    sillonId: z.string(),
    inicio: z.coerce.date(),
    fin: z.coerce.date(),
    motivo: z.string().trim().min(1).optional(),
  })
  .refine((c) => c.fin > c.inicio, { message: "La hora de fin debe ser posterior al inicio", path: ["fin"] });

const include = { patient: { select: { id: true, nombres: true, apellidos: true } }, profesional: true, sillon: { include: { consultorio: true } } };

citasRouter.get("/", requirePermission("agenda:leer"), async (req, res) => {
  const q = z
    .object({ desde: z.coerce.date(), hasta: z.coerce.date(), sillonId: z.string().optional(), profesionalId: z.string().optional() })
    .safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Indica desde y hasta (vista día o semana)" });
  res.json(
    await prisma.appointment.findMany({
      where: {
        inicio: { lt: q.data.hasta },
        fin: { gt: q.data.desde },
        sillonId: q.data.sillonId,
        profesionalId: q.data.profesionalId,
      },
      include,
      orderBy: { inicio: "asc" },
    }),
  );
});

// RN-03: no se permiten dos citas activas simultáneas en el mismo sillón.
// Se inserta primero (esto toma el bloqueo de escritura de SQLite, serializando las peticiones
// concurrentes) y luego se valida dentro de la misma transacción; si hay choque se revierte.
citasRouter.post("/", requirePermission("agenda:gestionar"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", detalles: parsed.error.issues });
  const d = parsed.data;

  const [patient, profesional, sillon] = await Promise.all([
    prisma.patient.findUnique({ where: { id: d.patientId } }),
    prisma.profesional.findUnique({ where: { id: d.profesionalId } }),
    prisma.sillon.findUnique({ where: { id: d.sillonId } }),
  ]);
  if (!patient || !profesional || !sillon) return res.status(404).json({ error: "Paciente, profesional o sillón no existe" });

  try {
    const cita = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({ data: d });
      const choque = await tx.appointment.count({
        where: { sillonId: d.sillonId, id: { not: created.id }, estado: { notIn: LIBERAN }, inicio: { lt: d.fin }, fin: { gt: d.inicio } },
      });
      if (choque > 0) throw new Conflicto();
      return created;
    });
    res.status(201).json(await prisma.appointment.findUnique({ where: { id: cita.id }, include }));
  } catch (e) {
    if (e instanceof Conflicto) return res.status(409).json({ error: "El sillón ya está ocupado en ese horario" });
    throw e;
  }
});

citasRouter.patch("/:id/estado", requirePermission("agenda:gestionar"), async (req, res) => {
  const p = z.object({ estado: z.enum(ESTADOS) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Estado inválido" });
  const cita = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!cita) return res.status(404).json({ error: "Cita no encontrada" });
  if (!TRANSICIONES[cita.estado as Estado].includes(p.data.estado)) {
    return res.status(409).json({ error: `Transición no permitida: ${cita.estado} → ${p.data.estado}` });
  }
  res.json(await prisma.appointment.update({ where: { id: cita.id }, data: { estado: p.data.estado }, include }));
});
