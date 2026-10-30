import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loginFull } from "./helpers.js";

const app = createApp();

describe("robustez del API (Fase 4)", () => {
  it("un parámetro malformado responde 400 en vez de colgar o tumbar el proceso", async () => {
    const { token } = await loginFull(app, "auditor@sigo.test");
    const res = await request(app).get("/api/inventario/movimientos?insumoId=a&insumoId=b").set("Authorization", `Bearer ${token}`).timeout(3000);
    expect(res.status).toBe(400);
  });

  it("un JSON inválido responde 400 y no filtra detalles internos", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{no es json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SyntaxError/);
  });

  it("una ruta inexistente del API responde 404 en JSON", async () => {
    const res = await request(app).get("/api/no-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("envía cabeceras de seguridad y oculta la tecnología", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["strict-transport-security"]).toBeTruthy();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("el health check verifica la base de datos", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok", db: "ok" });
  });

  it("un token de MFA no sirve como token de acceso", async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "odontologo@sigo.test", password: "Demo1234!" });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${r.body.mfaToken}`);
    expect(res.status).toBe(401);
  });

  it("limita los intentos de login por IP (fuerza bruta de contraseña o TOTP)", async () => {
    const limitada = createApp({ limitarIntentos: true });
    const intento = () => request(limitada).post("/api/auth/login").send({ email: "admin@sigo.test", password: "mala" });
    for (let i = 0; i < 20; i++) expect((await intento()).status).toBe(401);
    const bloqueado = await intento();
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error).toContain("Demasiados intentos");
  });
});
