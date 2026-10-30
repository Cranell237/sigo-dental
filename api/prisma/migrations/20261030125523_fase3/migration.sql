-- AlterTable
ALTER TABLE "Hallazgo" ADD COLUMN "procedimientoId" TEXT;

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "costoUnitario" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "LoteInsumo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insumoId" TEXT NOT NULL,
    "consultorioId" TEXT NOT NULL,
    "lote" TEXT NOT NULL,
    "vence" DATETIME,
    "cantidad" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insumoId" TEXT NOT NULL,
    "consultorioId" TEXT NOT NULL,
    "loteId" TEXT,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "hallazgoId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RecetaConsumo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "procedimientoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "ReglaHonorario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profesionalId" TEXT NOT NULL,
    "procedimientoId" TEXT,
    "modalidad" TEXT NOT NULL,
    "valor" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "ProcedimientoRealizado" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hallazgoId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "profesionalId" TEXT,
    "procedimientoId" TEXT NOT NULL,
    "consultorioId" TEXT,
    "precio" INTEGER NOT NULL,
    "costoMateriales" INTEGER NOT NULL DEFAULT 0,
    "costoLaboratorio" INTEGER NOT NULL DEFAULT 0,
    "realizadoAt" DATETIME NOT NULL,
    "liquidacionId" TEXT
);

-- CreateTable
CREATE TABLE "Liquidacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profesionalId" TEXT NOT NULL,
    "desde" DATETIME NOT NULL,
    "hasta" DATETIME NOT NULL,
    "total" INTEGER NOT NULL,
    "creadaPorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LiquidacionLinea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "liquidacionId" TEXT NOT NULL,
    "realizadoId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "base" INTEGER NOT NULL,
    "modalidad" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "comision" INTEGER NOT NULL,
    CONSTRAINT "LiquidacionLinea_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "Liquidacion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_codigo_key" ON "Insumo"("codigo");

-- CreateIndex
CREATE INDEX "LoteInsumo_insumoId_consultorioId_idx" ON "LoteInsumo"("insumoId", "consultorioId");

-- CreateIndex
CREATE UNIQUE INDEX "LoteInsumo_insumoId_consultorioId_lote_key" ON "LoteInsumo"("insumoId", "consultorioId", "lote");

-- CreateIndex
CREATE INDEX "MovimientoInventario_insumoId_consultorioId_idx" ON "MovimientoInventario"("insumoId", "consultorioId");

-- CreateIndex
CREATE UNIQUE INDEX "RecetaConsumo_procedimientoId_insumoId_key" ON "RecetaConsumo"("procedimientoId", "insumoId");

-- CreateIndex
CREATE INDEX "ReglaHonorario_profesionalId_idx" ON "ReglaHonorario"("profesionalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedimientoRealizado_hallazgoId_key" ON "ProcedimientoRealizado"("hallazgoId");

-- CreateIndex
CREATE INDEX "ProcedimientoRealizado_profesionalId_realizadoAt_idx" ON "ProcedimientoRealizado"("profesionalId", "realizadoAt");

-- El libro de movimientos y las instantáneas de lo realizado son solo de inserción.
CREATE TRIGGER "MovimientoInventario_no_update" BEFORE UPDATE ON "MovimientoInventario"
BEGIN SELECT RAISE(ABORT, 'MovimientoInventario es append-only'); END;

CREATE TRIGGER "MovimientoInventario_no_delete" BEFORE DELETE ON "MovimientoInventario"
BEGIN SELECT RAISE(ABORT, 'MovimientoInventario es append-only'); END;

-- Un procedimiento realizado solo puede cambiar al ser liquidado (una vez).
CREATE TRIGGER "ProcedimientoRealizado_solo_liquidar" BEFORE UPDATE ON "ProcedimientoRealizado"
WHEN OLD."liquidacionId" IS NOT NULL OR NEW."precio" <> OLD."precio" OR NEW."costoMateriales" <> OLD."costoMateriales" OR NEW."costoLaboratorio" <> OLD."costoLaboratorio" OR NEW."hallazgoId" <> OLD."hallazgoId"
BEGIN SELECT RAISE(ABORT, 'ProcedimientoRealizado es inmutable salvo su liquidación'); END;

CREATE TRIGGER "ProcedimientoRealizado_no_delete" BEFORE DELETE ON "ProcedimientoRealizado"
BEGIN SELECT RAISE(ABORT, 'ProcedimientoRealizado no puede borrarse'); END;

CREATE TRIGGER "Liquidacion_no_update" BEFORE UPDATE ON "Liquidacion"
BEGIN SELECT RAISE(ABORT, 'La liquidación es inmutable'); END;

CREATE TRIGGER "Liquidacion_no_delete" BEFORE DELETE ON "Liquidacion"
BEGIN SELECT RAISE(ABORT, 'La liquidación no puede borrarse'); END;
