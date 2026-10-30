import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
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

/** Valida el token sin exigir MFA (para /me y el enrolamiento de MFA). */
export function authenticateBasic(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autenticado" });
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ["HS256"] }) as { sub: string; role: Role; mfa?: boolean; purpose?: string };
    if (payload.purpose) return res.status(401).json({ error: "Token inválido" });
    req.user = { id: payload.sub, role: payload.role, mfa: payload.mfa === true };
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
}

/** Autentica y, para roles clínicos/financieros, exige que el MFA esté verificado. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  authenticateBasic(req, res, () => {
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
