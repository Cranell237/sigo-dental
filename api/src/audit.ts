import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";

const GENESIS = "0".repeat(64);

interface Entry {
  timestamp: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ip: string | null;
}

const hashEntry = (prevHash: string, e: Entry) =>
  createHash("sha256")
    .update(JSON.stringify([prevHash, e.timestamp, e.userId, e.action, e.resource, e.resourceId, e.ip]))
    .digest("hex");

// Las escrituras pasan por una cola en memoria que encadena los hashes y las inserta por lotes.
// Antes cada fila abría una transacción (leer el último hash + insertar): con 150 accesos concurrentes
// esas transacciones agotaban su tiempo de espera y se perdían filas de auditoría.
// Supone un único proceso escritor, que es el caso con SQLite (un solo servicio en Render).
let ultimoHash: string | null = null; // caché del último hash; null = leerlo de la base
const pendientes: { entry: Entry; resolve: () => void; reject: (e: unknown) => void }[] = [];
let escribiendo: Promise<void> | null = null;
const LOTE = 200;

async function vaciarCola() {
  while (pendientes.length) {
    const lote = pendientes.splice(0, LOTE);
    try {
      if (ultimoHash === null) ultimoHash = (await prisma.auditLog.findFirst({ orderBy: { id: "desc" } }))?.hash ?? GENESIS;
      let prev = ultimoHash;
      const data = lote.map(({ entry }) => {
        const hash = hashEntry(prev, entry);
        const fila = { ...entry, prevHash: prev, hash };
        prev = hash;
        return fila;
      });
      await prisma.auditLog.createMany({ data }); // se insertan en orden: los ids siguen la cadena
      ultimoHash = prev;
      lote.forEach((p) => p.resolve());
    } catch (err) {
      ultimoHash = null; // ante cualquier duda se vuelve a leer el último hash real
      lote.forEach((p) => p.reject(err));
    }
  }
}

function programar() {
  if (escribiendo) return;
  escribiendo = vaciarCola().finally(() => {
    escribiendo = null;
    if (pendientes.length) programar(); // llegó algo mientras terminaba la vuelta anterior
  });
}

export function recordAudit(e: Omit<Partial<Entry>, "timestamp"> & Pick<Entry, "action" | "resource">) {
  const entry: Entry = {
    timestamp: new Date().toISOString(),
    userId: e.userId ?? null,
    action: e.action,
    resource: e.resource,
    resourceId: e.resourceId ?? null,
    ip: e.ip ?? null,
  };
  return new Promise<void>((resolve, reject) => {
    pendientes.push({ entry, resolve, reject });
    programar();
  });
}

/** Recorre la cadena y devuelve el id de la primera fila alterada, o null si es íntegra. */
export async function verifyAuditChain() {
  const rows = await prisma.auditLog.findMany({ orderBy: { id: "asc" } });
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev || r.hash !== hashEntry(prev, r)) return { ok: false, brokenAt: r.id, total: rows.length };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null, total: rows.length };
}

/** Registra cada acceso a un recurso (lectura/escritura) tras autenticar. */
export const auditAccess = (resource: string) => (req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const action = req.method === "GET" ? "READ" : req.method === "POST" ? "CREATE" : req.method === "DELETE" ? "DELETE" : "UPDATE";
    recordAudit({ userId: req.user?.id, action, resource, resourceId: (req.params.id as string | undefined) ?? req.originalUrl.split("?")[0].slice(0, 200), ip: req.ip }).catch((err) =>
      console.error("Fallo al registrar auditoría", err),
    );
  });
  next();
};
