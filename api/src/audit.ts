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

export async function recordAudit(e: Omit<Partial<Entry>, "timestamp"> & Pick<Entry, "action" | "resource">) {
  const entry: Entry = {
    timestamp: new Date().toISOString(),
    userId: e.userId ?? null,
    action: e.action,
    resource: e.resource,
    resourceId: e.resourceId ?? null,
    ip: e.ip ?? null,
  };
  // La transacción serializa la escritura para que la cadena no se bifurque.
  await prisma.$transaction(async (tx) => {
    const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" } });
    const prevHash = last?.hash ?? GENESIS;
    await tx.auditLog.create({ data: { ...entry, prevHash, hash: hashEntry(prevHash, entry) } });
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
    recordAudit({ userId: req.user?.id, action, resource, resourceId: req.params.id ?? req.originalUrl.split("?")[0].slice(0, 200), ip: req.ip }).catch((err) =>
      console.error("Fallo al registrar auditoría", err),
    );
  });
  next();
};
