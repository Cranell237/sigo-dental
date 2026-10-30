import { describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { DEMO_TOTP_SECRET, loginFull } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("login", () => {
  it("rechaza credenciales incorrectas", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "admin@sigo.test", password: "mala" });
    expect(res.status).toBe(401);
  });

  it("el admin entra sin MFA", async () => {
    const { token } = await loginFull(app, "admin@sigo.test");
    const me = await request(app).get("/api/auth/me").set(bearer(token));
    expect(me.body.role).toBe("ADMIN");
    expect(me.body.permissions).toContain("usuarios:gestionar");
  });
});

describe("MFA TOTP", () => {
  it("un rol clínico recibe mfaRequired y no obtiene sesión solo con la contraseña", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "odontologo@sigo.test", password: "Demo1234!" });
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.token).toBeUndefined();
  });

  it("rechaza un código TOTP incorrecto", async () => {
    const first = await request(app).post("/api/auth/login").send({ email: "odontologo@sigo.test", password: "Demo1234!" });
    const res = await request(app).post("/api/auth/login/mfa").send({ mfaToken: first.body.mfaToken, code: "000000" });
    expect(res.status).toBe(401);
  });

  it("un rol con MFA obligatorio sin enrolar queda restringido hasta activarlo", async () => {
    await prisma.user.create({
      data: { email: "nuevo@sigo.test", name: "Nuevo", role: "ODONTOLOGO", passwordHash: (await prisma.user.findFirstOrThrow()).passwordHash },
    });
    const login = await request(app).post("/api/auth/login").send({ email: "nuevo@sigo.test", password: "Demo1234!" });
    expect(login.body.mfaEnrollRequired).toBe(true);
    expect((await request(app).get("/api/clinico").set(bearer(login.body.token))).status).toBe(403);

    const setup = await request(app).post("/api/auth/mfa/setup").set(bearer(login.body.token));
    const enabled = await request(app)
      .post("/api/auth/mfa/enable")
      .set(bearer(login.body.token))
      .send({ code: authenticator.generate(setup.body.secret) });
    expect(enabled.status).toBe(200);
    expect((await request(app).get("/api/clinico").set(bearer(enabled.body.token))).status).toBe(200);
    await prisma.refreshToken.deleteMany({ where: { userId: enabled.body.user.id } });
    await prisma.user.delete({ where: { email: "nuevo@sigo.test" } });
  });
});

describe("refresh token rotativo", () => {
  it("rota el token y detecta la reutilización", async () => {
    const { refreshToken } = await loginFull(app, "odontologo@sigo.test");
    const rotated = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);

    const reused = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(reused.status).toBe(401);
    // la reutilización cierra también la sesión rotada
    const afterTheft = await request(app).post("/api/auth/refresh").send({ refreshToken: rotated.body.refreshToken });
    expect(afterTheft.status).toBe(401);
  });

  it("rechaza el refresh tras 15 min de inactividad", async () => {
    const { refreshToken } = await loginFull(app, "auditor@sigo.test");
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) }, where: { revoked: false } });
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it("logout revoca la sesión", async () => {
    const { refreshToken } = await loginFull(app, "asistente@sigo.test");
    await request(app).post("/api/auth/logout").send({ refreshToken });
    expect((await request(app).post("/api/auth/refresh").send({ refreshToken })).status).toBe(401);
  });
});

describe("RBAC en endpoint clínico", () => {
  const get = (token?: string) => {
    const r = request(app).get("/api/clinico");
    return token ? r.set(bearer(token)) : r;
  };

  it("401 sin token", async () => {
    expect((await get()).status).toBe(401);
  });

  it("403 para la recepcionista", async () => {
    const { token } = await loginFull(app, "recepcion@sigo.test");
    expect((await get(token)).status).toBe(403);
  });

  it("200 para el odontólogo", async () => {
    const { token } = await loginFull(app, "odontologo@sigo.test");
    expect((await get(token)).status).toBe(200);
  });
});

describe("cifrado AES-256-GCM", () => {
  it("cifra y descifra, y el secreto TOTP no se guarda en claro", async () => {
    expect(decrypt(encrypt("dato sensible"))).toBe("dato sensible");
    expect(encrypt("a")).not.toBe(encrypt("a"));
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "odontologo@sigo.test" } });
    expect(u.mfaSecret).not.toContain(DEMO_TOTP_SECRET);
  });
});
