import request from "supertest";
import { authenticator } from "otplib";
import type { Express } from "express";

export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/** Login completo (con MFA si el usuario lo tiene). Devuelve la sesión. */
export async function loginFull(app: Express, email: string) {
  const first = await request(app).post("/api/auth/login").send({ email, password: "Demo1234!" });
  if (!first.body.mfaRequired) return first.body as { token: string; refreshToken: string };
  const second = await request(app)
    .post("/api/auth/login/mfa")
    .send({ mfaToken: first.body.mfaToken, code: authenticator.generate(DEMO_TOTP_SECRET) });
  return second.body as { token: string; refreshToken: string };
}
