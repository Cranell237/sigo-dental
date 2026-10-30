import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();
const login = async (email: string, password = "Demo1234!") =>
  request(app).post("/api/auth/login").send({ email, password });

describe("login", () => {
  it("rechaza credenciales incorrectas", async () => {
    expect((await login("admin@sigo.test", "mala")).status).toBe(401);
  });

  it("devuelve token y /me con permisos", async () => {
    const { body } = await login("odontologo@sigo.test");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("ODONTOLOGO");
    expect(me.body.permissions).toContain("clinico:leer");
  });
});

describe("RBAC en endpoint clínico", () => {
  const get = (token?: string) => {
    const r = request(app).get("/api/clinico");
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };

  it("401 sin token", async () => {
    expect((await get()).status).toBe(401);
  });

  it("403 para la recepcionista", async () => {
    const { body } = await login("recepcion@sigo.test");
    expect((await get(body.token)).status).toBe(403);
  });

  it("200 para el odontólogo", async () => {
    const { body } = await login("odontologo@sigo.test");
    expect((await get(body.token)).status).toBe(200);
  });
});
