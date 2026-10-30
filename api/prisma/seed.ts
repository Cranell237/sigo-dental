import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Un usuario por rol (SRS §3). Contraseña de demo; no usar fuera de pruebas.
const users = [
  { email: "admin@sigo.test", name: "Administrador", role: "ADMIN" },
  { email: "odontologo@sigo.test", name: "Odontólogo Demo", role: "ODONTOLOGO" },
  { email: "recepcion@sigo.test", name: "Recepcionista Demo", role: "RECEPCIONISTA" },
  { email: "asistente@sigo.test", name: "Asistente Demo", role: "ASISTENTE" },
  { email: "auditor@sigo.test", name: "Auditor Demo", role: "AUDITOR" },
];

const passwordHash = await bcrypt.hash("Demo1234!", 10);
for (const u of users) {
  await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
}
console.log(`Seed: ${users.length} usuarios`);
await prisma.$disconnect();
