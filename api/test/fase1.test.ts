import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { loginFull } from "./helpers.js";

const app = createApp();
const run = Date.now().toString().slice(-8); // evita choques de cédula entre corridas
let n = 0;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const SIN_ANTECEDENTES = { alergias: [], anticoagulado: false, coagulopatia: false };
const paciente = (extra: object = {}, anamnesis: object | null = SIN_ANTECEDENTES) => ({
  cedula: `9${run}${n++}`,
  nombres: "Prueba",
  apellidos: "Paciente",
  fechaNacimiento: "1990-05-10",
  sexo: "F",
  telefono: "0990000000",
  emergenciaNombre: "Contacto",
  emergenciaTelefono: "0991111111",
  ...(anamnesis ? { anamnesis } : {}),
  ...extra,
});

let recep: string, odonto: string, admin: string;
beforeAll(async () => {
  recep = (await loginFull(app, "recepcion@sigo.test")).token;
  odonto = (await loginFull(app, "odontologo@sigo.test")).token;
  admin = (await loginFull(app, "admin@sigo.test")).token;
});

describe("pacientes (RF-01, RF-02)", () => {
  it("crea un adulto con anamnesis", async () => {
    const res = await request(app).post("/api/pacientes").set(bearer(recep)).send(paciente());
    expect(res.status).toBe(201);
    expect(res.body.esMenor).toBe(false);
  });

  it("la anamnesis es obligatoria", async () => {
    const res = await request(app).post("/api/pacientes").set(bearer(recep)).send(paciente({}, null));
    expect(res.status).toBe(400);
    const vacia = await request(app).post("/api/pacientes").set(bearer(recep)).send(paciente({}, {}));
    expect(vacia.status).toBe(400);
  });

  it("un menor exige tutor legal", async () => {
    const menor = { fechaNacimiento: new Date(Date.now() - 8 * 365 * 864e5).toISOString().slice(0, 10) };
    const sin = await request(app).post("/api/pacientes").set(bearer(recep)).send(paciente(menor));
    expect(sin.status).toBe(400);
    const con = await request(app)
      .post("/api/pacientes")
      .set(bearer(recep))
      .send(paciente({ ...menor, tutorNombre: "Padre", tutorCedula: "1700000000", tutorTelefono: "0990000001" }));
    expect(con.status).toBe(201);
    expect(con.body.esMenor).toBe(true);
  });

  it("rechaza una cédula duplicada", async () => {
    const p = paciente();
    await request(app).post("/api/pacientes").set(bearer(recep)).send(p);
    expect((await request(app).post("/api/pacientes").set(bearer(recep)).send(p)).status).toBe(409);
  });

  it("muestra alertas críticas a todos y el detalle clínico solo al personal clínico, con observaciones cifradas", async () => {
    const p = paciente({}, { alergias: ["Penicilina"], anticoagulado: true, coagulopatia: false, observaciones: "Diabético tipo 2" });
    const created = await request(app).post("/api/pacientes").set(bearer(recep)).send(p);
    const id = created.body.id;
    expect(created.body.alertas).toEqual(["Alergia: Penicilina", "Anticoagulado"]);
    expect(created.body.anamnesis).toBeUndefined(); // la recepcionista no ve el detalle

    const clinico = await request(app).get(`/api/pacientes/${id}`).set(bearer(odonto));
    expect(clinico.body.anamnesis.observaciones).toBe("Diabético tipo 2");

    const raw = await prisma.anamnesis.findUniqueOrThrow({ where: { patientId: id } });
    expect(raw.observaciones).not.toContain("Diabético");
  });

  it("busca por cédula y nombre", async () => {
    const p = paciente({ apellidos: "Zzbuscable" });
    await request(app).post("/api/pacientes").set(bearer(recep)).send(p);
    const byName = await request(app).get("/api/pacientes?q=Zzbuscable").set(bearer(recep));
    const byCedula = await request(app).get(`/api/pacientes?q=${p.cedula}`).set(bearer(recep));
    expect(byName.body.length).toBeGreaterThan(0);
    expect(byCedula.body[0].cedula).toBe(p.cedula);
  });

  it("la auditora no puede leer pacientes", async () => {
    const aud = (await loginFull(app, "auditor@sigo.test")).token;
    expect((await request(app).get("/api/pacientes").set(bearer(aud))).status).toBe(403);
  });
});

describe("catálogos (1.3)", () => {
  it("solo el admin los modifica", async () => {
    const nombre = `Consultorio ${run}`;
    expect((await request(app).post("/api/catalogos/consultorios").set(bearer(odonto)).send({ nombre })).status).toBe(403);
    expect((await request(app).post("/api/catalogos/consultorios").set(bearer(admin)).send({ nombre })).status).toBe(201);
    expect((await request(app).get("/api/catalogos/procedimientos").set(bearer(odonto))).body.length).toBeGreaterThan(0);
  });
});

describe("agenda (RF-09, RF-10, RN-03)", () => {
  let patientId: string, profesionalId: string, sillonId: string, otroSillonId: string;
  const base = Date.now() + 400 * 864e5; // lejos en el futuro
  const hora = (h: number, m = 0) => new Date(base + (h * 60 + m) * 60e3).toISOString();

  beforeAll(async () => {
    const p = await request(app).post("/api/pacientes").set(bearer(recep)).send(paciente());
    patientId = p.body.id;
    profesionalId = (await prisma.profesional.findFirstOrThrow()).id;
    const c = await prisma.consultorio.create({ data: { nombre: `Agenda ${run}`, sillones: { create: [{ nombre: "A" }, { nombre: "B" }] } }, include: { sillones: true } });
    [sillonId, otroSillonId] = c.sillones.map((s) => s.id);
  });

  const crear = (inicio: string, fin: string, sId = sillonId) =>
    request(app).post("/api/citas").set(bearer(recep)).send({ patientId, profesionalId, sillonId: sId, inicio, fin });

  it("rechaza la cita que se solapa en el mismo sillón, aunque cambie el odontólogo", async () => {
    expect((await crear(hora(9), hora(10))).status).toBe(201);
    expect((await crear(hora(9, 30), hora(10, 30))).status).toBe(409);
    expect((await crear(hora(8), hora(9, 1))).status).toBe(409);
  });

  it("permite citas contiguas y el mismo horario en otro sillón", async () => {
    expect((await crear(hora(10), hora(11))).status).toBe(201);
    expect((await crear(hora(9), hora(10), otroSillonId)).status).toBe(201);
  });

  it("una cita cancelada libera el sillón", async () => {
    const c = await crear(hora(12), hora(13));
    await request(app).patch(`/api/citas/${c.body.id}/estado`).set(bearer(recep)).send({ estado: "CANCELADO" });
    expect((await crear(hora(12), hora(13))).status).toBe(201);
  });

  it("con peticiones concurrentes solo una gana el horario", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => crear(hora(15), hora(16))));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(await prisma.appointment.count({ where: { sillonId, inicio: new Date(hora(15)) } })).toBe(1);
  });

  it("valida la máquina de estados", async () => {
    const c = await crear(hora(18), hora(19));
    const set = (estado: string) => request(app).patch(`/api/citas/${c.body.id}/estado`).set(bearer(odonto)).send({ estado });
    expect((await set("ATENDIDO")).status).toBe(409); // no se puede saltar pasos
    for (const e of ["CONFIRMADO", "EN_SALA_ESPERA", "EN_ATENCION", "ATENDIDO"]) expect((await set(e)).status).toBe(200);
    expect((await set("PROGRAMADO")).status).toBe(409); // de Atendido no se vuelve a Programado
  });

  it("filtra por día y sillón", async () => {
    const res = await request(app)
      .get(`/api/citas?desde=${encodeURIComponent(hora(0))}&hasta=${encodeURIComponent(hora(24))}&sillonId=${otroSillonId}`)
      .set(bearer(recep));
    expect(res.body).toHaveLength(1);
  });

  it("la asistente ve la agenda pero no la modifica", async () => {
    const asis = (await loginFull(app, "asistente@sigo.test")).token;
    const q = `desde=${encodeURIComponent(hora(0))}&hasta=${encodeURIComponent(hora(24))}`;
    expect((await request(app).get(`/api/citas?${q}`).set(bearer(asis))).status).toBe(200);
    const res = await request(app).post("/api/citas").set(bearer(asis)).send({ patientId, profesionalId, sillonId, inicio: hora(20), fin: hora(21) });
    expect(res.status).toBe(403);
  });
});
