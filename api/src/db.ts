import { PrismaClient } from "@prisma/client";

// SQLite admite un solo escritor. Con una única conexión las transacciones concurrentes
// esperan su turno en el pool de Prisma en lugar de competir por el bloqueo del archivo
// (lo que provocaba timeouts P1008 al agendar citas simultáneas).
function sqliteUrl() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:") || url.includes("connection_limit")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`;
}

export const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl() } } });
