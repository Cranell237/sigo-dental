import { access, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./db.js";

// RNF-02: respaldo y restauración de la base SQLite.
// `VACUUM INTO` genera una copia consistente aunque el servicio esté atendiendo peticiones.

/** Ruta del archivo de la base a partir de DATABASE_URL (relativa a la carpeta prisma/, como hace Prisma). */
export function archivoBase(url = process.env.DATABASE_URL ?? "") {
  const ruta = url.replace(/^file:/, "").split("?")[0];
  return path.isAbsolute(ruta) ? ruta : path.resolve("prisma", ruta);
}

export async function respaldar(destino: string) {
  const final = path.resolve(destino);
  await mkdir(path.dirname(final), { recursive: true });
  // Nunca se sobrescribe un respaldo existente.
  if (await access(final).then(() => true, () => false)) throw new Error(`Ya existe un respaldo en ${final}`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${final.replace(/'/g, "''")}'`);
  return { archivo: final, bytes: (await stat(final)).size };
}

/** Abre el respaldo como una base independiente y cuenta registros clave; falla si el archivo no es válido. */
export async function verificarRespaldo(archivo: string) {
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve(archivo)}` } } });
  try {
    const [integridad] = await db.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    return {
      integridad: integridad.integrity_check,
      usuarios: await db.user.count(),
      pacientes: await db.patient.count(),
      auditoria: await db.auditLog.count(),
    };
  } finally {
    await db.$disconnect();
  }
}

/** Restaura copiando el respaldo sobre la base. Debe hacerse con el servicio detenido. */
export async function restaurar(archivo: string, destino = archivoBase()) {
  await verificarRespaldo(archivo); // nunca restaurar un archivo corrupto
  await copyFile(path.resolve(archivo), destino);
  return { restaurado: destino };
}
