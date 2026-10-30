import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./openapi.js";
import { authRouter } from "./routes/auth.js";
import { pacientesRouter } from "./routes/pacientes.js";
import { catalogosRouter } from "./routes/catalogos.js";
import { citasRouter } from "./routes/citas.js";
import { cajaRouter } from "./routes/caja.js";
import { recordatoriosRouter } from "./routes/recordatorios.js";
import { auditoriaRouter } from "./routes/auditoria.js";
import { consentimientosRouter } from "./routes/consentimientos.js";
import { recetasRouter } from "./routes/recetas.js";
import { presupuestosRouter } from "./routes/presupuestos.js";
import { inventarioRouter } from "./routes/inventario.js";
import { honorariosRouter } from "./routes/honorarios.js";
import { reportesRouter } from "./routes/reportes.js";
import { expedienteRouter } from "./routes/expediente.js";
import { clinicoRouter } from "./routes/clinico.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));
  app.use("/api/auth", authRouter);
  app.use("/api/clinico/pacientes", expedienteRouter);
  app.use("/api/inventario", inventarioRouter);
  app.use("/api/honorarios", honorariosRouter);
  app.use("/api/reportes", reportesRouter);
  app.use("/api/consentimientos", consentimientosRouter);
  app.use("/api/recetas", recetasRouter);
  app.use("/api/presupuestos", presupuestosRouter);
  app.use("/api/clinico", clinicoRouter);
  app.use("/api/pacientes", pacientesRouter);
  app.use("/api/catalogos", catalogosRouter);
  app.use("/api/citas", citasRouter);
  app.use("/api/caja", cajaRouter);
  app.use("/api/recordatorios", recordatoriosRouter);
  app.use("/api/auditoria", auditoriaRouter);

  // En producción Express sirve el build de React (un solo servicio en Render).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, "../../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  return app;
}
