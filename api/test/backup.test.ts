import { beforeAll, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/db.js";
import { archivoBase, respaldar, restaurar, verificarRespaldo } from "../src/backup.js";

describe("respaldo y restauración (RNF-02, 4.5)", () => {
  beforeAll(async () => {
    for (const f of ["respaldo.db", "respaldo2.db", "restaurada.db"]) await rm(`uploads-test/${f}`, { force: true });
  });

  it("no sobrescribe un respaldo existente", async () => {
    await writeFile("uploads-test/existente.db", "x");
    await expect(respaldar("uploads-test/existente.db")).rejects.toThrow(/Ya existe/);
    await rm("uploads-test/existente.db");
  });

  it("el respaldo es una base válida con los mismos datos", async () => {
    const r = await respaldar("uploads-test/respaldo.db");
    expect(r.bytes).toBeGreaterThan(0);
    const v = await verificarRespaldo(r.archivo);
    expect(v.integridad).toBe("ok");
    expect(v.usuarios).toBe(await prisma.user.count());
    expect(v.pacientes).toBe(await prisma.patient.count());
  });

  it("restaura sobre otra base y los datos quedan disponibles", async () => {
    const r = await respaldar("uploads-test/respaldo2.db");
    const destino = "uploads-test/restaurada.db";
    await rm(destino, { force: true });
    await restaurar(r.archivo, destino);
    const db = new PrismaClient({ datasources: { db: { url: `file:${archivoBase(`file:../${destino}`)}` } } });
    try {
      expect(await db.user.count()).toBe(await prisma.user.count());
      // los triggers de inmutabilidad viajan con el respaldo
      const fila = await db.auditLog.findFirstOrThrow();
      await expect(db.auditLog.delete({ where: { id: fila.id } })).rejects.toThrow();
    } finally {
      await db.$disconnect();
    }
  });

  it("no restaura un archivo corrupto", async () => {
    await writeFile("uploads-test/corrupto.db", "esto no es una base de datos");
    await expect(restaurar("uploads-test/corrupto.db", "uploads-test/no-debe-existir.db")).rejects.toThrow();
  });
});
