import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { DIENTES, PERMANENTES, TEMPORALES, fdiAUniversal } from "../src/dental.js";
import { loginFull } from "./helpers.js";

const app = createApp();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let odonto: string, asis: string, recep: string, auditor: string, pid: string, base: string;

beforeAll(async () => {
  odonto = (await loginFull(app, "odontologo@sigo.test")).token;
  asis = (await loginFull(app, "asistente@sigo.test")).token;
  recep = (await loginFull(app, "recepcion@sigo.test")).token;
  auditor = (await loginFull(app, "auditor@sigo.test")).token;
  pid = (await prisma.patient.findFirstOrThrow({ where: { cedula: "1710000002" } })).id;
  base = `/api/clinico/pacientes/${pid}`;
});

describe("dentición y nomenclatura (RF-03)", () => {
  it("tiene 32 dientes permanentes y 20 temporales", () => {
    expect(PERMANENTES).toHaveLength(32);
    expect(TEMPORALES).toHaveLength(20);
    expect(DIENTES.size).toBe(52);
    expect(PERMANENTES[0]).toBe("11");
    expect(PERMANENTES).not.toContain("19");
    expect(PERMANENTES).toContain("48");
    expect(TEMPORALES).toContain("85");
    expect(TEMPORALES).not.toContain("56");
  });

  it("convierte FDI a Universal", () => {
    const esperado: Record<string, string> = {
      "18": "1", "11": "8", "21": "9", "28": "16", "38": "17", "31": "24", "41": "25", "48": "32",
      "55": "A", "51": "E", "61": "F", "65": "J", "75": "K", "71": "O", "81": "P", "85": "T",
    };
    for (const [fdi, uni] of Object.entries(esperado)) expect(fdiAUniversal(fdi)).toBe(uni);
    expect(new Set(PERMANENTES.map(fdiAUniversal)).size).toBe(32); // sin colisiones
    expect(new Set(TEMPORALES.map(fdiAUniversal)).size).toBe(20);
  });
});

describe("odontograma y RN-01", () => {
  const crear = (body: object, t = odonto) => request(app).post(`${base}/hallazgos`).set(bearer(t)).send(body);

  it("valida diente y superficie", async () => {
    expect((await crear({ diente: "19", tipo: "ENDODONCIA", estado: "REQUERIDO" })).status).toBe(400);
    expect((await crear({ diente: "16", tipo: "CARIES", estado: "EXISTENTE" })).status).toBe(400); // exige superficie
    expect((await crear({ diente: "16", tipo: "ENDODONCIA", superficie: "O", estado: "EXISTENTE" })).status).toBe(400); // diente completo
    expect((await crear({ diente: "16", tipo: "CARIES", superficie: "O", estado: "EXISTENTE" })).status).toBe(201);
    expect((await crear({ diente: "55", tipo: "SELLANTE", superficie: "V", estado: "REQUERIDO" })).status).toBe(201); // temporal
  });

  it("solo el personal clínico accede", async () => {
    expect((await crear({ diente: "16", tipo: "AUSENTE", estado: "EXISTENTE" }, recep)).status).toBe(403);
    expect((await request(app).get(`${base}/odontograma`).set(bearer(auditor))).status).toBe(403);
    expect((await request(app).get(`${base}/odontograma`).set(bearer(asis))).status).toBe(200);
  });

  it("un procedimiento realizado no se modifica ni se borra; se corrige con adenda firmada", async () => {
    const h = (await crear({ diente: "26", tipo: "ENDODONCIA", estado: "REQUERIDO" })).body;
    expect((await request(app).post(`${base}/hallazgos/${h.id}/realizar`).set(bearer(asis))).status).toBe(403); // no firma
    expect((await request(app).post(`${base}/hallazgos/${h.id}/realizar`).set(bearer(odonto))).status).toBe(200);

    expect((await request(app).patch(`${base}/hallazgos/${h.id}`).set(bearer(odonto)).send({ nota: "x" })).status).toBe(409);
    expect((await request(app).delete(`${base}/hallazgos/${h.id}`).set(bearer(odonto))).status).toBe(409);
    // incluso saltándose la API, la base de datos lo impide
    await expect(prisma.hallazgo.delete({ where: { id: h.id } })).rejects.toThrow();
    await expect(prisma.hallazgo.update({ where: { id: h.id }, data: { nota: "x" } })).rejects.toThrow();

    const adenda = (pw: string, who = odonto) => request(app).post(`${base}/hallazgos/${h.id}/adenda`).set(bearer(who)).send({ texto: "Era el diente 27, no el 26", password: pw });
    expect((await adenda("incorrecta")).status).toBe(401);
    expect((await adenda("Demo1234!", asis)).status).toBe(403);
    expect((await adenda("Demo1234!")).status).toBe(201);
    const raw = await prisma.adenda.findFirstOrThrow({ where: { hallazgoId: h.id } });
    expect(raw.texto).not.toContain("diente 27");
    expect(raw.firmaHash).toHaveLength(64);
    const odo = await request(app).get(`${base}/odontograma`).set(bearer(odonto));
    expect(odo.body.hallazgos.find((x: { id: string }) => x.id === h.id).adendas).toHaveLength(1);
  });

  it("un hallazgo no realizado sí puede borrarse", async () => {
    const h = (await crear({ diente: "36", tipo: "EXODONCIA", estado: "REQUERIDO" })).body;
    expect((await request(app).delete(`${base}/hallazgos/${h.id}`).set(bearer(odonto))).status).toBe(204);
  });

  it("registra el acceso en la auditoría con la ruta del recurso", async () => {
    await request(app).get(`${base}/odontograma`).set(bearer(odonto));
    await new Promise((r) => setTimeout(r, 200));
    const fila = await prisma.auditLog.findFirst({ where: { resource: "clinico", resourceId: { contains: pid } }, orderBy: { id: "desc" } });
    expect(fila?.action).toBe("READ");
  });
});

describe("periodontograma (RF-04)", () => {
  const sitios = (prof: number, margen: number, sangrado = false) =>
    ["DV", "V", "MV", "DL", "L", "ML"].map((punto) => ({ punto, profundidad: prof, margen, sangrado }));

  it("calcula el NIC y guarda furca, movilidad y sangrado", async () => {
    const res = await request(app)
      .post(`${base}/periodontograma`)
      .set(bearer(odonto))
      .send({ dientes: [{ diente: "16", puntos: sitios(4, 2, true), furca: 1, movilidad: 2 }] });
    expect(res.status).toBe(201);
    const d = res.body.dientes[0];
    expect(d.puntos.every((p: { nic: number }) => p.nic === 6)).toBe(true);
    expect(d.furca).toBe(1);
    expect(d.movilidad).toBe(2);
    expect(d.puntos[0].sangrado).toBe(true);
  });

  it("exige los 6 sitios y valores válidos", async () => {
    const mal = (puntos: object[]) => request(app).post(`${base}/periodontograma`).set(bearer(odonto)).send({ dientes: [{ diente: "16", puntos, furca: 0, movilidad: 0 }] });
    expect((await mal(sitios(3, 0).slice(0, 5))).status).toBe(400);
    expect((await mal(sitios(30, 0))).status).toBe(400);
    expect((await mal([...sitios(3, 0).slice(0, 5), { punto: "DV", profundidad: 3, margen: 0, sangrado: false }])).status).toBe(400); // sitio repetido
  });

  it("los exámenes no se editan ni se borran", async () => {
    const e = (await request(app).get(`${base}/periodontograma`).set(bearer(odonto))).body[0];
    await expect(prisma.perioDiente.update({ where: { id: e.dientes[0].id }, data: { furca: 3 } })).rejects.toThrow();
    await expect(prisma.perioDiente.delete({ where: { id: e.dientes[0].id } })).rejects.toThrow();
  });
});

describe("notas SOEP (RF-05)", () => {
  const soep = { subjetivo: "Dolor al masticar", objetivo: "Caries profunda en 16", evaluacion: "Pulpitis irreversible", plan: "Endodoncia" };
  const nueva = async () => (await request(app).post(`${base}/notas`).set(bearer(asis)).send(soep)).body;

  it("exige los cuatro campos y guarda el contenido cifrado", async () => {
    expect((await request(app).post(`${base}/notas`).set(bearer(asis)).send({ ...soep, plan: "" })).status).toBe(400);
    const n = await nueva();
    expect(n.subjetivo).toBe("Dolor al masticar");
    const raw = await prisma.notaSoep.findUniqueOrThrow({ where: { id: n.id } });
    expect(raw.subjetivo).not.toContain("Dolor");
    expect(raw.plan).not.toContain("Endodoncia");
  });

  it("el autor edita mientras no esté firmada y vigente el plazo", async () => {
    const n = await nueva();
    expect((await request(app).patch(`${base}/notas/${n.id}`).set(bearer(odonto)).send({ plan: "otro" })).status).toBe(403);
    const ok = await request(app).patch(`${base}/notas/${n.id}`).set(bearer(asis)).send({ plan: "Control en 7 días" });
    expect(ok.status).toBe(200);
    expect(ok.body.plan).toBe("Control en 7 días");
  });

  it("la firma exige re-autenticación y deja la nota inmutable", async () => {
    const n = await nueva();
    const firmar = (pw: string, t = odonto) => request(app).post(`${base}/notas/${n.id}/firmar`).set(bearer(t)).send({ password: pw });
    expect((await firmar("Demo1234!", asis)).status).toBe(403); // el asistente no firma
    expect((await firmar("mala")).status).toBe(401);
    const f = await firmar("Demo1234!");
    expect(f.status).toBe(200);
    expect(f.body.firmada).toBe(true);
    expect((await firmar("Demo1234!")).status).toBe(409);
    expect((await request(app).patch(`${base}/notas/${n.id}`).set(bearer(asis)).send({ plan: "x" })).status).toBe(409);
    await expect(prisma.notaSoep.update({ where: { id: n.id }, data: { plan: "x" } })).rejects.toThrow(); // trigger
    await expect(prisma.notaSoep.delete({ where: { id: n.id } })).rejects.toThrow();
  });

  it("vencido el plazo (24 h) la nota se bloquea y solo admite adenda firmada", async () => {
    const n = await nueva();
    const adenda = () => request(app).post(`${base}/notas/${n.id}/adenda`).set(bearer(odonto)).send({ texto: "Se aclara la dosis indicada", password: "Demo1234!" });
    expect((await adenda()).status).toBe(409); // todavía editable: se corrige directamente

    await prisma.notaSoep.update({ where: { id: n.id }, data: { createdAt: new Date(Date.now() - 25 * 3600e3) } });
    const edit = await request(app).patch(`${base}/notas/${n.id}`).set(bearer(asis)).send({ plan: "tarde" });
    expect(edit.status).toBe(409);
    expect((await adenda()).status).toBe(201);

    const lista = await request(app).get(`${base}/notas`).set(bearer(odonto));
    const vista = lista.body.find((x: { id: string }) => x.id === n.id);
    expect(vista.bloqueada).toBe(true);
    expect(vista.adendas[0].texto).toBe("Se aclara la dosis indicada");
  });

  it("la recepcionista no lee las notas", async () => {
    expect((await request(app).get(`${base}/notas`).set(bearer(recep))).status).toBe(403);
  });
});
