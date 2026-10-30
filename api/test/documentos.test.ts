import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { totales } from "../src/routes/presupuestos.js";
import { loginFull } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pdfDe = (res: request.Response) => Buffer.from(res.body as Buffer).subarray(0, 4).toString();
const binario = (r: request.Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });

let odonto: string, asis: string, recep: string, maria: string, carlos: string, sofia: string;

beforeAll(async () => {
  odonto = (await loginFull(app, "odontologo@sigo.test")).token;
  asis = (await loginFull(app, "asistente@sigo.test")).token;
  recep = (await loginFull(app, "recepcion@sigo.test")).token;
  const id = async (cedula: string) => (await prisma.patient.findFirstOrThrow({ where: { cedula } })).id;
  [maria, carlos, sofia] = [await id("1710000001"), await id("1710000002"), await id("1710000003")];
});

describe("consentimiento informado (RF-06)", () => {
  const crear = (patientId: string, metodo: "FIRMA" | "OTP", t = odonto) => request(app).post("/api/consentimientos").set(bearer(t)).send({ patientId, metodo });

  it("firma con trazo en pantalla, genera el PDF y queda inmutable", async () => {
    const c = (await crear(carlos, "FIRMA")).body;
    expect(c.estado).toBe("PENDIENTE");
    expect((await request(app).get(`/api/consentimientos/${c.id}/pdf`).set(bearer(odonto))).status).toBe(404); // aún sin firmar

    expect((await request(app).post(`/api/consentimientos/${c.id}/firmar`).set(bearer(odonto)).send({ firma: "data:image/png;base64,AAAA" })).status).toBe(400);
    const ok = await request(app).post(`/api/consentimientos/${c.id}/firmar`).set(bearer(asis)).send({ firma: PNG_1X1 });
    expect(ok.status).toBe(200);
    expect(ok.body.estado).toBe("FIRMADO");
    expect(ok.body.firmanteNombre).toContain("Carlos");
    expect(ok.body.pdfHash).toHaveLength(64);

    const pdf = await binario(request(app).get(`/api/consentimientos/${c.id}/pdf`).set(bearer(odonto)));
    expect(pdfDe(pdf)).toBe("%PDF");
    expect((await request(app).post(`/api/consentimientos/${c.id}/firmar`).set(bearer(odonto)).send({ firma: PNG_1X1 })).status).toBe(409);
    await expect(prisma.consentimiento.update({ where: { id: c.id }, data: { titulo: "x" } })).rejects.toThrow();
    await expect(prisma.consentimiento.delete({ where: { id: c.id } })).rejects.toThrow();
  });

  it("firma con OTP; si el paciente es menor firma su tutor", async () => {
    const c = (await crear(sofia, "OTP")).body;
    expect(c.otpDemo).toMatch(/^\d{6}$/);
    expect(c.otpHash).toBeUndefined(); // el hash nunca sale del servidor
    const firmar = (otp: string) => request(app).post(`/api/consentimientos/${c.id}/firmar`).set(bearer(odonto)).send({ otp });
    expect((await firmar(c.otpDemo === "000000" ? "111111" : "000000")).status).toBe(401);
    const ok = await firmar(c.otpDemo);
    expect(ok.status).toBe(200);
    expect(ok.body.firmanteNombre).toContain("tutor legal");
  });

  it("un OTP vencido se rechaza", async () => {
    const c = (await crear(maria, "OTP")).body;
    await prisma.consentimiento.update({ where: { id: c.id }, data: { otpExpira: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`/api/consentimientos/${c.id}/firmar`).set(bearer(odonto)).send({ otp: c.otpDemo })).status).toBe(410);
  });

  it("usa la plantilla del procedimiento y la recepcionista no accede", async () => {
    const endo = await prisma.procedimiento.findUniqueOrThrow({ where: { codigo: "ENDO" } });
    const c = await request(app).post("/api/consentimientos").set(bearer(odonto)).send({ patientId: carlos, metodo: "FIRMA", procedimientoId: endo.id });
    expect(c.body.titulo).toContain("Endodoncia");
    expect((await crear(carlos, "FIRMA", recep)).status).toBe(403);
  });
});

describe("recetas en PDF", () => {
  const item = (medicamento: string) => ({ medicamento, dosis: "500 mg", frecuencia: "cada 8 horas", duracion: "5 días" });
  const emitir = (patientId: string, medicamento: string, extra: object = {}, t = odonto) =>
    request(app).post("/api/recetas").set(bearer(t)).send({ patientId, diagnostico: "Pulpitis", items: [item(medicamento)], ...extra });

  it("emite la receta y guarda el PDF", async () => {
    const r = await emitir(carlos, "Ibuprofeno");
    expect(r.status).toBe(201);
    const pdf = await binario(request(app).get(`/api/recetas/${r.body.id}/pdf`).set(bearer(odonto)));
    expect(pdfDe(pdf)).toBe("%PDF");
    await expect(prisma.receta.update({ where: { id: r.body.id }, data: { diagnostico: "x" } })).rejects.toThrow();
  });

  it("avisa si el medicamento coincide con una alergia y exige confirmar", async () => {
    const bloqueada = await emitir(maria, "Penicilina V");
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.body.code).toBe("ALERGIA");
    expect((await emitir(maria, "Penicilina V", { confirmarAlergia: true })).status).toBe(201);
    expect((await emitir(maria, "Ibuprofeno")).status).toBe(201);
  });

  it("solo el odontólogo receta", async () => {
    expect((await emitir(carlos, "Ibuprofeno", {}, asis)).status).toBe(403);
    expect((await emitir(carlos, "Ibuprofeno", {}, recep)).status).toBe(403);
  });
});

describe("presupuestos (RF-07, RF-08)", () => {
  it("calcula totales con laboratorio, descuento y prorrateo sin perder centavos", () => {
    const items = [
      { cantidad: 1, precioUnitario: 4500, costoLaboratorio: 2000, estado: "APROBADO", fase: 1, sesion: 1 },
      { cantidad: 2, precioUnitario: 3500, costoLaboratorio: 0, estado: "RECHAZADO", fase: 1, sesion: 2 },
      { cantidad: 1, precioUnitario: 12000, costoLaboratorio: 0, estado: "APROBADO", fase: 2, sesion: 1 },
    ];
    const t = totales(items, 1000);
    expect(t.subtotal).toBe(25500);
    expect(t.total).toBe(24500);
    expect(t.subtotalAprobado).toBe(18500);
    expect(t.totalAprobado).toBe(17775); // 18500 − round(1000 × 18500 / 25500)
    expect(t.porFase).toEqual({ "1": 13500, "2": 12000 });
  });

  describe("flujo completo", () => {
    let proc: Record<string, string>, pid: string, sillonId: string, profesionalId: string, pres: { id: string; items: { id: string; descripcion: string }[] };
    const base = Date.now() + 500 * 864e5;
    const hora = (h: number) => new Date(base + h * 3600e3).toISOString();

    beforeAll(async () => {
      proc = Object.fromEntries((await prisma.procedimiento.findMany()).map((p) => [p.codigo, p.id]));
      pid = (await request(app).post("/api/pacientes").set(bearer(recep)).send({
        cedula: `8${Date.now().toString().slice(-9)}`, nombres: "Pres", apellidos: "Supuesto", fechaNacimiento: "1985-01-01", sexo: "M", telefono: "0990000000",
        emergenciaNombre: "X", emergenciaTelefono: "0991111111", anamnesis: { alergias: [], anticoagulado: false, coagulopatia: false },
      })).body.id;
      profesionalId = (await prisma.profesional.findFirstOrThrow()).id;
      sillonId = (await prisma.consultorio.create({ data: { nombre: `Pres ${Date.now()}`, sillones: { create: [{ nombre: "P" }] } }, include: { sillones: true } })).sillones[0].id;
    });

    const crear = (body: object, t = odonto) => request(app).post("/api/presupuestos").set(bearer(t)).send(body);
    const items = () => [
      { fase: 1, sesion: 1, procedimientoId: proc.REST, diente: "16", costoLaboratorio: 2000, honorario: 2000 },
      { fase: 1, sesion: 2, procedimientoId: proc.PROF, cantidad: 2 },
      { fase: 2, sesion: 1, procedimientoId: proc.ENDO, diente: "26" },
    ];

    it("valida descuentos, honorarios y permisos", async () => {
      expect((await crear({ patientId: pid, items: items(), descuento: 99999999 })).status).toBe(400);
      expect((await crear({ patientId: pid, items: [{ ...items()[0], honorario: 999999 }] })).status).toBe(400);
      expect((await crear({ patientId: pid, items: items() }, recep)).status).toBe(403);
      expect((await crear({ patientId: pid, items: [{ ...items()[0], procedimientoId: "nope" }] })).status).toBe(404);
    });

    it("crea, presenta y aprueba parcialmente", async () => {
      const c = await crear({ patientId: pid, items: items(), descuento: 1000 });
      expect(c.status).toBe(201);
      expect(c.body.totales.subtotal).toBe(25500);
      expect(c.body.totales.total).toBe(24500);
      expect(c.body.autorizadoPorId).toBeTruthy();
      pres = c.body;

      const aprobar = (ids?: string[], t = recep) => request(app).post(`/api/presupuestos/${pres.id}/aprobar`).set(bearer(t)).send(ids ? { itemIds: ids } : {});
      expect((await aprobar()).status).toBe(409); // aún no se presentó al paciente
      expect((await request(app).post(`/api/presupuestos/${pres.id}/presentar`).set(bearer(recep))).status).toBe(403);
      expect((await request(app).post(`/api/presupuestos/${pres.id}/presentar`).set(bearer(odonto))).status).toBe(200);
      expect((await aprobar(["ajeno"])).status).toBe(400);
      expect((await aprobar(undefined, asis)).status).toBe(403);

      const ok = await aprobar([pres.items[0].id, pres.items[2].id]);
      expect(ok.status).toBe(200);
      expect(ok.body.estado).toBe("APROBADO_PARCIAL");
      expect(ok.body.totales.totalAprobado).toBe(17775);
      expect(ok.body.items.filter((i: { estado: string }) => i.estado === "RECHAZADO")).toHaveLength(1);
      expect((await aprobar()).status).toBe(409); // ya resuelto
    });

    it("los ítems aprobados se vuelven agendables y respetan la regla de sillón", async () => {
      const lista = await request(app).get(`/api/presupuestos/agendables?patientId=${pid}`).set(bearer(recep));
      expect(lista.body).toHaveLength(2);
      const [a, b] = lista.body as { id: string; descripcion: string }[];

      const agendar = (iid: string, inicio: string, fin: string) =>
        request(app).post(`/api/presupuestos/items/${iid}/agendar`).set(bearer(recep)).send({ profesionalId, sillonId, inicio, fin });
      const ok = await agendar(a.id, hora(9), hora(10));
      expect(ok.status).toBe(201);
      expect(ok.body.item.estado).toBe("AGENDADO");
      expect(ok.body.cita.motivo).toContain(a.descripcion);

      expect((await agendar(a.id, hora(11), hora(12))).status).toBe(409); // ya agendado
      const choque = await agendar(b.id, hora(9), hora(10));
      expect(choque.status).toBe(409); // sillón ocupado
      expect((await prisma.presupuestoItem.findUniqueOrThrow({ where: { id: b.id } })).estado).toBe("APROBADO"); // se revirtió
      expect((await agendar(b.id, hora(10), hora(11))).status).toBe(201);

      const rechazado = pres.items.find((i) => i.id !== a.id && i.id !== b.id)!;
      expect((await agendar(rechazado.id, hora(13), hora(14))).status).toBe(409);
    });
  });
});
