import { Router } from "express";
import { prisma } from "../db.js";
import { verifyAuditChain } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// Solo lectura: no existen endpoints de edición ni borrado.
export const auditoriaRouter = Router();
auditoriaRouter.use(authenticate, requirePermission("auditoria:leer"));

auditoriaRouter.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: limit }));
});

auditoriaRouter.get("/verificar", async (_req, res) => res.json(await verifyAuditChain()));
