import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { pasarela } from "../pasarela.js";
import { buildFacturaXml, claveAcceso, sri } from "../sri.js";

export const cajaRouter = Router();
cajaRouter.use(authenticate, requirePermission("caja:gestionar"), auditAccess("caja"));

const METODOS = ["EFECTIVO", "TARJETA_CREDITO", "TARJETA_DEBITO", "TRANSFERENCIA", "SEGURO", "PASARELA"] as const;

class Regla extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

const turnoAbierto = (userId: string) => prisma.cajaTurno.findFirst({ where: { userId, estado: "ABIERTA" } });

// RN-02: mientras el turno está abierto no se expone ningún total acumulado ni el efectivo teórico.
const turnoPublico = (t: { id: string; estado: string; fondoInicial: number; abiertaAt: Date; cerradaAt: Date | null; conteoEfectivo: number | null; totalTeorico: number | null; diferencia: number | null }) =>
  t.estado === "ABIERTA"
    ? { id: t.id, estado: t.estado, fondoInicial: t.fondoInicial, abiertaAt: t.abiertaAt }
    : { ...t };

cajaRouter.post("/apertura", async (req, res) => {
  const p = z.object({ fondoInicial: z.number().int().nonnegative() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "El fondo inicial debe ser un entero en centavos" });
  if (await turnoAbierto(req.user!.id)) return res.status(409).json({ error: "Ya tienes un turno de caja abierto" });
  const t = await prisma.cajaTurno.create({ data: { userId: req.user!.id, fondoInicial: p.data.fondoInicial } });
  res.status(201).json(turnoPublico(t));
});

cajaRouter.get("/turno", async (req, res) => {
  const t = await turnoAbierto(req.user!.id);
  res.json(t ? turnoPublico(t) : null);
});

const cobroSchema = z.object({
  patientId: z.string(),
  lineas: z.array(z.object({ procedimientoId: z.string(), cantidad: z.number().int().positive() })).min(1),
  pagos: z.array(z.object({ metodo: z.enum(METODOS), monto: z.number().int().positive(), referencia: z.string().optional(), token: z.string().optional() })).min(1),
  facturar: z.boolean().default(true),
});

const includeCobro = { lineas: true, pagos: true, factura: { select: { id: true, secuencial: true, claveAcceso: true, estado: true, numeroAutorizacion: true } } } as const;

// RF-12: cobro con pagos mixtos. El total se calcula en el servidor con los precios del catálogo.
cajaRouter.post("/cobros", async (req, res) => {
  const p = cobroSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const turno = await turnoAbierto(req.user!.id);
  if (!turno) return res.status(409).json({ error: "Abre un turno de caja antes de cobrar" });
  const patient = await prisma.patient.findUnique({ where: { id: p.data.patientId } });
  if (!patient) return res.status(404).json({ error: "Paciente no encontrado" });

  const procs = await prisma.procedimiento.findMany({ where: { id: { in: p.data.lineas.map((l) => l.procedimientoId) } } });
  if (p.data.lineas.some((l) => !procs.some((x) => x.id === l.procedimientoId))) return res.status(404).json({ error: "Procedimiento inexistente" });
  const lineas = p.data.lineas.map((l) => {
    const proc = procs.find((x) => x.id === l.procedimientoId)!;
    return { procedimientoId: proc.id, descripcion: proc.nombre, cantidad: l.cantidad, precioUnitario: proc.precioBase };
  });
  const total = lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const pagado = p.data.pagos.reduce((s, x) => s + x.monto, 0);

  // Pagos por pasarela: se cobran primero y, si algo falla después, se reversan.
  const aprobadas: string[] = [];
  try {
    if (pagado !== total) throw new Regla(`Los pagos (${pagado}) deben sumar exactamente el total (${total}) en centavos`, 400);

    const pagosDb: { metodo: string; monto: number; referencia?: string }[] = [];
    for (const pago of p.data.pagos) {
      if (pago.metodo !== "PASARELA") {
        pagosDb.push({ metodo: pago.metodo, monto: pago.monto, referencia: pago.referencia });
        continue;
      }
      if (!pago.token) throw new Regla("El pago por pasarela requiere un token de pago", 400);
      const r = await pasarela.cobrar({ monto: pago.monto, token: pago.token, referencia: `turno-${turno.id}` });
      if (!r.aprobado) throw new Regla(`Pago rechazado por la pasarela: ${r.motivo}`, 402);
      aprobadas.push(r.transaccionId);
      pagosDb.push({ metodo: pago.metodo, monto: pago.monto, referencia: r.transaccionId });
    }

    const cobro = await prisma.$transaction(async (tx) => {
      const c = await tx.cobro.create({
        data: { turnoId: turno.id, patientId: patient.id, total, lineas: { create: lineas }, pagos: { create: pagosDb } },
      });
      if (p.data.facturar) {
        const ultimo = await tx.factura.aggregate({ _max: { secuencial: true } });
        const secuencial = (ultimo._max.secuencial ?? 0) + 1;
        const fecha = new Date();
        const clave = claveAcceso(fecha, secuencial);
        const xml = buildFacturaXml(
          { secuencial, fecha, comprador: { cedula: patient.cedula, nombre: `${patient.nombres} ${patient.apellidos}` }, detalles: lineas, pagos: pagosDb, total },
          clave,
        );
        const auth = await sri.autorizar(clave, xml);
        await tx.factura.create({
          data: { cobroId: c.id, secuencial, claveAcceso: clave, numeroAutorizacion: auth.numeroAutorizacion, estado: auth.estado, xml },
        });
      }
      return c;
    });
    res.status(201).json(await prisma.cobro.findUnique({ where: { id: cobro.id }, include: includeCobro }));
  } catch (e) {
    await Promise.all(aprobadas.map((t) => pasarela.reversar(t)));
    if (e instanceof Regla) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Comprobante interno: solo los cobros que emitió el propio cajero.
async function cobroPropio(id: number, userId: string) {
  return prisma.cobro.findFirst({ where: { id, turno: { userId } }, include: includeCobro });
}

cajaRouter.get("/cobros/:id", async (req, res) => {
  const c = await cobroPropio(Number(req.params.id), req.user!.id);
  if (!c) return res.status(404).json({ error: "Cobro no encontrado" });
  res.json({ comprobante: `CI-${String(c.id).padStart(6, "0")}`, ...c });
});

cajaRouter.get("/cobros/:id/factura.xml", async (req, res) => {
  const c = await cobroPropio(Number(req.params.id), req.user!.id);
  const f = c && (await prisma.factura.findUnique({ where: { cobroId: c.id } }));
  if (!f) return res.status(404).json({ error: "Factura no encontrada" });
  res.type("application/xml").send(f.xml);
});

// RN-02: cierre ciego. Se exige el conteo físico; solo después se calcula y revela el teórico.
cajaRouter.post("/cierre", async (req, res) => {
  const p = z.object({ conteoEfectivo: z.number().int().nonnegative() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Ingresa el conteo físico de efectivo en centavos" });
  const turno = await turnoAbierto(req.user!.id);
  if (!turno) return res.status(409).json({ error: "No tienes un turno abierto" });

  const efectivo = await prisma.pago.aggregate({ _sum: { monto: true }, where: { metodo: "EFECTIVO", cobro: { turnoId: turno.id } } });
  const totalTeorico = turno.fondoInicial + (efectivo._sum.monto ?? 0);
  const cerrado = await prisma.cajaTurno.update({
    where: { id: turno.id },
    data: {
      estado: "CERRADA",
      cerradaAt: new Date(),
      conteoEfectivo: p.data.conteoEfectivo,
      totalTeorico,
      diferencia: p.data.conteoEfectivo - totalTeorico,
    },
  });
  res.json(turnoPublico(cerrado));
});
