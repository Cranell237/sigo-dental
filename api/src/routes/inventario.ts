import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditAccess } from "../audit.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

// 3.1: inventario por consultorio (insumos, lotes, stock mínimo, movimientos) y receta de consumo (RF-14).
export const inventarioRouter = Router();
inventarioRouter.use(authenticate, auditAccess("inventario"));

const leer = requirePermission("inventario:leer");
const gestionar = requirePermission("inventario:gestionar");

inventarioRouter.get("/", leer, async (req, res) => {
  const consultorioId = z.string().safeParse(req.query.consultorioId);
  if (!consultorioId.success) return res.status(400).json({ error: "Indica consultorioId" });
  const [insumos, lotes] = await Promise.all([
    prisma.insumo.findMany({ orderBy: { nombre: "asc" } }),
    prisma.loteInsumo.findMany({ where: { consultorioId: consultorioId.data }, orderBy: { vence: "asc" } }),
  ]);
  res.json(
    insumos.map((i) => {
      const suyos = lotes.filter((l) => l.insumoId === i.id);
      const stock = suyos.reduce((s, l) => s + l.cantidad, 0);
      return { ...i, stock, bajoMinimo: stock < i.stockMinimo, lotes: suyos };
    }),
  );
});

inventarioRouter.post("/insumos", requirePermission("catalogos:gestionar"), async (req, res) => {
  const p = z
    .object({ codigo: z.string().trim().min(1), nombre: z.string().trim().min(1), unidad: z.string().trim().min(1), stockMinimo: z.number().int().min(0).default(0), costoUnitario: z.number().int().min(0).default(0) })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  if (await prisma.insumo.findUnique({ where: { codigo: p.data.codigo } })) return res.status(409).json({ error: "El código ya existe" });
  res.status(201).json(await prisma.insumo.create({ data: p.data }));
});

inventarioRouter.post("/entradas", gestionar, async (req, res) => {
  const p = z
    .object({ insumoId: z.string(), consultorioId: z.string(), lote: z.string().trim().min(1), vence: z.coerce.date().optional(), cantidad: z.number().int().positive() })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos", detalles: p.error.issues });
  const [insumo, consultorio] = await Promise.all([prisma.insumo.findUnique({ where: { id: p.data.insumoId } }), prisma.consultorio.findUnique({ where: { id: p.data.consultorioId } })]);
  if (!insumo || !consultorio) return res.status(404).json({ error: "Insumo o consultorio no existe" });

  const lote = await prisma.$transaction(async (tx) => {
    const l = await tx.loteInsumo.upsert({
      where: { insumoId_consultorioId_lote: { insumoId: insumo.id, consultorioId: consultorio.id, lote: p.data.lote } },
      update: { cantidad: { increment: p.data.cantidad } },
      create: { insumoId: insumo.id, consultorioId: consultorio.id, lote: p.data.lote, vence: p.data.vence, cantidad: p.data.cantidad },
    });
    await tx.movimientoInventario.create({
      data: { insumoId: insumo.id, consultorioId: consultorio.id, loteId: l.id, tipo: "ENTRADA", cantidad: p.data.cantidad, motivo: `Ingreso de lote ${p.data.lote}`, userId: req.user!.id },
    });
    return l;
  });
  res.status(201).json(lote);
});

// Ajuste por conteo físico: deja el saldo en `cantidadReal` y registra la diferencia.
inventarioRouter.post("/ajustes", gestionar, async (req, res) => {
  const p = z.object({ loteId: z.string(), cantidadReal: z.number().int().min(0), motivo: z.string().trim().min(3) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Indica el lote, la cantidad real y el motivo" });
  const lote = await prisma.loteInsumo.findUnique({ where: { id: p.data.loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  const diff = p.data.cantidadReal - lote.cantidad;
  await prisma.$transaction([
    prisma.loteInsumo.update({ where: { id: lote.id }, data: { cantidad: p.data.cantidadReal } }),
    prisma.movimientoInventario.create({
      data: { insumoId: lote.insumoId, consultorioId: lote.consultorioId, loteId: lote.id, tipo: "AJUSTE", cantidad: Math.abs(diff), motivo: `${p.data.motivo} (${diff >= 0 ? "+" : ""}${diff})`, userId: req.user!.id },
    }),
  ]);
  res.json({ ...lote, cantidad: p.data.cantidadReal });
});

inventarioRouter.get("/movimientos", leer, async (req, res) => {
  const q = z.object({ insumoId: z.string().optional(), consultorioId: z.string().optional() }).parse(req.query);
  res.json(await prisma.movimientoInventario.findMany({ where: q, orderBy: { createdAt: "desc" }, take: 100 }));
});

// ---------- Receta estándar de consumo por procedimiento ----------

inventarioRouter.get("/receta-consumo/:procedimientoId", leer, async (req, res) => {
  res.json(await prisma.recetaConsumo.findMany({ where: { procedimientoId: String(req.params.procedimientoId) } }));
});

inventarioRouter.put("/receta-consumo/:procedimientoId", requirePermission("catalogos:gestionar"), async (req, res) => {
  const p = z.object({ items: z.array(z.object({ insumoId: z.string(), cantidad: z.number().int().positive() })) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Datos inválidos" });
  if (!(await prisma.procedimiento.findUnique({ where: { id: String(req.params.procedimientoId) } }))) return res.status(404).json({ error: "Procedimiento no encontrado" });
  if (new Set(p.data.items.map((i) => i.insumoId)).size !== p.data.items.length) return res.status(400).json({ error: "Insumo repetido en la receta" });
  const rows = await prisma.$transaction(async (tx) => {
    await tx.recetaConsumo.deleteMany({ where: { procedimientoId: String(req.params.procedimientoId) } });
    await tx.recetaConsumo.createMany({ data: p.data.items.map((i) => ({ ...i, procedimientoId: String(req.params.procedimientoId) })) });
    return tx.recetaConsumo.findMany({ where: { procedimientoId: String(req.params.procedimientoId) } });
  });
  res.json(rows);
});
