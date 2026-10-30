import { Router, type Request } from "express";
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { config } from "../config.js";
import { decrypt, encrypt } from "../crypto.js";
import { DIENTES, ESTADOS_HALLAZGO, POR_SUPERFICIE, PUNTOS_PERIO, SUPERFICIES, TIPOS_HALLAZGO } from "../dental.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// Expediente clínico: odontograma (RF-03), periodontograma (RF-04), notas SOEP (RF-05) y RN-01.
// Se monta en /api/clinico/pacientes; todo acceso queda en el log de auditoría.
export const expedienteRouter = Router();
expedienteRouter.use(authenticate, auditAccess("clinico"));

expedienteRouter.param("pid", async (req, res, next, pid) => {
  if (!(await prisma.patient.findUnique({ where: { id: pid } }))) return res.status(404).json({ error: "Paciente no encontrado" });
  next();
});

const leer = requirePermission("clinico:leer");
const escribir = requirePermission("clinico:escribir");
const firmar = requirePermission("clinico:firmar");

/** Firma simple: se vuelve a pedir la contraseña y se sella el contenido con un HMAC. */
async function reautenticar(req: Request, password: string) {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
  return !!u && (await bcrypt.compare(password, u.passwordHash));
}
const sello = (...partes: (string | null)[]) => createHmac("sha256", config.jwtSecret).update(JSON.stringify(partes)).digest("hex");

const password = z.object({ password: z.string().min(1) });

// ---------- Odontograma ----------

const hallazgoSchema = z
  .object({
    diente: z.string().refine((d) => DIENTES.has(d), "Diente FDI inválido"),
    superficie: z.enum(SUPERFICIES).nullish(),
    tipo: z.enum(TIPOS_HALLAZGO),
    estado: z.enum(["EXISTENTE", "REQUERIDO"]),
    nota: z.string().trim().min(1).optional(),
  })
  .refine((h) => (POR_SUPERFICIE.includes(h.tipo) ? !!h.superficie : !h.superficie), {
    message: "Caries, restauración y sellante se marcan por superficie; los demás hallazgos afectan al diente completo",
    path: ["superficie"],
  });

expedienteRouter.get("/:pid/odontograma", leer, async (req, res) => {
  const hallazgos = await prisma.hallazgo.findMany({ where: { patientId: req.params.pid }, include: { adendas: true }, orderBy: { createdAt: "asc" } });
  res.json({ hallazgos });
});

expedienteRouter.post("/:pid/hallazgos", escribir, async (req, res) => {
  const p = hallazgoSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const h = await prisma.hallazgo.create({ data: { ...p.data, superficie: p.data.superficie ?? null, patientId: req.params.pid, creadoPorId: req.user!.id } });
  res.status(201).json(h);
});

async function hallazgoDe(req: Request) {
  return prisma.hallazgo.findFirst({ where: { id: req.params.hid, patientId: req.params.pid } });
}

expedienteRouter.patch("/:pid/hallazgos/:hid", escribir, async (req, res) => {
  const p = z.object({ estado: z.enum(["EXISTENTE", "REQUERIDO"]).optional(), nota: z.string().trim().min(1).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  const h = await hallazgoDe(req);
  if (!h) return res.status(404).json({ error: "Hallazgo no encontrado" });
  if (h.estado === "REALIZADO") return res.status(409).json({ error: "Un procedimiento realizado no se modifica: registre una adenda (RN-01)" });
  res.json(await prisma.hallazgo.update({ where: { id: h.id }, data: p.data }));
});

// RN-01: lo realizado nunca se borra.
expedienteRouter.delete("/:pid/hallazgos/:hid", escribir, async (req, res) => {
  const h = await hallazgoDe(req);
  if (!h) return res.status(404).json({ error: "Hallazgo no encontrado" });
  if (h.estado === "REALIZADO") return res.status(409).json({ error: "Un procedimiento realizado no puede borrarse: registre una adenda (RN-01)" });
  await prisma.hallazgo.delete({ where: { id: h.id } });
  res.status(204).end();
});

expedienteRouter.post("/:pid/hallazgos/:hid/realizar", firmar, async (req, res) => {
  const h = await hallazgoDe(req);
  if (!h) return res.status(404).json({ error: "Hallazgo no encontrado" });
  if (h.estado !== "REQUERIDO") return res.status(409).json({ error: "Solo un hallazgo REQUERIDO puede marcarse como realizado" });
  res.json(await prisma.hallazgo.update({ where: { id: h.id }, data: { estado: "REALIZADO", realizadoAt: new Date(), realizadoPorId: req.user!.id } }));
});

const adendaSchema = password.extend({ texto: z.string().trim().min(5) });

expedienteRouter.post("/:pid/hallazgos/:hid/adenda", firmar, async (req, res) => {
  const p = adendaSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Escribe el texto de la adenda y tu contraseña para firmar" });
  const h = await hallazgoDe(req);
  if (!h) return res.status(404).json({ error: "Hallazgo no encontrado" });
  if (!(await reautenticar(req, p.data.password))) return res.status(401).json({ error: "Contraseña incorrecta: no se pudo firmar" });
  const adenda = await prisma.adenda.create({
    data: { hallazgoId: h.id, texto: encrypt(p.data.texto), autorId: req.user!.id, firmaHash: sello(h.id, p.data.texto, req.user!.id, new Date().toISOString()) },
  });
  res.status(201).json({ ...adenda, texto: p.data.texto });
});

// ---------- Periodontograma ----------

const puntoSchema = z.object({
  punto: z.enum(PUNTOS_PERIO),
  profundidad: z.number().int().min(0).max(15), // mm al sondaje
  margen: z.number().int().min(-10).max(15), // recesión en mm (negativo si el margen cubre el límite amelocementario)
  sangrado: z.boolean(),
});

const perioSchema = z.object({
  dientes: z
    .array(
      z.object({
        diente: z.string().refine((d) => DIENTES.has(d), "Diente FDI inválido"),
        puntos: z.array(puntoSchema).length(6).refine((ps) => new Set(ps.map((x) => x.punto)).size === 6, "Faltan o se repiten sitios de sondaje"),
        furca: z.number().int().min(0).max(3),
        movilidad: z.number().int().min(0).max(3),
      }),
    )
    .min(1),
});

// NIC = profundidad al sondaje + recesión gingival.
const conNic = (puntos: z.infer<typeof puntoSchema>[]) => puntos.map((x) => ({ ...x, nic: x.profundidad + x.margen }));

expedienteRouter.post("/:pid/periodontograma", escribir, async (req, res) => {
  const p = perioSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const e = await prisma.perioExamen.create({
    data: {
      patientId: req.params.pid,
      autorId: req.user!.id,
      dientes: { create: p.data.dientes.map((d) => ({ diente: d.diente, puntos: JSON.stringify(d.puntos), furca: d.furca, movilidad: d.movilidad })) },
    },
    include: { dientes: true },
  });
  res.status(201).json({ ...e, dientes: e.dientes.map((d) => ({ ...d, puntos: conNic(JSON.parse(d.puntos)) })) });
});

expedienteRouter.get("/:pid/periodontograma", leer, async (req, res) => {
  const examenes = await prisma.perioExamen.findMany({ where: { patientId: req.params.pid }, include: { dientes: true }, orderBy: { createdAt: "desc" } });
  res.json(examenes.map((e) => ({ ...e, dientes: e.dientes.map((d) => ({ ...d, puntos: conNic(JSON.parse(d.puntos)) })) })));
});

// ---------- Notas SOEP ----------

const notaSchema = z.object({
  subjetivo: z.string().trim().min(1),
  objetivo: z.string().trim().min(1),
  evaluacion: z.string().trim().min(1),
  plan: z.string().trim().min(1),
  appointmentId: z.string().optional(),
});

type NotaDb = NonNullable<Awaited<ReturnType<typeof prisma.notaSoep.findFirst>>>;
const bloqueaEn = (n: NotaDb) => new Date(n.createdAt.getTime() + config.soepLockHours * 3600e3);
const bloqueada = (n: NotaDb) => !!n.firmaHash || bloqueaEn(n) <= new Date();

type NotaConAdendas = NotaDb & { adendas: { texto: string }[] };
function presentNota(n: NotaConAdendas) {
  return {
    ...n,
    subjetivo: decrypt(n.subjetivo),
    objetivo: decrypt(n.objetivo),
    evaluacion: decrypt(n.evaluacion),
    plan: decrypt(n.plan),
    firmada: !!n.firmaHash,
    bloqueada: bloqueada(n),
    bloqueaEn: bloqueaEn(n),
    adendas: n.adendas.map((a) => ({ ...a, texto: decrypt(a.texto) })),
  };
}

expedienteRouter.get("/:pid/notas", leer, async (req, res) => {
  const notas = await prisma.notaSoep.findMany({ where: { patientId: req.params.pid }, include: { adendas: true }, orderBy: { createdAt: "desc" } });
  res.json(notas.map(presentNota));
});

expedienteRouter.post("/:pid/notas", escribir, async (req, res) => {
  const p = notaSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Completa los cuatro campos SOEP", detalles: p.error.issues });
  const n = await prisma.notaSoep.create({
    data: {
      patientId: req.params.pid,
      appointmentId: p.data.appointmentId,
      autorId: req.user!.id,
      subjetivo: encrypt(p.data.subjetivo),
      objetivo: encrypt(p.data.objetivo),
      evaluacion: encrypt(p.data.evaluacion),
      plan: encrypt(p.data.plan),
    },
    include: { adendas: true },
  });
  res.status(201).json(presentNota(n));
});

async function notaDe(req: Request) {
  return prisma.notaSoep.findFirst({ where: { id: req.params.nid, patientId: req.params.pid }, include: { adendas: true } });
}

// Se puede editar solo mientras no esté firmada ni haya vencido el plazo, y solo por su autor.
expedienteRouter.patch("/:pid/notas/:nid", escribir, async (req, res) => {
  const p = notaSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  const n = await notaDe(req);
  if (!n) return res.status(404).json({ error: "Nota no encontrada" });
  if (bloqueada(n)) return res.status(409).json({ error: "La nota está bloqueada: registre una adenda firmada" });
  if (n.autorId !== req.user!.id) return res.status(403).json({ error: "Solo el autor puede editar la nota" });
  const data = {
    subjetivo: p.data.subjetivo && encrypt(p.data.subjetivo),
    objetivo: p.data.objetivo && encrypt(p.data.objetivo),
    evaluacion: p.data.evaluacion && encrypt(p.data.evaluacion),
    plan: p.data.plan && encrypt(p.data.plan),
  };
  res.json(presentNota(await prisma.notaSoep.update({ where: { id: n.id }, data, include: { adendas: true } })));
});

expedienteRouter.post("/:pid/notas/:nid/firmar", firmar, async (req, res) => {
  const p = password.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Ingresa tu contraseña para firmar" });
  const n = await notaDe(req);
  if (!n) return res.status(404).json({ error: "Nota no encontrada" });
  if (n.firmaHash) return res.status(409).json({ error: "La nota ya está firmada" });
  if (!(await reautenticar(req, p.data.password))) return res.status(401).json({ error: "Contraseña incorrecta: no se pudo firmar" });
  const ahora = new Date();
  const firmaHash = sello(n.id, decrypt(n.subjetivo), decrypt(n.objetivo), decrypt(n.evaluacion), decrypt(n.plan), req.user!.id, ahora.toISOString());
  res.json(presentNota(await prisma.notaSoep.update({ where: { id: n.id }, data: { firmadaAt: ahora, firmadaPorId: req.user!.id, firmaHash }, include: { adendas: true } })));
});

expedienteRouter.post("/:pid/notas/:nid/adenda", firmar, async (req, res) => {
  const p = adendaSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Escribe el texto de la adenda y tu contraseña para firmar" });
  const n = await notaDe(req);
  if (!n) return res.status(404).json({ error: "Nota no encontrada" });
  if (!bloqueada(n)) return res.status(409).json({ error: "La nota aún es editable: corríjala directamente" });
  if (!(await reautenticar(req, p.data.password))) return res.status(401).json({ error: "Contraseña incorrecta: no se pudo firmar" });
  const adenda = await prisma.adenda.create({
    data: { notaId: n.id, texto: encrypt(p.data.texto), autorId: req.user!.id, firmaHash: sello(n.id, p.data.texto, req.user!.id, new Date().toISOString()) },
  });
  res.status(201).json({ ...adenda, texto: p.data.texto });
});
