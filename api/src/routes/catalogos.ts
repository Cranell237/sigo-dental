import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// 1.3: catálogos. Lectura para todo el personal; alta/edición solo para el administrador.
export const catalogosRouter = Router();
catalogosRouter.use(authenticate);

const leer = requirePermission("catalogos:leer");
const gestionar = requirePermission("catalogos:gestionar");

catalogosRouter.get("/consultorios", leer, async (_req, res) => {
  res.json(await prisma.consultorio.findMany({ include: { sillones: true }, orderBy: { nombre: "asc" } }));
});

catalogosRouter.post("/consultorios", gestionar, async (req, res) => {
  const p = z.object({ nombre: z.string().trim().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  if (await prisma.consultorio.findUnique({ where: { nombre: p.data.nombre } })) return res.status(409).json({ error: "Ya existe" });
  res.status(201).json(await prisma.consultorio.create({ data: p.data }));
});

catalogosRouter.post("/consultorios/:id/sillones", gestionar, async (req, res) => {
  const p = z.object({ nombre: z.string().trim().min(1) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  if (!(await prisma.consultorio.findUnique({ where: { id: req.params.id } }))) return res.status(404).json({ error: "Consultorio no encontrado" });
  try {
    res.status(201).json(await prisma.sillon.create({ data: { ...p.data, consultorioId: req.params.id } }));
  } catch {
    res.status(409).json({ error: "Ya existe un sillón con ese nombre en el consultorio" });
  }
});

catalogosRouter.get("/profesionales", leer, async (_req, res) => {
  res.json(await prisma.profesional.findMany({ orderBy: { nombre: "asc" } }));
});

catalogosRouter.post("/profesionales", gestionar, async (req, res) => {
  const p = z.object({ nombre: z.string().trim().min(1), especialidad: z.string().trim().min(1), userId: z.string().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  res.status(201).json(await prisma.profesional.create({ data: p.data }));
});

catalogosRouter.get("/procedimientos", leer, async (_req, res) => {
  res.json(await prisma.procedimiento.findMany({ orderBy: { codigo: "asc" } }));
});

// precioBase en centavos (entero) para no perder precisión (RF-13).
catalogosRouter.post("/procedimientos", gestionar, async (req, res) => {
  const p = z
    .object({ codigo: z.string().trim().min(1), nombre: z.string().trim().min(1), precioBase: z.number().int().nonnegative() })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  if (await prisma.procedimiento.findUnique({ where: { codigo: p.data.codigo } })) return res.status(409).json({ error: "El código ya existe" });
  res.status(201).json(await prisma.procedimiento.create({ data: p.data }));
});
