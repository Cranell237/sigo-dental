import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encrypt } from "../src/crypto.js";

const prisma = new PrismaClient();

// Secreto TOTP fijo SOLO para la demo: se carga en cualquier app autenticadora (Google Authenticator, etc.).
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

// Un usuario por rol (SRS §3). Contraseña de demo; no usar fuera de pruebas.
// El admin entra sin MFA; los roles clínicos/financieros ya vienen con MFA activo.
const users = [
  { email: "admin@sigo.test", name: "Administrador", role: "ADMIN", mfa: false },
  { email: "odontologo@sigo.test", name: "Odontólogo Demo", role: "ODONTOLOGO", mfa: true },
  { email: "recepcion@sigo.test", name: "Recepcionista Demo", role: "RECEPCIONISTA", mfa: true },
  { email: "asistente@sigo.test", name: "Asistente Demo", role: "ASISTENTE", mfa: true },
  { email: "auditor@sigo.test", name: "Auditor Demo", role: "AUDITOR", mfa: true },
];

const passwordHash = await bcrypt.hash("Demo1234!", 10);
for (const { mfa, ...u } of users) {
  const mfaData = { mfaEnabled: mfa, mfaSecret: mfa ? encrypt(DEMO_TOTP_SECRET) : null };
  await prisma.user.upsert({ where: { email: u.email }, update: mfaData, create: { ...u, passwordHash, ...mfaData } });
}
console.log(`Seed: ${users.length} usuarios`);
await prisma.$disconnect();
