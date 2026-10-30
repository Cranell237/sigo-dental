import { Router } from "express";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { config } from "../config.js";
import { crearPdf, encabezado } from "../pdf.js";
import { canales } from "../recordatorios.js";
import { storage } from "../storage.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// RF-06: consentimiento informado digital, firmado con trazo en pantalla o con un código OTP.
export const consentimientosRouter = Router();
consentimientosRouter.use(authenticate, auditAccess("consentimientos"));

const leer = requirePermission("clinico:leer");
const escribir = requirePermission("clinico:escribir");

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const OTP_MINUTOS = 10;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

consentimientosRouter.get("/plantillas", leer, async (_req, res) => {
  res.json(await prisma.consentimientoPlantilla.findMany({ orderBy: { titulo: "asc" } }));
});

const publico = (c: { otpHash: string | null; otpExpira: Date | null } & Record<string, unknown>) => {
  const { otpHash: _h, otpExpira: _e, ...resto } = c;
  return resto;
};

consentimientosRouter.get("/", leer, async (req, res) => {
  const patientId = z.string().safeParse(req.query.patientId);
  if (!patientId.success) return res.status(400).json({ error: "Indica patientId" });
  const filas = await prisma.consentimiento.findMany({ where: { patientId: patientId.data }, orderBy: { createdAt: "desc" } });
  res.json(filas.map(publico));
});

const crearSchema = z.object({ patientId: z.string(), procedimientoId: z.string().optional(), metodo: z.enum(["FIRMA", "OTP"]) });

consentimientosRouter.post("/", escribir, async (req, res) => {
  const p = crearSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  const paciente = await prisma.patient.findUnique({ where: { id: p.data.patientId } });
  if (!paciente) return res.status(404).json({ error: "Paciente no encontrado" });

  const plantilla =
    (p.data.procedimientoId && (await prisma.consentimientoPlantilla.findFirst({ where: { procedimientoId: p.data.procedimientoId } }))) ||
    (await prisma.consentimientoPlantilla.findFirst({ where: { procedimientoId: null } }));
  if (!plantilla) return res.status(404).json({ error: "No hay plantilla de consentimiento para este procedimiento" });

  const otp = p.data.metodo === "OTP" ? String(randomInt(100000, 1000000)) : null;
  const creado = await prisma.consentimiento.create({
    data: {
      patientId: paciente.id,
      titulo: plantilla.titulo,
      texto: plantilla.texto,
      metodo: p.data.metodo,
      creadoPorId: req.user!.id,
      otpHash: otp && sha256(otp),
      otpExpira: otp ? new Date(Date.now() + OTP_MINUTOS * 60e3) : null,
    },
  });

  if (otp) {
    // El código se envía al paciente (o a su tutor si es menor) por un canal simulado.
    const destino = paciente.tutorTelefono ?? paciente.telefono;
    await canales.SMS.enviar(destino, `SIGO-Dental: tu código para firmar el consentimiento es ${otp} (vale ${OTP_MINUTOS} min).`);
  }
  res.status(201).json({ ...publico(creado), ...(otp && config.demoMode ? { otpDemo: otp } : {}) });
});

const firmarSchema = z.object({ firma: z.string().max(700_000).optional(), otp: z.string().length(6).optional() });

consentimientosRouter.post("/:id/firmar", escribir, async (req, res) => {
  const p = firmarSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  const c = await prisma.consentimiento.findUnique({ where: { id: String(req.params.id) } });
  if (!c) return res.status(404).json({ error: "Consentimiento no encontrado" });
  if (c.estado === "FIRMADO") return res.status(409).json({ error: "El consentimiento ya está firmado" });
  const paciente = await prisma.patient.findUniqueOrThrow({ where: { id: c.patientId } });

  let imagen: Buffer | null = null;
  if (c.metodo === "FIRMA") {
    const m = p.data.firma?.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    imagen = m ? Buffer.from(m[1], "base64") : null;
    if (!imagen || !imagen.subarray(0, 4).equals(PNG)) return res.status(400).json({ error: "Falta la firma (imagen PNG del trazo)" });
  } else {
    if (!p.data.otp || !c.otpHash || !c.otpExpira) return res.status(400).json({ error: "Ingresa el código OTP" });
    if (c.otpExpira < new Date()) return res.status(410).json({ error: "El código OTP venció: genera un nuevo consentimiento" });
    if (sha256(p.data.otp) !== c.otpHash) return res.status(401).json({ error: "Código OTP incorrecto" });
  }

  // Si el paciente es menor, firma el tutor legal.
  const menor = !!paciente.tutorNombre;
  const firmante = menor ? `${paciente.tutorNombre} (tutor legal)` : `${paciente.nombres} ${paciente.apellidos}`;
  const ahora = new Date();

  const pdf = await crearPdf((doc) => {
    encabezado(doc, c.titulo);
    doc.text(`Paciente: ${paciente.nombres} ${paciente.apellidos}   Cédula: ${paciente.cedula}`);
    doc.text(`Fecha: ${ahora.toLocaleString("es-EC")}`).moveDown();
    doc.text(c.texto, { align: "justify" }).moveDown(2);
    doc.text(`Firmante: ${firmante}`);
    if (imagen) {
      doc.moveDown(0.5).image(imagen, { fit: [220, 90] });
      doc.fontSize(9).fillColor("#475569").text("Firma manuscrita capturada en pantalla");
    } else {
      doc.moveDown(0.5).fontSize(10).fillColor("#475569").text(`Firmado con código de un solo uso (OTP) enviado al ${menor ? "tutor" : "paciente"}.`);
    }
    doc.moveDown().fontSize(8).fillColor("#64748b").text(`Sello de integridad: ${sha256(`${c.id}|${c.texto}|${paciente.cedula}|${ahora.toISOString()}`)}`);
  });
  const pdfPath = `consentimientos/${c.id}.pdf`;
  await storage.save(pdfPath, pdf);

  const firmado = await prisma.consentimiento.update({
    where: { id: c.id },
    data: { estado: "FIRMADO", firmadoAt: ahora, firmanteNombre: firmante, pdfPath, pdfHash: sha256(pdf), otpHash: null, otpExpira: null },
  });
  res.json(publico(firmado));
});

consentimientosRouter.get("/:id/pdf", leer, async (req, res) => {
  const c = await prisma.consentimiento.findUnique({ where: { id: String(req.params.id) } });
  if (!c?.pdfPath) return res.status(404).json({ error: "El consentimiento aún no está firmado" });
  res.type("application/pdf").send(await storage.read(c.pdfPath));
});
