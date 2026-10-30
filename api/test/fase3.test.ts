import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { encrypt } from "../src/crypto.js";
import { calcularComision } from "../src/routes/honorarios.js";
import { loginFull, DEMO_TOTP_SECRET } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const run = Date.now().toString().slice(-8);

let admin: string, asis: string, recep: string, auditor: string, odonto: string; // odonto = odontólogo propio de esta corrida
let consultorioId: string, profesionalId: string, pid: string, procId: string;
let n = 0;

const hallazgo = async () =>
  (await request(app).post(`/api/clinico/pacientes/${pid}/hallazgos`).set(bearer(odonto)).send({ diente: "16", superficie: "O", tipo: "CARIES", estado: "REQUERIDO" })).body.id as string;
const realizar = (hid: string, body: object) => request(app).post(`/api/clinico/pacientes/${pid}/hallazgos/${hid}/realizar`).set(bearer(odonto)).send(body);
const insumo = (extra: object = {}) =>
  prisma.insumo.create({ data: { codigo: `I${run}${n++}`, nombre: `Insumo ${n}`, unidad: "u", stockMinimo: 0, costoUnitario: 100, ...extra } });
const lote = (insumoId: string, cantidad: number, lote: string, vence?: Date) =>
  request(app).post("/api/inventario/entradas").set(bearer(asis)).send({ insumoId, consultorioId, lote, cantidad, vence: vence?.toISOString() });
const stockDe = async (insumoId: string) => (await prisma.loteInsumo.aggregate({ _sum: { cantidad: true }, where: { insumoId, consultorioId } }))._sum.cantidad ?? 0;

beforeAll(async () => {
  admin = (await loginFull(app, "admin@sigo.test")).token;
  asis = (await loginFull(app, "asistente@sigo.test")).token;
  recep = (await loginFull(app, "recepcion@sigo.test")).token;
  auditor = (await loginFull(app, "auditor@sigo.test")).token;

  // Odontólogo propio (con su profesional) para que las liquidaciones de esta corrida no se mezclen con otras.
  const base = await prisma.user.findUniqueOrThrow({ where: { email: "odontologo@sigo.test" } });
  const u = await prisma.user.create({ data: { email: `odo${run}@sigo.test`, name: "Odo Fase3", role: "ODONTOLOGO", passwordHash: base.passwordHash, mfaEnabled: true, mfaSecret: encrypt(DEMO_TOTP_SECRET) } });
  profesionalId = (await prisma.profesional.create({ data: { userId: u.id, nombre: `Dr. Fase3 ${run}`, especialidad: "General" } })).id;
  odonto = (await loginFull(app, u.email)).token;

  consultorioId = (await prisma.consultorio.create({ data: { nombre: `Inv ${run}`, sillones: { create: [{ nombre: "S" }] } } })).id;
  pid = (await prisma.patient.findFirstOrThrow({ where: { cedula: "1710000002" } })).id;
  procId = (await prisma.procedimiento.create({ data: { codigo: `P${run}`, nombre: `Proc ${run}`, precioBase: 4500 } })).id;
});

describe("inventario (3.1)", () => {
  it("registra entradas por lote, calcula el stock y avisa del mínimo", async () => {
    const i = await insumo({ stockMinimo: 10 });
    expect((await lote(i.id, 6, "A")).status).toBe(201);
    expect((await lote(i.id, 2, "A")).status).toBe(201); // mismo lote: suma
    const inv = await request(app).get(`/api/inventario?consultorioId=${consultorioId}`).set(bearer(odonto));
    const fila = inv.body.find((x: { id: string }) => x.id === i.id);
    expect(fila.stock).toBe(8);
    expect(fila.bajoMinimo).toBe(true);
    expect(fila.lotes).toHaveLength(1);
    expect((await prisma.movimientoInventario.count({ where: { insumoId: i.id, tipo: "ENTRADA" } }))).toBe(2);
  });

  it("solo asistente y admin modifican; la recepcionista no ve el inventario", async () => {
    const i = await insumo();
    expect((await request(app).post("/api/inventario/entradas").set(bearer(recep)).send({ insumoId: i.id, consultorioId, lote: "X", cantidad: 1 })).status).toBe(403);
    expect((await request(app).get(`/api/inventario?consultorioId=${consultorioId}`).set(bearer(recep))).status).toBe(403);
    expect((await request(app).post("/api/inventario/entradas").set(bearer(odonto)).send({ insumoId: i.id, consultorioId, lote: "X", cantidad: 1 })).status).toBe(403);
  });

  it("el ajuste por conteo deja el saldo real y el libro de movimientos no se edita", async () => {
    const i = await insumo();
    const l = (await lote(i.id, 10, "AJ")).body;
    expect((await request(app).post("/api/inventario/ajustes").set(bearer(asis)).send({ loteId: l.id, cantidadReal: 7, motivo: "Conteo físico" })).status).toBe(200);
    expect(await stockDe(i.id)).toBe(7);
    const mov = await prisma.movimientoInventario.findFirstOrThrow({ where: { insumoId: i.id, tipo: "AJUSTE" } });
    expect(mov.motivo).toContain("-3");
    await expect(prisma.movimientoInventario.update({ where: { id: mov.id }, data: { cantidad: 1 } })).rejects.toThrow();
    await expect(prisma.movimientoInventario.delete({ where: { id: mov.id } })).rejects.toThrow();
  });

  it("solo el admin crea insumos y define la receta de consumo", async () => {
    const body = { codigo: `N${run}`, nombre: "=1+1", unidad: "u" };
    expect((await request(app).post("/api/inventario/insumos").set(bearer(asis)).send(body)).status).toBe(403);
    expect((await request(app).post("/api/inventario/insumos").set(bearer(admin)).send(body)).status).toBe(201);
    const i = await insumo();
    expect((await request(app).put(`/api/inventario/receta-consumo/${procId}`).set(bearer(asis)).send({ items: [{ insumoId: i.id, cantidad: 1 }] })).status).toBe(403);
    expect((await request(app).put(`/api/inventario/receta-consumo/${procId}`).set(bearer(admin)).send({ items: [{ insumoId: i.id, cantidad: 1 }, { insumoId: i.id, cantidad: 2 }] })).status).toBe(400);
  });
});

describe("descargo automático (RF-14)", () => {
  const receta = (items: { insumoId: string; cantidad: number }[]) => request(app).put(`/api/inventario/receta-consumo/${procId}`).set(bearer(admin)).send({ items });

  it("al marcar realizado descuenta la receta en FEFO y registra el costo de materiales", async () => {
    const a = await insumo({ costoUnitario: 150 });
    const b = await insumo({ costoUnitario: 25 });
    await lote(a.id, 3, "TARDE", new Date(Date.now() + 200 * 864e5));
    await lote(a.id, 3, "PRONTO", new Date(Date.now() + 20 * 864e5));
    await lote(b.id, 10, "B1");
    await receta([{ insumoId: a.id, cantidad: 4 }, { insumoId: b.id, cantidad: 2 }]);

    const hid = await hallazgo();
    const r = await realizar(hid, { procedimientoId: procId, consultorioId, costoLaboratorio: 500 });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe("REALIZADO");

    const lotes = await prisma.loteInsumo.findMany({ where: { insumoId: a.id } });
    expect(lotes.find((l) => l.lote === "PRONTO")!.cantidad).toBe(0); // se agotó primero el que vence antes
    expect(lotes.find((l) => l.lote === "TARDE")!.cantidad).toBe(2);
    expect(await stockDe(b.id)).toBe(8);

    const mov = await prisma.movimientoInventario.findMany({ where: { hallazgoId: hid } });
    expect(mov.every((m) => m.tipo === "SALIDA")).toBe(true);
    const snap = await prisma.procedimientoRealizado.findUniqueOrThrow({ where: { hallazgoId: hid } });
    expect(snap.costoMateriales).toBe(4 * 150 + 2 * 25);
    expect(snap.costoLaboratorio).toBe(500);
    expect(snap.precio).toBe(4500);
    expect(snap.profesionalId).toBe(profesionalId);
  });

  it("si falta stock no queda nada a medias: ni realizado, ni descuentos", async () => {
    const ok = await insumo();
    const falta = await insumo({ nombre: "Insumo escaso" });
    await lote(ok.id, 10, "OK");
    await lote(falta.id, 1, "F");
    await receta([{ insumoId: ok.id, cantidad: 3 }, { insumoId: falta.id, cantidad: 2 }]);

    const hid = await hallazgo();
    const r = await realizar(hid, { procedimientoId: procId, consultorioId });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("STOCK_INSUFICIENTE");
    expect(r.body.faltantes).toEqual([{ insumo: "Insumo escaso", requerido: 2, disponible: 1 }]);

    expect((await prisma.hallazgo.findUniqueOrThrow({ where: { id: hid } })).estado).toBe("REQUERIDO");
    expect(await stockDe(ok.id)).toBe(10); // el que sí alcanzaba tampoco se descontó
    expect(await stockDe(falta.id)).toBe(1);
    expect(await prisma.movimientoInventario.count({ where: { hallazgoId: hid } })).toBe(0);
    expect(await prisma.procedimientoRealizado.count({ where: { hallazgoId: hid } })).toBe(0);
  });

  it("sin receta configurada se marca realizado sin descontar, y exige consultorio", async () => {
    await receta([]);
    const hid = await hallazgo();
    expect((await realizar(hid, { procedimientoId: procId })).status).toBe(400);
    const r = await realizar(hid, { procedimientoId: procId, consultorioId });
    expect(r.status).toBe(200);
    expect((await prisma.procedimientoRealizado.findUniqueOrThrow({ where: { hallazgoId: hid } })).costoMateriales).toBe(0);
  });
});

describe("honorarios (RF-13)", () => {
  it("calcula las tres modalidades al centavo, sin floats", () => {
    const p = { precio: 4500, costoMateriales: 1200, costoLaboratorio: 1000 };
    expect(calcularComision("PORCENTAJE", 4000, p)).toEqual({ base: 4500, comision: 1800 });
    expect(calcularComision("MONTO_FIJO", 700, p).comision).toBe(700);
    expect(calcularComision("PORCENTAJE_NETO", 5000, p)).toEqual({ base: 2300, comision: 1150 });
    expect(calcularComision("PORCENTAJE_NETO", 5000, { precio: 1000, costoMateriales: 800, costoLaboratorio: 800 }).comision).toBe(0); // nunca negativo
    // redondeo al centavo más cercano, mitades hacia arriba
    expect(calcularComision("PORCENTAJE", 1000, { precio: 5, costoMateriales: 0, costoLaboratorio: 0 }).comision).toBe(1);
    expect(calcularComision("PORCENTAJE", 3333, { precio: 3333, costoMateriales: 0, costoLaboratorio: 0 }).comision).toBe(1111);
    expect(calcularComision("PORCENTAJE", 3333, { precio: 3, costoMateriales: 0, costoLaboratorio: 0 }).comision).toBe(1);
  });

  it("liquida por regla específica o general, deja sin regla lo no configurado y liquida una sola vez", async () => {
    const otro = await prisma.procedimiento.create({ data: { codigo: `Q${run}`, nombre: "Otro", precioBase: 10000 } });
    const sinRegla = await prisma.procedimiento.create({ data: { codigo: `R${run}`, nombre: "Sin regla", precioBase: 2000 } });
    // El periodo arranca aquí: los procedimientos realizados en pruebas anteriores quedan fuera.
    const desde = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));

    // procedimientos realizados (sin receta de consumo → sin descargo)
    await prisma.recetaConsumo.deleteMany({ where: { procedimientoId: { in: [procId, otro.id, sinRegla.id] } } });
    for (const p of [procId, otro.id, sinRegla.id]) expect((await realizar(await hallazgo(), { procedimientoId: p, consultorioId })).status).toBe(200);

    const regla = (body: object, t = admin) => request(app).put("/api/honorarios/reglas").set(bearer(t)).send({ profesionalId, ...body });
    expect((await regla({ modalidad: "PORCENTAJE", valor: 4000 }, auditor)).status).toBe(403);
    expect((await regla({ modalidad: "PORCENTAJE", valor: 20000 })).status).toBe(400);
    // solo regla específica para `otro` (monto fijo): los demás no tienen regla
    expect((await regla({ procedimientoId: otro.id, modalidad: "MONTO_FIJO", valor: 3000 })).status).toBe(200);
    expect((await regla({ procedimientoId: procId, modalidad: "PORCENTAJE", valor: 4000 })).status).toBe(200);
    expect((await regla({ procedimientoId: procId, modalidad: "PORCENTAJE", valor: 5000 })).status).toBe(200); // reemplaza, no duplica
    expect(await prisma.reglaHonorario.count({ where: { profesionalId, procedimientoId: procId } })).toBe(1);

    const q = `profesionalId=${profesionalId}&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(new Date(Date.now() + 60e3).toISOString())}`;
    expect((await request(app).get(`/api/honorarios/previsualizar?${q}`).set(bearer(odonto))).status).toBe(403);
    const prev = await request(app).get(`/api/honorarios/previsualizar?${q}`).set(bearer(auditor));
    expect(prev.body.total).toBe(4500 / 2 + 3000); // 50 % de 4500 + 3000 fijos
    expect(prev.body.sinRegla).toHaveLength(1);

    const liq = await request(app).post("/api/honorarios/liquidar").set(bearer(auditor)).send({ profesionalId, desde, hasta: new Date(Date.now() + 60e3).toISOString() });
    expect(liq.status).toBe(201);
    expect(liq.body.total).toBe(5250);
    expect(liq.body.lineas).toHaveLength(2);

    // ya liquidado: no se vuelve a pagar; lo que no tiene regla sigue pendiente
    const otra = await request(app).post("/api/honorarios/liquidar").set(bearer(auditor)).send({ profesionalId, desde, hasta: new Date(Date.now() + 60e3).toISOString() });
    expect(otra.status).toBe(409);
    expect(otra.body.sinRegla).toHaveLength(1);

    const hecho = await prisma.procedimientoRealizado.findFirstOrThrow({ where: { liquidacionId: liq.body.id } });
    await expect(prisma.procedimientoRealizado.update({ where: { id: hecho.id }, data: { liquidacionId: null } })).rejects.toThrow();
    await expect(prisma.procedimientoRealizado.update({ where: { id: hecho.id }, data: { precio: 1 } })).rejects.toThrow();
    await expect(prisma.liquidacion.delete({ where: { id: liq.body.id } })).rejects.toThrow();
  });
});

describe("pasarela de pagos simulada (3.5)", () => {
  let cobros: number;
  beforeAll(async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "recepcion@sigo.test" } });
    await prisma.cajaTurno.updateMany({ where: { userId: u.id, estado: "ABIERTA" }, data: { estado: "CERRADA" } });
    await request(app).post("/api/caja/apertura").set(bearer(recep)).send({ fondoInicial: 5000 });
  });

  const cobrar = (pagos: object[]) =>
    request(app).post("/api/caja/cobros").set(bearer(recep)).send({ patientId: pid, lineas: [{ procedimientoId: procId, cantidad: 1 }], pagos });

  it("aprueba con un token válido y guarda la transacción como referencia", async () => {
    const r = await cobrar([{ metodo: "PASARELA", monto: 4500, token: "tok_visa" }]);
    expect(r.status).toBe(201);
    expect(r.body.pagos[0].referencia).toMatch(/^sim_/);
    expect(r.body.factura.estado).toBe("AUTORIZADO");
  });

  it("un rechazo no deja cobro ni factura", async () => {
    cobros = await prisma.cobro.count();
    const facturas = await prisma.factura.count();
    const r = await cobrar([{ metodo: "PASARELA", monto: 4500, token: "tok_declined" }]);
    expect(r.status).toBe(402);
    expect(r.body.error).toContain("rechazado");
    expect(await prisma.cobro.count()).toBe(cobros);
    expect(await prisma.factura.count()).toBe(facturas);
  });

  it("exige token y no acepta números de tarjeta", async () => {
    expect((await cobrar([{ metodo: "PASARELA", monto: 4500 }])).status).toBe(400);
    expect((await cobrar([{ metodo: "PASARELA", monto: 4500, token: "4242424242424242" }])).status).toBe(402);
  });

  it("combina pasarela y efectivo", async () => {
    const r = await cobrar([{ metodo: "PASARELA", monto: 2500, token: "tok_mastercard" }, { metodo: "EFECTIVO", monto: 2000 }]);
    expect(r.status).toBe(201);
    expect(r.body.pagos).toHaveLength(2);
  });
});

describe("reportes (3.4)", () => {
  const rango = () => `desde=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}&hasta=${encodeURIComponent(new Date(Date.now() + 3600e3).toISOString())}`;

  it("solo el auditor y el admin los ven", async () => {
    expect((await request(app).get(`/api/reportes/ausentismo?${rango()}`).set(bearer(recep))).status).toBe(403);
    expect((await request(app).get(`/api/reportes/inventario`).set(bearer(odonto))).status).toBe(403);
    expect((await request(app).get(`/api/reportes/inventario`).set(bearer(auditor))).status).toBe(200);
  });

  it("corte de caja: ve el teórico y la diferencia que la recepcionista no vio al cerrar", async () => {
    const cierre = await request(app).post("/api/caja/cierre").set(bearer(recep)).send({ conteoEfectivo: 5000 + 2000 - 100 });
    expect(cierre.body.diferencia).toBe(-100);
    const rep = await request(app).get(`/api/reportes/corte-caja?${rango()}`).set(bearer(auditor));
    expect(rep.status).toBe(200);
    const fila = rep.body.filas.find((f: { turno: string }) => f.turno === cierre.body.id);
    expect(fila.efectivo).toBe(2000);
    expect(fila.tarjetas).toBe(4500 + 2500); // pasarela de los dos cobros aprobados
    expect(fila.efectivoTeorico).toBe(7000);
    expect(fila.diferencia).toBe(-100);
    expect(rep.body.resumen.porMetodo.PASARELA).toBeGreaterThanOrEqual(7000); // acumula todos los turnos del periodo
  });

  it("exporta CSV y neutraliza fórmulas", async () => {
    const res = await request(app).get("/api/reportes/inventario?formato=csv").set(bearer(auditor));
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toBe("consultorio,insumo,unidad,stock,stockMinimo,bajoMinimo,porVencer30Dias,valorizado");
    expect(res.text).toContain("'=1+1"); // el insumo "=1+1" creado antes no se interpreta como fórmula
    expect(res.text).not.toMatch(/,=1\+1,/);
  });

  it("ausentismo: tasa de no-show sobre las citas ya resueltas", async () => {
    const sillonId = (await prisma.sillon.findFirstOrThrow({ where: { consultorioId } })).id;
    const ayer = Date.now() - 20 * 3600e3;
    const estados = ["ATENDIDO", "ATENDIDO", "NO_ASISTIO", "CANCELADO"];
    for (const [i, estado] of estados.entries()) {
      await prisma.appointment.create({ data: { patientId: pid, profesionalId, sillonId, inicio: new Date(ayer + i * 3600e3), fin: new Date(ayer + i * 3600e3 + 1800e3), estado } });
    }
    const rep = await request(app).get(`/api/reportes/ausentismo?desde=${encodeURIComponent(new Date(ayer - 60e3).toISOString())}&hasta=${encodeURIComponent(new Date().toISOString())}`).set(bearer(admin));
    const fila = rep.body.filas.find((f: { profesional: string }) => f.profesional.includes(run));
    expect(fila.citas).toBe(4);
    expect(fila.noAsistio).toBe(1);
    expect(fila.tasaNoShowPct).toBe(25);
  });

  it("honorarios: resume lo liquidado", async () => {
    const rep = await request(app).get(`/api/reportes/honorarios?${rango()}`).set(bearer(auditor));
    expect(rep.body.filas.some((f: { profesional: string; total: number }) => f.profesional.includes(run) && f.total === 5250)).toBe(true);
    expect(rep.body.resumen.procedimientosSinLiquidar).toBeGreaterThanOrEqual(1);
  });
});
