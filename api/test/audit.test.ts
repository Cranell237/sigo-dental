import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { recordAudit, verifyAuditChain } from "../src/audit.js";
import { loginFull } from "./helpers.js";

const app = createApp();

describe("auditoría append-only", () => {
  it("una lectura clínica genera una fila", async () => {
    const { token } = await loginFull(app, "odontologo@sigo.test");
    const before = await prisma.auditLog.count({ where: { resource: "clinico" } });
    await request(app).get("/api/clinico").set("Authorization", `Bearer ${token}`);
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.auditLog.count({ where: { resource: "clinico" } })).toBe(before + 1);
  });

  it("no permite modificar ni borrar filas", async () => {
    await loginFull(app, "admin@sigo.test");
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "X" } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it("con 300 accesos concurrentes no se pierde ninguna fila y la cadena sigue íntegra", async () => {
    const antes = await prisma.auditLog.count();
    await Promise.all(Array.from({ length: 300 }, (_, i) => recordAudit({ action: "READ", resource: "carga", resourceId: String(i) })));
    expect(await prisma.auditLog.count()).toBe(antes + 300);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("la cadena de hashes es íntegra y solo la leen admin/auditor", async () => {
    const admin = await loginFull(app, "admin@sigo.test");
    const res = await request(app).get("/api/auditoria/verificar").set("Authorization", `Bearer ${admin.token}`);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);

    const recep = await loginFull(app, "recepcion@sigo.test");
    const denied = await request(app).get("/api/auditoria").set("Authorization", `Bearer ${recep.token}`);
    expect(denied.status).toBe(403);
  });
});
