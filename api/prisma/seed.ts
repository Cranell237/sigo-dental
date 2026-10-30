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

// Catálogos y datos de demostración (Fase 1).
const consultorio = await prisma.consultorio.upsert({ where: { nombre: "Consultorio 1" }, update: {}, create: { nombre: "Consultorio 1" } });
for (const nombre of ["Sillón 1", "Sillón 2"]) {
  await prisma.sillon.upsert({ where: { consultorioId_nombre: { consultorioId: consultorio.id, nombre } }, update: {}, create: { nombre, consultorioId: consultorio.id } });
}
const odonto = await prisma.user.findUniqueOrThrow({ where: { email: "odontologo@sigo.test" } });
await prisma.profesional.upsert({
  where: { userId: odonto.id },
  update: {},
  create: { userId: odonto.id, nombre: "Dr. Odontólogo Demo", especialidad: "Odontología general" },
});
const procedimientos = [
  { codigo: "CONS", nombre: "Consulta y diagnóstico", precioBase: 1500 },
  { codigo: "PROF", nombre: "Profilaxis dental", precioBase: 3500 },
  { codigo: "REST", nombre: "Restauración con resina", precioBase: 4500 },
  { codigo: "ENDO", nombre: "Endodoncia unirradicular", precioBase: 12000 },
  { codigo: "EXOD", nombre: "Exodoncia simple", precioBase: 3000 },
];
for (const p of procedimientos) await prisma.procedimiento.upsert({ where: { codigo: p.codigo }, update: {}, create: p });

const pacientes = [
  { cedula: "1710000001", nombres: "María", apellidos: "Andrade", fechaNacimiento: new Date("1988-03-14"), sexo: "F", telefono: "0991111111", emergenciaNombre: "Luis Andrade", emergenciaTelefono: "0992222222", alergias: ["Penicilina"], anticoagulado: false },
  { cedula: "1710000002", nombres: "Carlos", apellidos: "Benítez", fechaNacimiento: new Date("1955-11-02"), sexo: "M", telefono: "0993333333", emergenciaNombre: "Ana Benítez", emergenciaTelefono: "0994444444", alergias: [], anticoagulado: true },
  { cedula: "1710000003", nombres: "Sofía", apellidos: "Cevallos", fechaNacimiento: new Date("2016-06-20"), sexo: "F", telefono: "0995555555", emergenciaNombre: "Pedro Cevallos", emergenciaTelefono: "0996666666", tutorNombre: "Pedro Cevallos", tutorCedula: "1710000099", tutorTelefono: "0996666666", alergias: [], anticoagulado: false },
];
for (const { alergias, anticoagulado, ...p } of pacientes) {
  if (await prisma.patient.findUnique({ where: { cedula: p.cedula } })) continue;
  await prisma.patient.create({ data: { ...p, anamnesis: { create: { alergias: JSON.stringify(alergias), anticoagulado } } } });
}
// Plantillas de consentimiento: una genérica y una por procedimiento.
const TEXTO = (proc: string) =>
  `Declaro que el profesional me ha explicado en términos comprensibles el procedimiento de "${proc}", su finalidad, los beneficios esperados, las alternativas de tratamiento y los riesgos y posibles complicaciones propios de este tipo de intervención, incluyendo reacciones a anestésicos o medicamentos. He podido hacer preguntas y fueron resueltas. Entiendo que puedo retirar mi consentimiento antes del procedimiento. Autorizo su realización y confirmo que la información médica que proporcioné es verdadera y completa.`;
if (!(await prisma.consentimientoPlantilla.findFirst({ where: { procedimientoId: null } }))) {
  await prisma.consentimientoPlantilla.create({ data: { titulo: "Consentimiento informado general", texto: TEXTO("atención odontológica") } });
}
for (const proc of await prisma.procedimiento.findMany()) {
  if (await prisma.consentimientoPlantilla.findFirst({ where: { procedimientoId: proc.id } })) continue;
  await prisma.consentimientoPlantilla.create({ data: { procedimientoId: proc.id, titulo: `Consentimiento informado — ${proc.nombre}`, texto: TEXTO(proc.nombre) } });
}
// Inventario de demostración (Fase 3): insumos, receta de consumo y stock en el Consultorio 1.
const insumosDemo = [
  { codigo: "RES-A2", nombre: "Resina compuesta A2", unidad: "g", stockMinimo: 5, costoUnitario: 150 },
  { codigo: "ANE-LID", nombre: "Anestesia lidocaína 2%", unidad: "carpule", stockMinimo: 10, costoUnitario: 120 },
  { codigo: "GUA-M", nombre: "Guantes de nitrilo", unidad: "par", stockMinimo: 20, costoUnitario: 25 },
];
for (const i of insumosDemo) await prisma.insumo.upsert({ where: { codigo: i.codigo }, update: {}, create: i });
const rest = await prisma.procedimiento.findUniqueOrThrow({ where: { codigo: "REST" } });
for (const [codigo, cantidad] of [["RES-A2", 2], ["ANE-LID", 1], ["GUA-M", 1]] as const) {
  const insumo = await prisma.insumo.findUniqueOrThrow({ where: { codigo } });
  await prisma.recetaConsumo.upsert({ where: { procedimientoId_insumoId: { procedimientoId: rest.id, insumoId: insumo.id } }, update: {}, create: { procedimientoId: rest.id, insumoId: insumo.id, cantidad } });
}
if ((await prisma.loteInsumo.count({ where: { consultorioId: consultorio.id } })) === 0) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@sigo.test" } });
  for (const [codigo, cantidad] of [["RES-A2", 30], ["ANE-LID", 40], ["GUA-M", 100]] as const) {
    const insumo = await prisma.insumo.findUniqueOrThrow({ where: { codigo } });
    const lote = await prisma.loteInsumo.create({ data: { insumoId: insumo.id, consultorioId: consultorio.id, lote: "L-INICIAL", vence: new Date(Date.now() + 365 * 864e5), cantidad } });
    await prisma.movimientoInventario.create({ data: { insumoId: insumo.id, consultorioId: consultorio.id, loteId: lote.id, tipo: "ENTRADA", cantidad, motivo: "Stock inicial de demostración", userId: admin.id } });
  }
}
// Regla de honorarios de demostración: 40 % del precio para el odontólogo.
const profDemo = await prisma.profesional.findFirstOrThrow();
if (!(await prisma.reglaHonorario.findFirst({ where: { profesionalId: profDemo.id, procedimientoId: null } }))) {
  await prisma.reglaHonorario.create({ data: { profesionalId: profDemo.id, modalidad: "PORCENTAJE", valor: 4000 } });
}
console.log("Seed: catálogos, pacientes, plantillas e inventario de demostración");
await prisma.$disconnect();
