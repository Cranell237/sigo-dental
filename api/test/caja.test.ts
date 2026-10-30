import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { claveAcceso } from "../src/sri.js";
import { enviarRecordatorios } from "../src/recordatorios.js";
import { loginFull } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let recep: string, odonto: string, patientId: string, rest: string, prof: string;

beforeAll(async () => {
  recep = (await loginFull(app, "recepcion@sigo.test")).token;
  odonto = (await loginFull(app, "odontologo@sigo.test")).token;
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "recepcion@sigo.test" } });
  await prisma.cajaTurno.updateMany({ where: { userId: user.id, estado: "ABIERTA" }, data: { estado: "CERRADA" } });
  patientId = (await prisma.patient.findFirstOrThrow({ where: { cedula: "1710000001" } })).id;
  rest = (await prisma.procedimiento.findUniqueOrThrow({ where: { codigo: "REST" } })).id; // 4500
  prof = (await prisma.procedimiento.findUniqueOrThrow({ where: { codigo: "PROF" } })).id; // 3500
});

const cobrar = (pagos: object[], extra: object = {}) =>
  request(app)
    .post("/api/caja/cobros")
    .set(bearer(recep))
    .send({ patientId, lineas: [{ procedimientoId: rest, cantidad: 1 }, { procedimientoId: prof, cantidad: 1 }], pagos, ...extra });

describe("caja (RF-12, RN-02)", () => {
  it("no se cobra sin turno abierto", async () => {
    expect((await cobrar([{ metodo: "EFECTIVO", monto: 8000 }])).status).toBe(409);
  });

  it("abre el turno una sola vez y no expone totales mientras está abierto", async () => {
    const a = await request(app).post("/api/caja/apertura").set(bearer(recep)).send({ fondoInicial: 10000 });
    expect(a.status).toBe(201);
    expect((await request(app).post("/api/caja/apertura").set(bearer(recep)).send({ fondoInicial: 0 })).status).toBe(409);
    const t = await request(app).get("/api/caja/turno").set(bearer(recep));
    expect(t.body.totalTeorico).toBeUndefined();
    expect(t.body.diferencia).toBeUndefined();
  });

  it("cobra con pagos mixtos, calcula el total en el servidor y emite la factura", async () => {
    const res = await cobrar([{ metodo: "EFECTIVO", monto: 5000 }, { metodo: "TARJETA_CREDITO", monto: 3000, referencia: "AUT123" }]);
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(8000);
    expect(res.body.pagos).toHaveLength(2);
    expect(res.body.factura.estado).toBe("AUTORIZADO");
    expect(res.body.factura.claveAcceso).toMatch(/^\d{49}$/);

    const xml = await request(app).get(`/api/caja/cobros/${res.body.id}/factura.xml`).set(bearer(recep));
    expect(xml.headers["content-type"]).toContain("xml");
    expect(xml.text).toContain("<importeTotal>80.00</importeTotal>");
    expect(xml.text).toContain("<identificacionComprador>1710000001</identificacionComprador>");
    expect(xml.text).toContain(`<claveAcceso>${res.body.factura.claveAcceso}</claveAcceso>`);
  });

  it("rechaza pagos que no suman el total al centavo", async () => {
    expect((await cobrar([{ metodo: "EFECTIVO", monto: 7999 }])).status).toBe(400);
    expect((await cobrar([{ metodo: "EFECTIVO", monto: 8001 }])).status).toBe(400);
  });

  it("cobros concurrentes obtienen secuenciales distintos", async () => {
    const res = await Promise.all(Array.from({ length: 4 }, () => cobrar([{ metodo: "TRANSFERENCIA", monto: 8000 }])));
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(new Set(res.map((r) => r.body.factura.secuencial)).size).toBe(4);
  });

  it("solo la recepción opera la caja", async () => {
    expect((await request(app).get("/api/caja/turno").set(bearer(odonto))).status).toBe(403);
  });

  it("el cierre ciego exige el conteo y revela el teórico solo después", async () => {
    expect((await request(app).post("/api/caja/cierre").set(bearer(recep)).send({})).status).toBe(400);
    // teórico = fondo 10000 + efectivo 5000 (los demás cobros fueron por transferencia)
    const c = await request(app).post("/api/caja/cierre").set(bearer(recep)).send({ conteoEfectivo: 14900 });
    expect(c.status).toBe(200);
    expect(c.body.totalTeorico).toBe(15000);
    expect(c.body.diferencia).toBe(-100);
    expect((await request(app).get("/api/caja/turno").set(bearer(recep))).body).toBeNull();
  });
});

describe("clave de acceso del SRI", () => {
  it("tiene 49 dígitos y un dígito verificador módulo 11 correcto", () => {
    const k = claveAcceso(new Date(2026, 9, 30), 42);
    expect(k).toMatch(/^\d{49}$/);
    const body = k.slice(0, 48);
    let f = 2, sum = 0;
    for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * f; f = f === 7 ? 2 : f + 1; }
    const dv = 11 - (sum % 11);
    expect(Number(k[48])).toBe(dv === 11 ? 0 : dv === 10 ? 1 : dv);
  });
});

describe("recordatorios (RF-11)", () => {
  it("envía el de 48 h y el de 24 h una sola vez por cita", async () => {
    const profesional = await prisma.profesional.findFirstOrThrow();
    const c = await prisma.consultorio.create({ data: { nombre: `Rec ${Date.now()}`, sillones: { create: [{ nombre: "R" }] } }, include: { sillones: true } });
    const ahora = Date.now();
    const mk = (horas: number) =>
      prisma.appointment.create({
        data: { patientId, profesionalId: profesional.id, sillonId: c.sillones[0].id, inicio: new Date(ahora + horas * 3600e3), fin: new Date(ahora + (horas + 0.5) * 3600e3) },
      });
    const [lejana, a48, a24] = [await mk(100), await mk(40), await mk(10)];

    const r1 = await enviarRecordatorios();
    expect(r1.enviados).toBeGreaterThanOrEqual(2);
    const filas = await prisma.recordatorio.findMany({ where: { appointmentId: { in: [lejana.id, a48.id, a24.id] } } });
    expect(filas.find((f) => f.appointmentId === a48.id)?.tipo).toBe("48H");
    expect(filas.find((f) => f.appointmentId === a24.id)?.tipo).toBe("24H");
    expect(filas.some((f) => f.appointmentId === lejana.id)).toBe(false);

    const r2 = await enviarRecordatorios(); // idempotente
    expect(await prisma.recordatorio.count({ where: { appointmentId: { in: [a48.id, a24.id] } } })).toBe(2);
    expect(r2.enviados).toBe(0);

    // a las 24 h de la cita de 40 h se manda el segundo recordatorio
    await enviarRecordatorios(new Date(ahora + 20 * 3600e3));
    const tipos = (await prisma.recordatorio.findMany({ where: { appointmentId: a48.id } })).map((f) => f.tipo).sort();
    expect(tipos).toEqual(["24H", "48H"]);
  });
});
