import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { decrypt, encrypt } from "../crypto.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { can, type Role } from "../roles.js";

export const pacientesRouter = Router();
pacientesRouter.use(authenticate, auditAccess("pacientes"));

const optional = z.string().trim().min(1).optional();

const anamnesisSchema = z.object({
  // Sin valores por defecto: el profesional debe responder explícitamente las preguntas críticas.
  alergias: z.array(z.string().trim().min(1)),
  anticoagulado: z.boolean(),
  coagulopatia: z.boolean(),
  enfermedades: optional,
  cirugias: optional,
  observaciones: optional,
});

const patientBase = z.object({
  cedula: z.string().trim().min(5),
  nombres: z.string().trim().min(1),
  apellidos: z.string().trim().min(1),
  fechaNacimiento: z.coerce.date().max(new Date(), "La fecha no puede ser futura"),
  sexo: z.enum(["F", "M", "O"]),
  telefono: z.string().trim().min(5),
  email: z.string().email().optional(),
  direccion: optional,
  emergenciaNombre: z.string().trim().min(1),
  emergenciaTelefono: z.string().trim().min(5),
  tutorNombre: optional,
  tutorCedula: optional,
  tutorTelefono: optional,
  seguro: optional,
  convenio: optional,
});

export function esMenor(nacimiento: Date, hoy = new Date()) {
  const m18 = new Date(nacimiento);
  m18.setFullYear(m18.getFullYear() + 18);
  return m18 > hoy;
}

// RF-01: el tutor legal es obligatorio si el paciente es menor de edad.
const needsTutor = (p: z.infer<typeof patientBase>) => !esMenor(p.fechaNacimiento) || (!!p.tutorNombre && !!p.tutorCedula && !!p.tutorTelefono);
const tutorMsg = { message: "Los menores de edad requieren tutor legal (nombre, cédula y teléfono)", path: ["tutorNombre"] };

const createSchema = patientBase.refine(needsTutor, tutorMsg).and(z.object({ anamnesis: anamnesisSchema }));
const updateSchema = patientBase.partial();

const parseList = (s: string): string[] => JSON.parse(s);

/** Alertas críticas (RF-02): se muestran como badge en la cabecera del expediente. */
function alertas(a: { alergias: string; anticoagulado: boolean; coagulopatia: boolean } | null) {
  if (!a) return [];
  return [
    ...parseList(a.alergias).map((x) => `Alergia: ${x}`),
    ...(a.anticoagulado ? ["Anticoagulado"] : []),
    ...(a.coagulopatia ? ["Coagulopatía"] : []),
  ];
}

type PatientWithAnamnesis = NonNullable<Awaited<ReturnType<typeof findPatient>>>;
const findPatient = (id: string) => prisma.patient.findUnique({ where: { id }, include: { anamnesis: true } });

function present(p: PatientWithAnamnesis, role: Role) {
  const { anamnesis, ...rest } = p;
  // El detalle clínico solo lo ve quien tiene acceso clínico; todos ven las alertas.
  const detalle =
    anamnesis && can(role, "clinico:leer")
      ? {
          alergias: parseList(anamnesis.alergias),
          anticoagulado: anamnesis.anticoagulado,
          coagulopatia: anamnesis.coagulopatia,
          enfermedades: anamnesis.enfermedades,
          cirugias: anamnesis.cirugias,
          observaciones: anamnesis.observaciones ? decrypt(anamnesis.observaciones) : null,
        }
      : undefined;
  return { ...rest, esMenor: esMenor(p.fechaNacimiento), alertas: alertas(anamnesis), anamnesis: detalle };
}

pacientesRouter.get("/", requirePermission("pacientes:leer"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const rows = await prisma.patient.findMany({
    where: q ? { OR: [{ cedula: { contains: q } }, { nombres: { contains: q } }, { apellidos: { contains: q } }] } : undefined,
    include: { anamnesis: true },
    orderBy: { apellidos: "asc" },
    take: 50,
  });
  res.json(rows.map((p) => present(p, req.user!.role)));
});

pacientesRouter.get("/:id", requirePermission("pacientes:leer"), async (req, res) => {
  const p = await findPatient(String(req.params.id));
  if (!p) return res.status(404).json({ error: "Paciente no encontrado" });
  res.json(present(p, req.user!.role));
});

pacientesRouter.post("/", requirePermission("pacientes:escribir"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", detalles: parsed.error.issues });
  const { anamnesis, ...data } = parsed.data;
  if (await prisma.patient.findUnique({ where: { cedula: data.cedula } })) {
    return res.status(409).json({ error: "Ya existe un paciente con esa cédula" });
  }
  const created = await prisma.patient.create({
    data: {
      ...data,
      anamnesis: {
        create: {
          ...anamnesis,
          alergias: JSON.stringify(anamnesis.alergias),
          observaciones: anamnesis.observaciones ? encrypt(anamnesis.observaciones) : null,
        },
      },
    },
    include: { anamnesis: true },
  });
  res.status(201).json(present(created, req.user!.role));
});

pacientesRouter.patch("/:id", requirePermission("pacientes:escribir"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", detalles: parsed.error.issues });
  const current = await findPatient(String(req.params.id));
  if (!current) return res.status(404).json({ error: "Paciente no encontrado" });
  const merged = { ...current, ...parsed.data };
  if (!needsTutor(merged as z.infer<typeof patientBase>)) {
    return res.status(400).json({ error: tutorMsg.message });
  }
  const updated = await prisma.patient.update({ where: { id: current.id }, data: parsed.data, include: { anamnesis: true } });
  res.json(present(updated, req.user!.role));
});

// La anamnesis la puede completar quien registra pacientes y el equipo clínico.
pacientesRouter.put("/:id/anamnesis", async (req, res) => {
  const role = req.user!.role;
  if (!can(role, "pacientes:escribir") && !can(role, "clinico:escribir")) return res.status(403).json({ error: "Sin permiso" });
  const parsed = anamnesisSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", detalles: parsed.error.issues });
  if (!(await prisma.patient.findUnique({ where: { id: String(req.params.id) } }))) return res.status(404).json({ error: "Paciente no encontrado" });
  const data = {
    ...parsed.data,
    alergias: JSON.stringify(parsed.data.alergias),
    observaciones: parsed.data.observaciones ? encrypt(parsed.data.observaciones) : null,
  };
  await prisma.anamnesis.upsert({ where: { patientId: String(req.params.id) }, update: data, create: { ...data, patientId: String(req.params.id) } });
  res.json(present((await findPatient(String(req.params.id)))!, role));
});
