import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { auditAccess } from "../audit.js";

// Marcador de posición: los endpoints clínicos reales llegan en la Fase 2.
export const clinicoRouter = Router();
clinicoRouter.use(authenticate, requirePermission("clinico:leer"), auditAccess("clinico"));
clinicoRouter.get("/", (_req, res) => res.json({ items: [] }));
