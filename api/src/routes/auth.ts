import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { recordAudit } from "../audit.js";
import { decrypt, encrypt } from "../crypto.js";
import { authenticateBasic } from "../middleware/auth.js";
import { MFA_ROLES, PERMISSIONS, type Role } from "../roles.js";

export const authRouter = Router();

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const publicUser = (u: DbUser) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function issueSession(user: DbUser, mfa: boolean) {
  const token = jwt.sign({ role: user.role, mfa }, config.jwtSecret, { subject: user.id, expiresIn: config.accessTtl });
  const refreshToken = randomBytes(32).toString("hex");
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), mfa, expiresAt: new Date(Date.now() + config.idleMs) },
  });
  const mfaEnrollRequired = config.mfaEnforced && MFA_ROLES.includes(user.role as Role) && !mfa;
  return { token, refreshToken, user: publicUser(user), mfaEnrollRequired };
}

const codeOk = (user: DbUser, code: string) =>
  !!user.mfaSecret && authenticator.check(code, decrypt(user.mfaSecret));

authRouter.post("/login", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const ok = !!user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  await recordAudit({ userId: user?.id, action: ok ? "LOGIN_PASSWORD" : "LOGIN_FALLIDO", resource: "auth", ip: req.ip });
  if (!user || !ok) return res.status(401).json({ error: "Credenciales incorrectas" });

  if (user.mfaEnabled) {
    const mfaToken = jwt.sign({ purpose: "mfa" }, config.jwtSecret, { subject: user.id, expiresIn: "5m" });
    return res.json({ mfaRequired: true, mfaToken });
  }
  res.json(await issueSession(user, false));
});

authRouter.post("/login/mfa", async (req, res) => {
  const parsed = z.object({ mfaToken: z.string(), code: z.string().length(6) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });
  let sub: string;
  try {
    const p = jwt.verify(parsed.data.mfaToken, config.jwtSecret) as { sub: string; purpose?: string };
    if (p.purpose !== "mfa") throw new Error();
    sub = p.sub;
  } catch {
    return res.status(401).json({ error: "Sesión de MFA inválida o expirada" });
  }
  const user = await prisma.user.findUnique({ where: { id: sub } });
  const ok = !!user && codeOk(user, parsed.data.code);
  await recordAudit({ userId: sub, action: ok ? "LOGIN_MFA" : "LOGIN_MFA_FALLIDO", resource: "auth", ip: req.ip });
  if (!user || !ok) return res.status(401).json({ error: "Código incorrecto" });
  res.json(await issueSession(user, true));
});

authRouter.post("/mfa/setup", authenticateBasic, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Usuario no existe" });
  if (user.mfaEnabled) return res.status(409).json({ error: "MFA ya está activo" });
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encrypt(secret) } });
  res.json({ secret, otpauthUrl: authenticator.keyuri(user.email, "SIGO-Dental", secret) });
});

authRouter.post("/mfa/enable", authenticateBasic, async (req, res) => {
  const parsed = z.object({ code: z.string().length(6) }).safeParse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!parsed.success || !user) return res.status(400).json({ error: "Datos inválidos" });
  if (!codeOk(user, parsed.data.code)) return res.status(401).json({ error: "Código incorrecto" });
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await recordAudit({ userId: user.id, action: "MFA_ACTIVADO", resource: "auth", ip: req.ip });
  res.json(await issueSession(user, true));
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = z.object({ refreshToken: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(parsed.data.refreshToken) } });
  if (!row) return res.status(401).json({ error: "Sesión inválida" });
  if (row.revoked) {
    // Reutilización de un token ya rotado: se asume robo y se cierran todas las sesiones.
    await prisma.refreshToken.updateMany({ where: { userId: row.userId }, data: { revoked: true } });
    await recordAudit({ userId: row.userId, action: "REFRESH_REUTILIZADO", resource: "auth", ip: req.ip });
    return res.status(401).json({ error: "Sesión inválida" });
  }
  if (row.expiresAt < new Date()) return res.status(401).json({ error: "Sesión expirada por inactividad" });
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) return res.status(401).json({ error: "Sesión inválida" });
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } });
  res.json(await issueSession(user, row.mfa));
});

authRouter.post("/logout", async (req, res) => {
  const parsed = z.object({ refreshToken: z.string() }).safeParse(req.body);
  if (parsed.success) {
    await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(parsed.data.refreshToken) }, data: { revoked: true } });
  }
  res.status(204).end();
});

authRouter.get("/me", authenticateBasic, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Usuario no existe" });
  const role = user.role as Role;
  res.json({ ...publicUser(user), permissions: PERMISSIONS[role], mfaEnabled: user.mfaEnabled, mfaVerified: req.user!.mfa });
});
