import { Router } from "express";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { enviarRecordatorios } from "../recordatorios.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// Los recordatorios salen solos cada hora (node-cron). Estos endpoints permiten
// dispararlos a mano y ver la bitácora, útil en la demo (el plan gratuito de Render duerme el servicio).
export const recordatoriosRouter = Router();
recordatoriosRouter.use(authenticate, requirePermission("agenda:gestionar"), auditAccess("recordatorios"));

recordatoriosRouter.get("/", async (_req, res) => {
  res.json(await prisma.recordatorio.findMany({ orderBy: { sentAt: "desc" }, take: 50 }));
});

recordatoriosRouter.post("/ejecutar", async (_req, res) => {
  res.json(await enviarRecordatorios());
});
