// Datos de demostración realistas, cargados A TRAVÉS DEL API (no con inserciones directas) para que
// cumplan todas las reglas de negocio: auditoría, firmas, descargo de insumos, facturas y PDFs.
// Se ejecuta en cada arranque (después de seed.ts) y solo actúa si la base aún no tiene la demo.
// Las fechas son relativas a "hoy" en Ecuador (UTC-5), así la agenda del día nunca está vacía.
import type { AddressInfo } from "node:net";
import { authenticator } from "otplib";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const MARCA = "0912345678"; // cédula del primer paciente de la demo: si existe, la demo ya se cargó
const TOTP = "JBSWY3DPEHPK3PXP";
const PASSWORD = "Demo1234!";

if (await prisma.patient.findUnique({ where: { cedula: MARCA } })) {
  console.log("Demo: ya cargada");
  await prisma.$disconnect();
  process.exit(0);
}

const server = createApp({ limitarIntentos: false }).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

async function call<T = any>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

async function login(email: string) {
  const r = await call(null, "POST", "/auth/login", { email, password: PASSWORD });
  if (!r.mfaRequired) return r.token as string;
  return (await call(null, "POST", "/auth/login/mfa", { mfaToken: r.mfaToken, code: authenticator.generate(TOTP) })).token as string;
}

// Hora local de Ecuador → ISO UTC.
function slot(dias: number, hora: number, minuto = 0, duracionMin = 30) {
  const ec = new Date(Date.now() - 5 * 3600e3);
  const inicio = new Date(Date.UTC(ec.getUTCFullYear(), ec.getUTCMonth(), ec.getUTCDate() + dias, hora + 5, minuto));
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + duracionMin * 60e3).toISOString() };
}

try {
  const [admin, recep, odonto, asis] = [await login("admin@sigo.test"), await login("recepcion@sigo.test"), await login("odontologo@sigo.test"), await login("asistente@sigo.test")];

  // ---------- Catálogos (admin) ----------
  const c2 = await call(admin, "POST", "/catalogos/consultorios", { nombre: "Consultorio 2" });
  await call(admin, "POST", `/catalogos/consultorios/${c2.id}/sillones`, { nombre: "Sillón 3" });
  await call(admin, "POST", "/catalogos/profesionales", { nombre: "Dra. Lucía Mora", especialidad: "Ortodoncia" });
  const consultorios = await call<{ id: string; nombre: string; sillones: { id: string; nombre: string }[] }[]>(admin, "GET", "/catalogos/consultorios");
  const c1 = consultorios.find((c) => c.nombre === "Consultorio 1")!;
  const [s1, s2] = c1.sillones;
  const s3 = consultorios.find((c) => c.nombre === "Consultorio 2")!.sillones[0];
  const profesionales = await call<{ id: string; nombre: string }[]>(admin, "GET", "/catalogos/profesionales");
  const drDemo = profesionales.find((p) => p.nombre.startsWith("Dr. Odontólogo"))!;
  const draMora = profesionales.find((p) => p.nombre.startsWith("Dra. Lucía"))!;
  const procs = Object.fromEntries((await call<{ id: string; codigo: string }[]>(admin, "GET", "/catalogos/procedimientos")).map((p) => [p.codigo, p.id]));

  const insumos = Object.fromEntries((await call<{ id: string; codigo: string }[]>(admin, "GET", `/inventario?consultorioId=${c1.id}`)).map((i) => [i.codigo, i.id]));
  const hilo = await call(admin, "POST", "/inventario/insumos", { codigo: "HIL-SUT", nombre: "Hilo de sutura 3-0", unidad: "sobre", stockMinimo: 5, costoUnitario: 180 });
  await call(asis, "POST", "/inventario/entradas", { insumoId: hilo.id, consultorioId: c1.id, lote: "SUT-2026-08", cantidad: 4, vence: new Date(Date.now() + 20 * 864e5).toISOString() });
  await call(admin, "PUT", `/inventario/receta-consumo/${procs.EXOD}`, { items: [{ insumoId: insumos["ANE-LID"], cantidad: 1 }, { insumoId: insumos["GUA-M"], cantidad: 1 }, { insumoId: hilo.id, cantidad: 1 }] });
  await call(admin, "PUT", `/inventario/receta-consumo/${procs.ENDO}`, { items: [{ insumoId: insumos["ANE-LID"], cantidad: 2 }, { insumoId: insumos["GUA-M"], cantidad: 2 }] });
  await call(admin, "PUT", `/inventario/receta-consumo/${procs.PROF}`, { items: [{ insumoId: insumos["GUA-M"], cantidad: 1 }] });
  await call(admin, "PUT", "/honorarios/reglas", { profesionalId: drDemo.id, procedimientoId: procs.ENDO, modalidad: "MONTO_FIJO", valor: 5000 });

  // ---------- Pacientes (recepción) ----------
  const nuevo = (p: Record<string, unknown>, anamnesis: Record<string, unknown> = {}) =>
    call(recep, "POST", "/pacientes", {
      sexo: "F",
      emergenciaNombre: "Familiar",
      emergenciaTelefono: "0980000000",
      ...p,
      anamnesis: { alergias: [], anticoagulado: false, coagulopatia: false, ...anamnesis },
    });
  const ana = await nuevo({ cedula: MARCA, nombres: "Ana Lucía", apellidos: "Torres Vélez", fechaNacimiento: "1994-08-21", telefono: "0987654321", email: "ana.torres@correo.ec", seguro: "Salud S.A.", emergenciaNombre: "Jorge Torres" }, { alergias: ["Látex"], enfermedades: "Ninguna" });
  const luis = await nuevo({ cedula: "0923456789", nombres: "Luis Fernando", apellidos: "Mendoza Ruiz", fechaNacimiento: "1968-02-11", sexo: "M", telefono: "0976543210", convenio: "Empresa Eléctrica" }, { enfermedades: "Diabetes tipo 2, hipertensión", observaciones: "Control glucémico antes de procedimientos quirúrgicos" });
  const valeria = await nuevo({ cedula: "0934567890", nombres: "Valeria", apellidos: "Quiñónez Castro", fechaNacimiento: "2001-12-03", telefono: "0965432109", email: "valeria.q@correo.ec" }, { alergias: ["Ibuprofeno"] });
  const mateo = await nuevo({ cedula: "0945678901", nombres: "Mateo", apellidos: "Paredes León", fechaNacimiento: "2014-04-15", sexo: "M", telefono: "0954321098", tutorNombre: "Gabriela León", tutorCedula: "0911122233", tutorTelefono: "0954321098" });
  const rosa = await nuevo({ cedula: "0956789012", nombres: "Rosa Elena", apellidos: "Villacís Mora", fechaNacimiento: "1950-09-30", telefono: "0943210987", seguro: "IESS" }, { anticoagulado: true, enfermedades: "Fibrilación auricular", cirugias: "Reemplazo de cadera (2019)" });

  const buscar = async (cedula: string) => (await call<{ id: string }[]>(recep, "GET", `/pacientes?q=${cedula}`))[0];
  const maria = await buscar("1710000001");
  const carlos = await buscar("1710000002");
  const sofia = await buscar("1710000003");

  // ---------- Agenda ----------
  const cita = (patientId: string, s: { inicio: string; fin: string }, motivo: string, sillonId = s1.id, profesionalId = drDemo.id) =>
    call(recep, "POST", "/citas", { patientId, profesionalId, sillonId, ...s, motivo });
  const avanzar = async (id: string, estados: string[]) => {
    for (const estado of estados) await call(recep, "PATCH", `/citas/${id}/estado`, { estado });
  };
  const ATENDIDA = ["CONFIRMADO", "EN_SALA_ESPERA", "EN_ATENCION", "ATENDIDO"];

  // Semana pasada (para el reporte de ausentismo)
  for (const [i, [p, motivo, final]] of ([
    [maria, "Control de caries", ATENDIDA],
    [carlos, "Valoración de prótesis", ATENDIDA],
    [valeria, "Limpieza dental", ["NO_ASISTIO"]],
    [luis, "Control periodontal", ATENDIDA],
    [rosa, "Revisión general", ["CANCELADO"]],
    [ana, "Consulta inicial", ATENDIDA],
    [mateo, "Sellantes", ["CONFIRMADO", "NO_ASISTIO"]],
  ] as const).entries()) {
    const c = await cita(p.id, slot(-7 + (i % 5), 9 + i, 0, 45), motivo);
    await avanzar(c.id, [...final]);
  }

  // Hoy
  await avanzar((await cita(ana.id, slot(0, 8, 30), "Profilaxis")).id, ATENDIDA);
  await avanzar((await cita(carlos.id, slot(0, 9, 30, 60), "Exodoncia del 38")).id, ATENDIDA);
  await avanzar((await cita(maria.id, slot(0, 11, 0, 60), "Restauración del 37")).id, ["CONFIRMADO", "EN_SALA_ESPERA", "EN_ATENCION"]);
  await cita(luis.id, slot(0, 12, 0), "Control periodontal");
  await avanzar((await cita(valeria.id, slot(0, 14, 0), "Limpieza dental")).id, ["CONFIRMADO"]);
  await cita(rosa.id, slot(0, 15, 30, 45), "Revisión con anticoagulante (coordinar INR)");
  await cita(mateo.id, slot(0, 16, 0), "Control de ortodoncia", s3.id, draMora.id);
  await cita(sofia.id, slot(0, 10, 0), "Aplicación de sellantes", s2.id);
  // Próximos días (generan recordatorios 24 h / 48 h)
  await cita(ana.id, slot(1, 9, 0), "Control post profilaxis");
  await cita(carlos.id, slot(1, 10, 30, 60), "Prueba de prótesis", s2.id);
  await cita(luis.id, slot(2, 8, 0, 60), "Raspado y alisado radicular");
  await cita(valeria.id, slot(3, 17, 0), "Blanqueamiento — valoración", s3.id, draMora.id);

  // ---------- Expediente clínico (odontólogo / asistente) ----------
  const hallazgo = (pid: string, b: Record<string, unknown>) => call(odonto, "POST", `/clinico/pacientes/${pid}/hallazgos`, b);
  const realizar = (pid: string, hid: string, procedimientoId: string, costoLaboratorio = 0) =>
    call(odonto, "POST", `/clinico/pacientes/${pid}/hallazgos/${hid}/realizar`, { procedimientoId, consultorioId: c1.id, costoLaboratorio });

  // María: caries, restauraciones y una endodoncia pendiente
  await hallazgo(maria.id, { diente: "16", superficie: "O", tipo: "CARIES", estado: "EXISTENTE" });
  await hallazgo(maria.id, { diente: "16", superficie: "M", tipo: "RESTAURACION", estado: "EXISTENTE", nota: "Resina antigua, bordes íntegros" });
  await hallazgo(maria.id, { diente: "26", tipo: "ENDODONCIA", estado: "REQUERIDO", nota: "Pulpitis irreversible" });
  await hallazgo(maria.id, { diente: "46", superficie: "V", tipo: "SELLANTE", estado: "EXISTENTE" });
  const m37 = await hallazgo(maria.id, { diente: "37", superficie: "O", tipo: "CARIES", estado: "REQUERIDO" });
  await realizar(maria.id, m37.id, procs.REST);
  await hallazgo(maria.id, { diente: "11", superficie: "V", tipo: "RESTAURACION", estado: "EXISTENTE" });

  // Carlos: exodoncia realizada hoy, prótesis existente, ausencias
  const c38 = await hallazgo(carlos.id, { diente: "38", tipo: "EXODONCIA", estado: "REQUERIDO", nota: "Tercer molar semi-incluido" });
  await realizar(carlos.id, c38.id, procs.EXOD);
  await hallazgo(carlos.id, { diente: "21", tipo: "PROTESIS_FIJA", estado: "EXISTENTE" });
  await hallazgo(carlos.id, { diente: "36", tipo: "AUSENTE", estado: "EXISTENTE" });
  await hallazgo(carlos.id, { diente: "46", tipo: "IMPLANTE", estado: "REQUERIDO" });

  // Ana: profilaxis realizada; Sofía y Mateo: dentición temporal/mixta
  const a17 = await hallazgo(ana.id, { diente: "17", superficie: "O", tipo: "SELLANTE", estado: "REQUERIDO" });
  await realizar(ana.id, a17.id, procs.PROF);
  await hallazgo(sofia.id, { diente: "55", superficie: "O", tipo: "CARIES", estado: "EXISTENTE" });
  await hallazgo(sofia.id, { diente: "65", superficie: "V", tipo: "SELLANTE", estado: "REQUERIDO" });
  await hallazgo(sofia.id, { diente: "84", superficie: "O", tipo: "RESTAURACION", estado: "EXISTENTE" });
  await hallazgo(mateo.id, { diente: "85", superficie: "O", tipo: "CARIES", estado: "REQUERIDO" });
  await hallazgo(rosa.id, { diente: "45", tipo: "ENDODONCIA", estado: "EXISTENTE" });
  await hallazgo(luis.id, { diente: "47", superficie: "D", tipo: "CARIES", estado: "REQUERIDO" });

  // Periodontograma de Luis (diabético) y Carlos
  const sitios = (prof: number[], rec: number[], sangra: boolean[]) =>
    ["DV", "V", "MV", "DL", "L", "ML"].map((punto, i) => ({ punto, profundidad: prof[i], margen: rec[i], sangrado: sangra[i] }));
  await call(odonto, "POST", `/clinico/pacientes/${luis.id}/periodontograma`, {
    dientes: [
      { diente: "16", puntos: sitios([5, 4, 6, 5, 4, 5], [1, 1, 2, 1, 0, 1], [true, false, true, true, false, false]), furca: 1, movilidad: 1 },
      { diente: "26", puntos: sitios([4, 3, 4, 4, 3, 4], [0, 0, 1, 0, 0, 1], [false, false, true, false, false, true]), furca: 0, movilidad: 0 },
      { diente: "36", puntos: sitios([6, 5, 7, 6, 5, 6], [2, 1, 2, 2, 1, 2], [true, true, true, true, false, true]), furca: 2, movilidad: 2 },
      { diente: "46", puntos: sitios([3, 3, 4, 3, 3, 3], [0, 0, 0, 0, 0, 0], [false, false, false, false, false, false]), furca: 0, movilidad: 0 },
    ],
  });
  await call(odonto, "POST", `/clinico/pacientes/${carlos.id}/periodontograma`, {
    dientes: [{ diente: "11", puntos: sitios([3, 2, 3, 3, 2, 3], [1, 1, 1, 0, 0, 0], [false, false, false, false, false, false]), furca: 0, movilidad: 0 }],
  });

  // Notas SOEP: firmada (María), bloqueada con adenda (Carlos, de hace 2 días) y una editable de hoy (Luis)
  const nm = await call(odonto, "POST", `/clinico/pacientes/${maria.id}/notas`, {
    subjetivo: "Refiere sensibilidad al frío en molar inferior izquierdo.",
    objetivo: "Caries oclusal en 37 sin compromiso pulpar. Prueba de vitalidad positiva.",
    evaluacion: "Caries dentinaria en 37.",
    plan: "Restauración con resina en 37. Control en 6 meses. Endodoncia de 26 en próxima fase.",
  });
  await call(odonto, "POST", `/clinico/pacientes/${maria.id}/notas/${nm.id}/firmar`, { password: PASSWORD });
  const nc = await call(asis, "POST", `/clinico/pacientes/${carlos.id}/notas`, {
    subjetivo: "Dolor en zona del tercer molar inferior izquierdo hace una semana.",
    objetivo: "38 semi-incluido con pericoronaritis leve.",
    evaluacion: "Indicación de exodoncia del 38.",
    plan: "Exodoncia programada; amoxicilina 500 mg cada 8 h por 7 días.",
  });
  await prisma.notaSoep.update({ where: { id: nc.id }, data: { createdAt: new Date(Date.now() - 48 * 3600e3) } }); // vence el plazo de edición
  await call(odonto, "POST", `/clinico/pacientes/${carlos.id}/notas/${nc.id}/adenda`, { texto: "Se corrige el plan: amoxicilina 500 mg cada 8 h por 5 días (no 7).", password: PASSWORD });
  await call(asis, "POST", `/clinico/pacientes/${luis.id}/notas`, {
    subjetivo: "Sangrado de encías al cepillarse.",
    objetivo: "Bolsas de 5–7 mm en sector posterior, sangrado al sondaje.",
    evaluacion: "Periodontitis estadio III, grado B. Diabetes como factor modificador.",
    plan: "Raspado y alisado radicular por cuadrantes; interconsulta con médico tratante.",
  });

  // Consentimiento firmado por OTP (María, endodoncia) y receta (Carlos)
  const cons = await call(odonto, "POST", "/consentimientos", { patientId: maria.id, procedimientoId: procs.ENDO, metodo: "OTP" });
  if (cons.otpDemo) await call(odonto, "POST", `/consentimientos/${cons.id}/firmar`, { otp: cons.otpDemo });
  await call(odonto, "POST", "/consentimientos", { patientId: mateo.id, procedimientoId: procs.REST, metodo: "FIRMA" }); // pendiente de firma en pantalla
  await call(odonto, "POST", "/recetas", {
    patientId: carlos.id,
    diagnostico: "Post exodoncia de 38",
    items: [
      { medicamento: "Paracetamol 500 mg", dosis: "1 tableta", frecuencia: "cada 8 horas", duracion: "3 días", indicaciones: "Si hay dolor" },
      { medicamento: "Clorhexidina 0,12 %", dosis: "15 ml", frecuencia: "cada 12 horas", duracion: "7 días", indicaciones: "Enjuague, iniciar 24 h después" },
    ],
  });

  // ---------- Presupuestos ----------
  const pm = await call(odonto, "POST", "/presupuestos", {
    patientId: maria.id,
    descuento: 1500,
    items: [
      { fase: 1, sesion: 1, procedimientoId: procs.ENDO, diente: "26", honorario: 5000 },
      { fase: 1, sesion: 2, procedimientoId: procs.REST, diente: "26", costoLaboratorio: 0 },
      { fase: 2, sesion: 1, procedimientoId: procs.PROF },
    ],
  });
  await call(odonto, "POST", `/presupuestos/${pm.id}/presentar`); // queda para aprobar en la demo
  const pc = await call(odonto, "POST", "/presupuestos", {
    patientId: carlos.id,
    items: [
      { fase: 1, sesion: 1, procedimientoId: procs.CONS },
      { fase: 2, sesion: 1, procedimientoId: procs.ENDO, diente: "46", costoLaboratorio: 8000 },
      { fase: 2, sesion: 2, procedimientoId: procs.REST, diente: "46" },
    ],
  });
  await call(odonto, "POST", `/presupuestos/${pc.id}/presentar`);
  await call(recep, "POST", `/presupuestos/${pc.id}/aprobar`, { itemIds: [pc.items[0].id, pc.items[1].id] });
  await call(recep, "POST", `/presupuestos/items/${pc.items[0].id}/agendar`, { profesionalId: drDemo.id, sillonId: s1.id, ...slot(4, 9, 0) });
  await call(odonto, "POST", "/presupuestos", { patientId: luis.id, items: [{ fase: 1, sesion: 1, procedimientoId: procs.PROF }, { fase: 1, sesion: 2, procedimientoId: procs.PROF }] }); // borrador

  // ---------- Caja: un turno de hoy ya cerrado (con faltante de $1) ----------
  await call(recep, "POST", "/caja/apertura", { fondoInicial: 5000 });
  const cobrar = (patientId: string, lineas: [string, number][], pagos: Record<string, unknown>[]) =>
    call(recep, "POST", "/caja/cobros", { patientId, lineas: lineas.map(([procedimientoId, cantidad]) => ({ procedimientoId, cantidad })), pagos });
  await cobrar(ana.id, [[procs.PROF, 1]], [{ metodo: "PASARELA", monto: 2000, token: "tok_visa" }, { metodo: "EFECTIVO", monto: 1500 }]);
  await cobrar(carlos.id, [[procs.CONS, 1], [procs.EXOD, 1]], [{ metodo: "TARJETA_CREDITO", monto: 4500, referencia: "AUT-104582" }]);
  await cobrar(maria.id, [[procs.REST, 1]], [{ metodo: "EFECTIVO", monto: 2500 }, { metodo: "TRANSFERENCIA", monto: 2000, referencia: "TRF-88213" }]);
  await cobrar(luis.id, [[procs.CONS, 1]], [{ metodo: "SEGURO", monto: 1500, referencia: "Póliza 55-2031" }]);
  await call(recep, "POST", "/caja/cierre", { conteoEfectivo: 5000 + 1500 + 2500 - 100 });

  // Recordatorios de las citas de mañana y pasado mañana (canal simulado)
  const r = await call(recep, "POST", "/recordatorios/ejecutar");
  console.log(`Demo: cargada (${r.enviados} recordatorios enviados)`);
} finally {
  server.close();
  await prisma.$disconnect();
}
