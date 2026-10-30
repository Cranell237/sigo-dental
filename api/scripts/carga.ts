// Prueba de carga (RNF-03, 4.4): 150 conexiones concurrentes contra endpoints representativos.
// Uso: npm run carga -w api   (usa la base de DATABASE_URL; conviene una copia de prueba)
import autocannon from "autocannon";
import { authenticator } from "otplib";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const CONEXIONES = Number(process.env.CONEXIONES ?? 150);
const SEGUNDOS = Number(process.env.SEGUNDOS ?? 10);
const DEMO_TOTP = "JBSWY3DPEHPK3PXP";

const server = createApp({ limitarIntentos: false }).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function token(email: string) {
  const r1 = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Demo1234!" }) })).json();
  if (!r1.mfaRequired) return r1.token as string;
  const r2 = await (await fetch(`${base}/api/auth/login/mfa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mfaToken: r1.mfaToken, code: authenticator.generate(DEMO_TOTP) }) })).json();
  return r2.token as string;
}

const correr = (titulo: string, path: string, auth?: string) =>
  new Promise<void>((resolve, reject) => {
    autocannon({ url: base + path, connections: CONEXIONES, duration: SEGUNDOS, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }, (err, r) => {
      if (err) return reject(err);
      const errores = r.errors + r.timeouts + r.non2xx;
      console.log(`${titulo.padEnd(34)} ${String(Math.round(r.requests.average)).padStart(6)} req/s   p50 ${String(r.latency.p50).padStart(5)} ms   p99 ${String(r.latency.p99).padStart(6)} ms   máx ${String(r.latency.max).padStart(6)} ms   errores ${errores}/${r.requests.total}`);
      resolve();
    });
  });

try {
  const odonto = await token("odontologo@sigo.test");
  const pid = (await prisma.patient.findFirstOrThrow({ where: { cedula: "1710000001" } })).id;
  console.log(`Carga: ${CONEXIONES} conexiones concurrentes durante ${SEGUNDOS} s por endpoint\n`);
  await correr("GET /api/health", "/api/health");
  await correr("GET /api/pacientes (búsqueda)", "/api/pacientes?q=a", odonto);
  // Lectura del expediente: además escribe una fila de auditoría por petición (RNF-06).
  await correr("GET odontograma del paciente", `/api/clinico/pacientes/${pid}/odontograma`, odonto);
  await correr("GET notas SOEP del paciente", `/api/clinico/pacientes/${pid}/notas`, odonto);
} finally {
  server.close();
  await prisma.$disconnect();
}
