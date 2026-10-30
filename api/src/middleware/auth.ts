import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { can, MFA_ROLES, type Permission, type Role } from "../roles.js";

export interface AuthUser {
  id: string;
  role: Role;
  mfa: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Valida el token sin exigir MFA (para /me y el enrolamiento de MFA).
 * El rol y el estado se leen de la base en cada petición: desactivar a un usuario o cambiarle
 * el rol tiene efecto inmediato, sin esperar a que caduque su token.
 */
export async function authenticateBasic(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autenticado" });
  let payload: { sub: string; mfa?: boolean; purpose?: string };
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ["HS256"] }) as typeof payload;
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  if (payload.purpose) return res.status(401).json({ error: "Token inválido" });
  const usuario = await prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true, activo: true } });
  if (!usuario?.activo) return res.status(401).json({ error: "Usuario inexistente o desactivado" });
  req.user = { id: payload.sub, role: usuario.role as Role, mfa: payload.mfa === true };
  next();
}

/** Autentica y, para roles clínicos/financieros, exige que el MFA esté verificado. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  return authenticateBasic(req, res, () => {
    if (config.mfaEnforced && MFA_ROLES.includes(req.user!.role) && !req.user!.mfa) {
      return res.status(403).json({ error: "MFA requerido", code: "MFA_REQUIRED" });
    }
    next();
  });
}

export const requirePermission = (p: Permission) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  if (!can(req.user.role, p)) return res.status(403).json({ error: "Sin permiso" });
  next();
};
