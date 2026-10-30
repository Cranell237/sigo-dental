// Prueba funcional de punta a punta contra un despliegue real (por defecto, producción en Render).
// Recorre los módulos con cada rol usando solo el API público. Uso:
//   npm run e2e -w api                                   → https://sigo-dental-iyr0.onrender.com
//   BASE_URL=http://localhost:3000 npm run e2e -w api    → otro entorno
// Crea datos de prueba (un paciente "Prueba E2E", citas, cobros…); en Render desaparecen al reiniciar.
import { authenticator } from "otplib";

const BASE = (process.env.BASE_URL ?? "https://sigo-dental-iyr0.onrender.com").replace(/\/$/, "");
const TOTP = "JBSWY3DPEHPK3PXP";
let ok = 0;
const fallos: string[] = [];

async function req(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tipo = res.headers.get("content-type") ?? "";
  const data = tipo.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data: data as any, tipo };
}

async function paso(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos.push(nombre);
    console.log(`  ✗ ${nombre}: ${(e as Error).message}`);
  }
}
function esperar(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function login(email: string) {
  const r1 = await req(null, "POST", "/auth/login", { email, password: "Demo1234!" });
  esperar(r1.status === 200, `login ${r1.status}`);
  if (!r1.data.mfaRequired) return r1.data.token as string;
  const r2 = await req(null, "POST", "/auth/login/mfa", { mfaToken: r1.data.mfaToken, code: authenticator.generate(TOTP) });
  esperar(r2.status === 200, `MFA ${r2.status}`);
  return r2.data.token as string;
}

const ec = new Date(Date.now() - 5 * 3600e3);
const hoy = (dias = 0, hora = 0) => new Date(Date.UTC(ec.getUTCFullYear(), ec.getUTCMonth(), ec.getUTCDate() + dias, hora + 5)).toISOString();

console.log(`Prueba E2E contra ${BASE}\n`);
const t: Record<string, string> = {};
const ctx: Record<string, any> = {};

console.log("Sistema y documentación");
await paso("health con base de datos", async () => {
  const r = await req(null, "GET", "/health");
  esperar(r.status === 200 && r.data.db === "ok", JSON.stringify(r.data));
});
await paso("OpenAPI 3.0 publicada (JSON y Swagger UI)", async () => {
  const r = await req(null, "GET", "/docs/openapi.json");
  esperar(r.data.openapi === "3.0.3" && Object.keys(r.data.paths).length >= 60, "spec incompleta");
  esperar((await fetch(BASE + "/api/docs/")).status === 200, "Swagger UI no responde");
});
await paso("cabeceras de seguridad", async () => {
  const res = await fetch(BASE + "/api/health");
  esperar(res.headers.get("strict-transport-security") && res.headers.get("content-security-policy"), "faltan HSTS/CSP");
});

console.log("\nAutenticación y permisos");
await paso("login con contraseña + TOTP de los 5 roles", async () => {
  for (const r of ["admin", "odontologo", "recepcion", "asistente", "auditor"]) t[r] = await login(`${r}@sigo.test`);
});
await paso("contraseña incorrecta → 401", async () => {
  esperar((await req(null, "POST", "/auth/login", { email: "admin@sigo.test", password: "x" })).status === 401, "no rechazó");
});
await paso("sin token → 401; recepción en el expediente → 403; auditor en pacientes → 403", async () => {
  esperar((await req(null, "GET", "/pacientes")).status === 401, "sin token");
  ctx.maria = (await req(t.recepcion, "GET", "/pacientes?q=1710000001")).data[0];
  esperar((await req(t.recepcion, "GET", `/clinico/pacientes/${ctx.maria.id}/notas`)).status === 403, "recepción leyó notas");
  esperar((await req(t.auditor, "GET", "/pacientes")).status === 403, "auditor leyó pacientes");
});

await paso("administrador: gestión de usuarios y catálogos", async () => {
  const u = await req(t.admin, "GET", "/usuarios");
  esperar(u.status === 200 && u.data.length >= 5 && !("passwordHash" in u.data[0]), "listado de usuarios");
  esperar((await req(t.odontologo, "GET", "/usuarios")).status === 403, "un odontólogo accedió a usuarios");
  esperar((await req(t.admin, "GET", "/catalogos/consultorios")).data.length >= 2, "catálogos");
});

console.log("\nPacientes y agenda");
await paso("datos de demostración cargados (8 pacientes, alertas críticas)", async () => {
  const r = await req(t.recepcion, "GET", "/pacientes");
  esperar(r.data.length >= 8, `solo ${r.data.length} pacientes`);
  esperar(r.data.some((p: any) => p.alertas.includes("Alergia: Penicilina")), "sin badge de alergia");
});
await paso("alta de paciente con anamnesis; menor sin tutor rechazado", async () => {
  const cedula = `99${Date.now().toString().slice(-8)}`;
  const base = { cedula, nombres: "Prueba", apellidos: "E2E", fechaNacimiento: "1990-01-01", sexo: "F", telefono: "0990000000", emergenciaNombre: "X", emergenciaTelefono: "0990000001", anamnesis: { alergias: ["Látex"], anticoagulado: false, coagulopatia: false } };
  const r = await req(t.recepcion, "POST", "/pacientes", base);
  esperar(r.status === 201 && r.data.alertas[0] === "Alergia: Látex", JSON.stringify(r.data));
  ctx.paciente = r.data;
  const menor = await req(t.recepcion, "POST", "/pacientes", { ...base, cedula: cedula + "1", fechaNacimiento: hoy(-365 * 5).slice(0, 10) });
  esperar(menor.status === 400, "aceptó menor sin tutor");
});
await paso("agenda del día con citas en varios estados", async () => {
  const r = await req(t.recepcion, "GET", `/citas?desde=${encodeURIComponent(hoy(0))}&hasta=${encodeURIComponent(hoy(1))}`);
  esperar(r.data.length >= 6, `solo ${r.data.length} citas hoy`);
  esperar(new Set(r.data.map((c: any) => c.estado)).size >= 3, "pocos estados");
});
await paso("cita nueva; solapamiento en el mismo sillón rechazado; transiciones válidas", async () => {
  const consultorios = (await req(t.recepcion, "GET", "/catalogos/consultorios")).data;
  ctx.consultorio = consultorios[0];
  ctx.prof = (await req(t.recepcion, "GET", "/catalogos/profesionales")).data[0];
  const s = { patientId: ctx.paciente.id, profesionalId: ctx.prof.id, sillonId: ctx.consultorio.sillones[0].id, inicio: hoy(20, 9), fin: hoy(20, 10) };
  const c = await req(t.recepcion, "POST", "/citas", s);
  esperar(c.status === 201, `crear ${c.status}`);
  esperar((await req(t.recepcion, "POST", "/citas", s)).status === 409, "permitió solapamiento");
  esperar((await req(t.recepcion, "PATCH", `/citas/${c.data.id}/estado`, { estado: "ATENDIDO" })).status === 409, "permitió saltar estados");
  esperar((await req(t.recepcion, "PATCH", `/citas/${c.data.id}/estado`, { estado: "CONFIRMADO" })).status === 200, "no confirmó");
});

console.log("\nExpediente clínico");
await paso("odontograma, periodontograma y notas de la demo", async () => {
  const o = await req(t.odontologo, "GET", `/clinico/pacientes/${ctx.maria.id}/odontograma`);
  esperar(o.data.hallazgos.length >= 5, "odontograma vacío");
  const n = await req(t.odontologo, "GET", `/clinico/pacientes/${ctx.maria.id}/notas`);
  esperar(n.data.some((x: any) => x.firmada), "sin nota firmada");
});
await paso("hallazgo → realizado con descargo de insumos (stock baja)", async () => {
  const inv = async () => (await req(t.asistente, "GET", `/inventario?consultorioId=${ctx.consultorio.id}`)).data.find((i: any) => i.codigo === "GUA-M").stock;
  const antes = await inv();
  const h = await req(t.odontologo, "POST", `/clinico/pacientes/${ctx.paciente.id}/hallazgos`, { diente: "17", superficie: "O", tipo: "SELLANTE", estado: "REQUERIDO" });
  const procs = (await req(t.odontologo, "GET", "/catalogos/procedimientos")).data;
  const prof = procs.find((p: any) => p.codigo === "PROF").id;
  const r = await req(t.odontologo, "POST", `/clinico/pacientes/${ctx.paciente.id}/hallazgos/${h.data.id}/realizar`, { procedimientoId: prof, consultorioId: ctx.consultorio.id });
  esperar(r.status === 200 && r.data.estado === "REALIZADO", `realizar ${r.status}`);
  esperar((await inv()) === antes - 1, "no descontó guantes");
  esperar((await req(t.odontologo, "DELETE", `/clinico/pacientes/${ctx.paciente.id}/hallazgos/${h.data.id}`)).status === 409, "permitió borrar lo realizado");
  ctx.procs = procs;
});
await paso("nota SOEP: crear, firmar con contraseña y queda inmutable", async () => {
  const n = await req(t.asistente, "POST", `/clinico/pacientes/${ctx.paciente.id}/notas`, { subjetivo: "S", objetivo: "O", evaluacion: "E", plan: "P" });
  esperar((await req(t.odontologo, "POST", `/clinico/pacientes/${ctx.paciente.id}/notas/${n.data.id}/firmar`, { password: "Demo1234!" })).data.firmada, "no firmó");
  esperar((await req(t.asistente, "PATCH", `/clinico/pacientes/${ctx.paciente.id}/notas/${n.data.id}`, { plan: "x" })).status === 409, "editó una nota firmada");
});
await paso("consentimiento por OTP → PDF firmado", async () => {
  const c = await req(t.odontologo, "POST", "/consentimientos", { patientId: ctx.paciente.id, metodo: "OTP" });
  esperar(c.data.otpDemo, "sin OTP de demo");
  esperar((await req(t.odontologo, "POST", `/consentimientos/${c.data.id}/firmar`, { otp: c.data.otpDemo })).data.estado === "FIRMADO", "no firmó");
  const pdf = await req(t.odontologo, "GET", `/consentimientos/${c.data.id}/pdf`);
  esperar(pdf.tipo.includes("pdf") && (pdf.data as Buffer).subarray(0, 4).toString() === "%PDF", "PDF inválido");
});
await paso("receta: aviso de alergia y PDF", async () => {
  const item = { medicamento: "Guantes de látex", dosis: "-", frecuencia: "-", duracion: "-" };
  esperar((await req(t.odontologo, "POST", "/recetas", { patientId: ctx.paciente.id, items: [item] })).data.code === "ALERGIA", "sin aviso de alergia");
  const r = await req(t.odontologo, "POST", "/recetas", { patientId: ctx.paciente.id, items: [{ medicamento: "Paracetamol 500 mg", dosis: "1", frecuencia: "c/8h", duracion: "3 días" }] });
  const pdf = await req(t.odontologo, "GET", `/recetas/${r.data.id}/pdf`);
  esperar((pdf.data as Buffer).subarray(0, 4).toString() === "%PDF", "PDF inválido");
});

console.log("\nPresupuestos, caja y facturación");
await paso("presupuesto → presentar → aprobación parcial → agendar ítem", async () => {
  const p = await req(t.odontologo, "POST", "/presupuestos", { patientId: ctx.paciente.id, descuento: 500, items: [{ fase: 1, sesion: 1, procedimientoId: ctx.procs[0].id }, { fase: 2, sesion: 1, procedimientoId: ctx.procs[1].id }] });
  await req(t.odontologo, "POST", `/presupuestos/${p.data.id}/presentar`);
  const a = await req(t.recepcion, "POST", `/presupuestos/${p.data.id}/aprobar`, { itemIds: [p.data.items[0].id] });
  esperar(a.data.estado === "APROBADO_PARCIAL", a.data.estado);
  const g = await req(t.recepcion, "POST", `/presupuestos/items/${p.data.items[0].id}/agendar`, { profesionalId: ctx.prof.id, sillonId: ctx.consultorio.sillones[0].id, inicio: hoy(21, 9), fin: hoy(21, 10) });
  esperar(g.status === 201, `agendar ${g.status}`);
});
await paso("caja: turno, cobro mixto con pasarela, factura XML, rechazo y cierre ciego", async () => {
  const turno = await req(t.recepcion, "GET", "/caja/turno");
  if (!turno.data) await req(t.recepcion, "POST", "/caja/apertura", { fondoInicial: 1000 });
  const abierto = (await req(t.recepcion, "GET", "/caja/turno")).data;
  esperar(abierto.totalTeorico === undefined, "expone el teórico con el turno abierto");
  const proc = ctx.procs.find((p: any) => p.codigo === "CONS");
  const c = await req(t.recepcion, "POST", "/caja/cobros", { patientId: ctx.paciente.id, lineas: [{ procedimientoId: proc.id, cantidad: 1 }], pagos: [{ metodo: "PASARELA", monto: 1000, token: "tok_visa" }, { metodo: "EFECTIVO", monto: proc.precioBase - 1000 }] });
  esperar(c.status === 201 && /^\d{49}$/.test(c.data.factura.claveAcceso), `cobro ${c.status}`);
  const xml = await fetch(`${BASE}/api/caja/cobros/${c.data.id}/factura.xml`, { headers: { Authorization: `Bearer ${t.recepcion}` } });
  esperar((await xml.text()).includes("<factura"), "XML inválido");
  const rechazo = await req(t.recepcion, "POST", "/caja/cobros", { patientId: ctx.paciente.id, lineas: [{ procedimientoId: proc.id, cantidad: 1 }], pagos: [{ metodo: "PASARELA", monto: proc.precioBase, token: "tok_declined" }] });
  esperar(rechazo.status === 402, "no rechazó el pago");
  const cierre = await req(t.recepcion, "POST", "/caja/cierre", { conteoEfectivo: 0 });
  esperar(typeof cierre.data.totalTeorico === "number" && typeof cierre.data.diferencia === "number", "el cierre no revela el teórico");
});

console.log("\nInventario, honorarios, reportes y auditoría");
await paso("inventario: entrada de lote (asistente)", async () => {
  const inv = (await req(t.asistente, "GET", `/inventario?consultorioId=${ctx.consultorio.id}`)).data;
  const r = await req(t.asistente, "POST", "/inventario/entradas", { insumoId: inv[0].id, consultorioId: ctx.consultorio.id, lote: `E2E-${Date.now()}`, cantidad: 5 });
  esperar(r.status === 201, `entrada ${r.status}`);
});
await paso("honorarios: previsualización con procedimientos realizados", async () => {
  const profs = (await req(t.auditor, "GET", "/catalogos/profesionales")).data;
  const dr = profs.find((p: any) => p.userId);
  const r = await req(t.auditor, "GET", `/honorarios/previsualizar?profesionalId=${dr.id}&desde=${encodeURIComponent(hoy(-30))}&hasta=${encodeURIComponent(hoy(1))}`);
  esperar(r.status === 200 && r.data.total > 0, `total ${r.data.total}`);
});
await paso("reportes: corte de caja, inventario, ausentismo y CSV", async () => {
  const q = `desde=${encodeURIComponent(hoy(-10))}&hasta=${encodeURIComponent(hoy(1))}`;
  esperar((await req(t.auditor, "GET", `/reportes/corte-caja?${q}`)).data.filas.length >= 1, "corte vacío");
  esperar((await req(t.auditor, "GET", `/reportes/ausentismo?${q}`)).data.resumen.noShow >= 1, "sin no-shows");
  esperar((await req(t.auditor, "GET", "/reportes/inventario")).data.filas.length >= 1, "inventario vacío");
  const csv = await fetch(`${BASE}/api/reportes/inventario?formato=csv`, { headers: { Authorization: `Bearer ${t.auditor}` } });
  esperar(csv.headers.get("content-type")?.includes("text/csv"), "no exporta CSV");
});
await paso("auditoría: accesos registrados y cadena de hashes íntegra", async () => {
  esperar((await req(t.auditor, "GET", "/auditoria?limit=5")).data.length === 5, "sin registros");
  const v = await req(t.auditor, "GET", "/auditoria/verificar");
  esperar(v.data.ok === true, JSON.stringify(v.data));
});

console.log(`\n${ok} pasos correctos, ${fallos.length} con fallas${fallos.length ? ": " + fallos.join("; ") : ""}`);
process.exit(fallos.length ? 1 : 0);
