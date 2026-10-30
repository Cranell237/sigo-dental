import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const app = createApp();
const token = async (email: string) =>
  (await request(app).post("/api/auth/login").send({ email, password: "Demo1234!" })).body.token as string;

describe("auditoría append-only", () => {
  it("una lectura clínica genera una fila", async () => {
    const t = await token("odontologo@sigo.test");
    const before = await prisma.auditLog.count({ where: { resource: "clinico" } });
    await request(app).get("/api/clinico").set("Authorization", `Bearer ${t}`);
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.auditLog.count({ where: { resource: "clinico" } })).toBe(before + 1);
  });

  it("no permite modificar ni borrar filas", async () => {
    await token("admin@sigo.test");
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "X" } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it("la cadena de hashes es íntegra y solo la lee admin/auditor", async () => {
    const admin = await token("admin@sigo.test");
    const res = await request(app).get("/api/auditoria/verificar").set("Authorization", `Bearer ${admin}`);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);

    const recep = await token("recepcion@sigo.test");
    const denied = await request(app).get("/api/auditoria").set("Authorization", `Bearer ${recep}`);
    expect(denied.status).toBe(403);
  });
});
