import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface Faltante {
  insumo: string;
  requerido: number;
  disponible: number;
}

/** Se lanza cuando el consultorio no tiene stock suficiente; la transacción que lo contiene se revierte. */
export class StockInsuficiente extends Error {
  constructor(public faltantes: Faltante[]) {
    super("Stock insuficiente para descontar los insumos del procedimiento");
  }
}

/**
 * RF-14: descuenta la receta estándar de consumo del procedimiento, tomando primero los lotes
 * que vencen antes (FEFO). Es todo o nada: si falta un solo insumo no se descuenta nada.
 * Devuelve el costo de materiales en centavos.
 */
export async function descontarReceta(tx: Tx, p: { procedimientoId: string; consultorioId: string; hallazgoId: string; userId: string }) {
  const receta = await tx.recetaConsumo.findMany({ where: { procedimientoId: p.procedimientoId } });
  if (!receta.length) return { costoMateriales: 0, descontados: 0 };

  const insumos = await tx.insumo.findMany({ where: { id: { in: receta.map((r) => r.insumoId) } } });
  const plan: { loteId: string; insumoId: string; cantidad: number }[] = [];
  const faltantes: Faltante[] = [];
  let costoMateriales = 0;

  for (const linea of receta) {
    const insumo = insumos.find((i) => i.id === linea.insumoId)!;
    const lotes = await tx.loteInsumo.findMany({ where: { insumoId: linea.insumoId, consultorioId: p.consultorioId, cantidad: { gt: 0 } } });
    // FEFO: primero el que vence antes; los lotes sin vencimiento al final.
    lotes.sort((a, b) => (a.vence?.getTime() ?? Infinity) - (b.vence?.getTime() ?? Infinity));
    const disponible = lotes.reduce((s, l) => s + l.cantidad, 0);
    if (disponible < linea.cantidad) {
      faltantes.push({ insumo: insumo.nombre, requerido: linea.cantidad, disponible });
      continue;
    }
    let pendiente = linea.cantidad;
    for (const lote of lotes) {
      if (pendiente === 0) break;
      const toma = Math.min(lote.cantidad, pendiente);
      plan.push({ loteId: lote.id, insumoId: linea.insumoId, cantidad: toma });
      pendiente -= toma;
    }
    costoMateriales += linea.cantidad * insumo.costoUnitario;
  }
  if (faltantes.length) throw new StockInsuficiente(faltantes);

  for (const s of plan) {
    await tx.loteInsumo.update({ where: { id: s.loteId }, data: { cantidad: { decrement: s.cantidad } } });
    await tx.movimientoInventario.create({
      data: { insumoId: s.insumoId, consultorioId: p.consultorioId, loteId: s.loteId, tipo: "SALIDA", cantidad: s.cantidad, motivo: "Descargo automático por procedimiento realizado", hallazgoId: p.hallazgoId, userId: p.userId },
    });
  }
  return { costoMateriales, descontados: plan.length };
}
