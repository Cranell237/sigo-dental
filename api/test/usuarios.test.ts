import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { loginFull } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const run = Date.now().toString().slice(-8);
let n = 0;
let admin: string, adminId: string;

const crear = (body: Record<string, unknown>) =>
  request(app).post("/api/usuarios").set(bearer(admin)).send({ name: "Usuario Prueba", email: `u${run}${n++}@sigo.test`, role: "RECEPCIONISTA", password: "Clave1234", ...body });
const login = (email: string, password = "Clave1234") => request(app).post("/api/auth/login").send({ email, password });

beforeAll(async () => {
  admin = (await loginFull(app, "admin@sigo.test")).token;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@sigo.test" } })).id;
});

describe("gestión de usuarios (administrador)", () => {
  it("solo el administrador accede", async () => {
    const odonto = (await loginFull(app, "odontologo@sigo.test")).token;
    expect((await request(app).get("/api/usuarios").set(bearer(odonto))).status).toBe(403);
    const lista = await request(app).get("/api/usuarios").set(bearer(admin));
    expect(lista.status).toBe(200);
    expect(lista.body.find((u: { email: string }) => u.email === "odontologo@sigo.test").especialidad).toBeTruthy();
    expect(lista.body[0].passwordHash).toBeUndefined(); // nunca se expone el hash
  });

  it("valida la contraseña y el correo único", async () => {
    expect((await crear({ password: "corta1" })).body.error).toContain("8 caracteres");
    expect((await crear({ password: "sinnumeros" })).body.error).toContain("número");
    const ok = await crear({});
    expect(ok.status).toBe(201);
    expect((await crear({ email: ok.body.email })).status).toBe(409);
  });

  it("un odontólogo nuevo queda como profesional de la agenda y debe activar MFA al entrar", async () => {
    const r = await crear({ role: "ODONTOLOGO", name: "Dra. Nueva Prueba", especialidad: "Endodoncia" });
    expect(r.status).toBe(201);
    const prof = await prisma.profesional.findUniqueOrThrow({ where: { userId: r.body.id } });
    expect(prof.especialidad).toBe("Endodoncia");
    const l = await login(r.body.email);
    expect(l.body.mfaEnrollRequired).toBe(true);
  });

  it("desactivar corta el acceso de inmediato, incluso con un token vigente", async () => {
    const r = await crear({ role: "ADMIN" });
    const token = (await login(r.body.email)).body.token;
    expect((await request(app).get("/api/usuarios").set(bearer(token))).status).toBe(200);

    expect((await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ activo: false })).status).toBe(200);
    expect((await request(app).get("/api/usuarios").set(bearer(token))).status).toBe(401);
    expect((await login(r.body.email)).status).toBe(403);

    await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ activo: true });
    expect((await login(r.body.email)).status).toBe(200);
  });

  it("un odontólogo desactivado deja de ofrecerse para agendar citas", async () => {
    const r = await crear({ role: "ODONTOLOGO", name: `Dr. Inactivo ${run}` });
    const profs = async () => (await request(app).get("/api/catalogos/profesionales").set(bearer(admin))).body.map((p: { nombre: string }) => p.nombre);
    expect(await profs()).toContain(`Dr. Inactivo ${run}`);
    await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ activo: false });
    expect(await profs()).not.toContain(`Dr. Inactivo ${run}`);
  });

  it("(reactivado) vuelve a entrar", async () => {
    const r = await crear({ role: "ADMIN" });
    await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ activo: false });
    await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ activo: true });
    expect((await login(r.body.email)).status).toBe(200);
  });

  it("cambiar el rol aplica de inmediato y cierra las sesiones", async () => {
    const r = await crear({ role: "ADMIN" });
    const sesion = (await login(r.body.email)).body;
    await request(app).patch(`/api/usuarios/${r.body.id}`).set(bearer(admin)).send({ role: "AUDITOR" });
    expect((await request(app).get("/api/usuarios").set(bearer(sesion.token))).status).toBe(403);
    expect((await request(app).post("/api/auth/refresh").send({ refreshToken: sesion.refreshToken })).status).toBe(401);
  });

  it("nadie puede cambiarse el rol ni desactivarse a sí mismo", async () => {
    expect((await request(app).patch(`/api/usuarios/${adminId}`).set(bearer(admin)).send({ activo: false })).status).toBe(409);
    expect((await request(app).patch(`/api/usuarios/${adminId}`).set(bearer(admin)).send({ role: "AUDITOR" })).status).toBe(409);
    expect((await request(app).patch(`/api/usuarios/${adminId}`).set(bearer(admin)).send({ name: "Administrador" })).status).toBe(200);
  });

  it("restablece la contraseña y cierra las sesiones abiertas", async () => {
    const r = await crear({ role: "ADMIN" });
    const sesion = (await login(r.body.email)).body;
    expect((await request(app).post(`/api/usuarios/${r.body.id}/password`).set(bearer(admin)).send({ password: "debil" })).status).toBe(400);
    expect((await request(app).post(`/api/usuarios/${r.body.id}/password`).set(bearer(admin)).send({ password: "NuevaClave99" })).status).toBe(204);
    expect((await login(r.body.email)).status).toBe(401);
    expect((await login(r.body.email, "NuevaClave99")).status).toBe(200);
    expect((await request(app).post("/api/auth/refresh").send({ refreshToken: sesion.refreshToken })).status).toBe(401);
  });

  it("restablecer el MFA obliga a enrolarlo de nuevo", async () => {
    const r = await crear({ role: "AUDITOR" });
    const u = await prisma.user.update({ where: { id: r.body.id }, data: { mfaEnabled: true, mfaSecret: "x" } });
    expect((await login(u.email)).body.mfaRequired).toBe(true);
    expect((await request(app).post(`/api/usuarios/${u.id}/reset-mfa`).set(bearer(admin))).status).toBe(204);
    expect((await login(u.email)).body.mfaEnrollRequired).toBe(true);
  });

  it("queda en la auditoría", async () => {
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.auditLog.count({ where: { resource: "usuarios" } })).toBeGreaterThan(0);
  });
});
