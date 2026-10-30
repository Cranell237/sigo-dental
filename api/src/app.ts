import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";
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

export interface AppOptions {
  /** Limitar intentos de login (desactivado por defecto en los tests, que inician sesión muchas veces). */
  limitarIntentos?: boolean;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  // Render (y cualquier proxy) termina TLS delante: req.ip debe ser la IP real del cliente (auditoría, rate limit).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  // El tope cubre la imagen de la firma del consentimiento (data URL PNG).
  app.use(express.json({ limit: "1mb" }));

  // RNF-02: health check con la base de datos; Render lo usa para saber si el servicio está sano.
  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "ok" });
    } catch {
      res.status(503).json({ status: "error", db: "sin conexión" });
    }
  });

  if (opts.limitarIntentos ?? process.env.NODE_ENV !== "test") {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.maxIntentosLogin,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." },
    });
    app.use(["/api/auth/login", "/api/auth/mfa/enable"], limiter);
  }

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

  // Cualquier otra ruta del API: 404 en JSON (no la página de React).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
  });

  // En producción Express sirve el build de React (un solo servicio en Render).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, "../../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  // Manejador de errores: Express 5 entrega aquí los rechazos de los handlers async.
  // Nunca se expone el detalle interno al cliente.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tipo = (err as { type?: string })?.type;
    if (err instanceof ZodError || tipo === "entity.parse.failed") return res.status(400).json({ error: "Datos inválidos" });
    if (tipo === "entity.too.large") return res.status(413).json({ error: "La solicitud es demasiado grande" });
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
