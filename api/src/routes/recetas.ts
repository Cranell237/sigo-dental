import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { crearPdf, encabezado } from "../pdf.js";
import { storage } from "../storage.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// Recetas odontológicas en PDF. Solo el odontólogo las emite; una vez emitidas no se modifican.
export const recetasRouter = Router();
recetasRouter.use(authenticate, auditAccess("recetas"));

const itemSchema = z.object({
  medicamento: z.string().trim().min(2),
  dosis: z.string().trim().min(1),
  frecuencia: z.string().trim().min(1),
  duracion: z.string().trim().min(1),
  indicaciones: z.string().trim().optional(),
});

const recetaSchema = z.object({
  patientId: z.string(),
  diagnostico: z.string().trim().optional(),
  items: z.array(itemSchema).min(1),
  confirmarAlergia: z.boolean().default(false),
});

const normaliza = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

recetasRouter.post("/", requirePermission("clinico:firmar"), async (req, res) => {
  const p = recetaSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const paciente = await prisma.patient.findUnique({ where: { id: p.data.patientId }, include: { anamnesis: true } });
  if (!paciente) return res.status(404).json({ error: "Paciente no encontrado" });

  // Seguridad del paciente: se avisa si un medicamento coincide con una alergia registrada.
  const alergias: string[] = paciente.anamnesis ? JSON.parse(paciente.anamnesis.alergias) : [];
  const conflictos = p.data.items
    .map((i) => i.medicamento)
    .filter((m) => alergias.some((a) => normaliza(m).includes(normaliza(a)) || normaliza(a).includes(normaliza(m))));
  if (conflictos.length && !p.data.confirmarAlergia) {
    return res.status(409).json({ error: `Alergia registrada: ${conflictos.join(", ")}. Confirma explícitamente para recetar.`, code: "ALERGIA", conflictos });
  }

  const autor = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const ahora = new Date();
  const pdf = await crearPdf((doc) => {
    encabezado(doc, "Receta odontológica");
    doc.text(`Paciente: ${paciente.nombres} ${paciente.apellidos}   Cédula: ${paciente.cedula}`);
    doc.text(`Fecha: ${ahora.toLocaleString("es-EC")}`);
    if (p.data.diagnostico) doc.text(`Diagnóstico: ${p.data.diagnostico}`);
    doc.moveDown();
    p.data.items.forEach((i, n) => {
      doc.fontSize(12).fillColor("#111827").text(`${n + 1}. ${i.medicamento}`, { continued: false });
      doc.fontSize(10).fillColor("#334155").text(`Dosis: ${i.dosis} · Frecuencia: ${i.frecuencia} · Duración: ${i.duracion}`);
      if (i.indicaciones) doc.text(`Indicaciones: ${i.indicaciones}`);
      doc.moveDown(0.6);
    });
    if (conflictos.length) doc.fillColor("#b91c1c").text(`Nota: se prescribió pese a la alergia registrada (${conflictos.join(", ")}), con confirmación del profesional.`);
    doc.moveDown(3).fillColor("#111827").fontSize(10).text("______________________________").text(autor.name);
  });

  // El id se fija antes de guardar: la receta es inmutable (trigger), así que no hay segunda escritura.
  const id = randomUUID();
  const pdfPath = `recetas/${id}.pdf`;
  await storage.save(pdfPath, pdf);
  const receta = await prisma.receta.create({
    data: { id, patientId: paciente.id, autorId: autor.id, diagnostico: p.data.diagnostico, items: JSON.stringify(p.data.items), pdfPath },
  });
  res.status(201).json({ ...receta, items: p.data.items });
});

recetasRouter.get("/", requirePermission("clinico:leer"), async (req, res) => {
  const patientId = z.string().safeParse(req.query.patientId);
  if (!patientId.success) return res.status(400).json({ error: "Indica patientId" });
  const filas = await prisma.receta.findMany({ where: { patientId: patientId.data }, orderBy: { createdAt: "desc" } });
  res.json(filas.map((r) => ({ ...r, items: JSON.parse(r.items) })));
});

recetasRouter.get("/:id/pdf", requirePermission("clinico:leer"), async (req, res) => {
  const r = await prisma.receta.findUnique({ where: { id: String(req.params.id) } });
  if (!r) return res.status(404).json({ error: "Receta no encontrada" });
  res.type("application/pdf").send(await storage.read(r.pdfPath));
});
