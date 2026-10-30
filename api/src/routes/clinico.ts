import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";

// Marcador de posición: los endpoints clínicos reales llegan en la Fase 2.
export const clinicoRouter = Router();
clinicoRouter.use(authenticate, requirePermission("clinico:leer"));
clinicoRouter.get("/", (_req, res) => res.json({ items: [] }));
