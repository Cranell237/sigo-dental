import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { ROLES } from "../roles.js";

// Gestión de usuarios (administrador, SRS §3). Toda acción queda en el log de auditoría.
export const usuariosRouter = Router();
usuariosRouter.use(authenticate, requirePermission("usuarios:gestionar"), auditAccess("usuarios"));

// Política mínima: 8 caracteres con al menos una letra y un número.
const password = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/[A-Za-z]/, "La contraseña debe incluir una letra")
  .regex(/\d/, "La contraseña debe incluir un número");

const select = { id: true, name: true, email: true, role: true, activo: true, mfaEnabled: true, createdAt: true } as const;
const ESPECIALIDAD_POR_DEFECTO = "Odontología general";

/** Cierra todas las sesiones del usuario (sus refresh tokens dejan de servir). */
const cerrarSesiones = (userId: string) => prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });

const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Datos inválidos";

async function conProfesional() {
  const [usuarios, profesionales] = await Promise.all([prisma.user.findMany({ select, orderBy: [{ activo: "desc" }, { name: "asc" }] }), prisma.profesional.findMany()]);
  return usuarios.map((u) => ({ ...u, especialidad: profesionales.find((p) => p.userId === u.id)?.especialidad ?? null }));
}

usuariosRouter.get("/", async (_req, res) => {
  res.json(await conProfesional());
});

const crearSchema = z.object({
  name: z.string().trim().min(3, "Escribe el nombre completo"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  role: z.enum(ROLES),
  password,
  especialidad: z.string().trim().min(2).optional(),
});

usuariosRouter.post("/", async (req, res) => {
  const p = crearSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: primerError(p.error) });
  if (await prisma.user.findUnique({ where: { email: p.data.email } })) return res.status(409).json({ error: "Ya existe un usuario con ese correo" });

  const usuario = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { name: p.data.name, email: p.data.email, role: p.data.role, passwordHash: await bcrypt.hash(p.data.password, 10) },
      select,
    });
    // Un odontólogo también es un profesional de la agenda.
    if (u.role === "ODONTOLOGO") await tx.profesional.create({ data: { userId: u.id, nombre: u.name, especialidad: p.data.especialidad ?? ESPECIALIDAD_POR_DEFECTO } });
    return u;
  });
  res.status(201).json(usuario);
});

const editarSchema = z.object({
  name: z.string().trim().min(3).optional(),
  role: z.enum(ROLES).optional(),
  activo: z.boolean().optional(),
  especialidad: z.string().trim().min(2).optional(),
});

// Nadie puede cambiarse el rol ni desactivarse a sí mismo: así siempre queda al menos el administrador
// que hace el cambio, y el sistema nunca se queda sin administradores.
const esUnoMismo = (req: Request) => String(req.params.id) === req.user!.id;

usuariosRouter.patch("/:id", async (req, res) => {
  const p = editarSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: primerError(p.error) });
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  if (esUnoMismo(req) && (p.data.role !== undefined || p.data.activo !== undefined)) {
    return res.status(409).json({ error: "No puedes cambiar tu propio rol ni desactivarte" });
  }

  const actualizado = await prisma.$transaction(async (tx) => {
    const r = await tx.user.update({ where: { id: u.id }, data: { name: p.data.name, role: p.data.role, activo: p.data.activo }, select });
    const prof = await tx.profesional.findUnique({ where: { userId: u.id } });
    if (r.role === "ODONTOLOGO" && !prof) {
      await tx.profesional.create({ data: { userId: u.id, nombre: r.name, especialidad: p.data.especialidad ?? ESPECIALIDAD_POR_DEFECTO } });
    } else if (prof && (p.data.name || p.data.especialidad)) {
      await tx.profesional.update({ where: { id: prof.id }, data: { nombre: p.data.name, especialidad: p.data.especialidad } });
    }
    return r;
  });
  // Al cambiar el rol o desactivar, la sesión vigente deja de servir.
  if (p.data.role !== undefined || p.data.activo === false) await cerrarSesiones(u.id);
  res.json(actualizado);
});

usuariosRouter.post("/:id/password", async (req, res) => {
  const p = z.object({ password }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: primerError(p.error) });
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(p.data.password, 10) } });
  await cerrarSesiones(u.id);
  res.status(204).end();
});

// Si el usuario perdió su teléfono: borra su MFA y tendrá que volver a enrolarse al iniciar sesión.
usuariosRouter.post("/:id/reset-mfa", async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
  await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: false, mfaSecret: null } });
  await cerrarSesiones(u.id);
  res.status(204).end();
});
