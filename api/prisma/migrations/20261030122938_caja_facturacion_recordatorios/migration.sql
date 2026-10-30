-- CreateTable
CREATE TABLE "CajaTurno" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fondoInicial" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "abiertaAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaAt" DATETIME,
    "conteoEfectivo" INTEGER,
    "totalTeorico" INTEGER,
    "diferencia" INTEGER
);

-- CreateTable
CREATE TABLE "Cobro" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "turnoId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cobro_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "CajaTurno" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CobroLinea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cobroId" INTEGER NOT NULL,
    "procedimientoId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    CONSTRAINT "CobroLinea_cobroId_fkey" FOREIGN KEY ("cobroId") REFERENCES "Cobro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cobroId" INTEGER NOT NULL,
    "metodo" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "referencia" TEXT,
    CONSTRAINT "Pago_cobroId_fkey" FOREIGN KEY ("cobroId") REFERENCES "Cobro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cobroId" INTEGER NOT NULL,
    "secuencial" INTEGER NOT NULL,
    "claveAcceso" TEXT NOT NULL,
    "numeroAutorizacion" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "xml" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Factura_cobroId_fkey" FOREIGN KEY ("cobroId") REFERENCES "Cobro" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recordatorio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CajaTurno_userId_estado_idx" ON "CajaTurno"("userId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_cobroId_key" ON "Factura"("cobroId");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_secuencial_key" ON "Factura"("secuencial");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_claveAcceso_key" ON "Factura"("claveAcceso");

-- CreateIndex
CREATE UNIQUE INDEX "Recordatorio_appointmentId_tipo_key" ON "Recordatorio"("appointmentId", "tipo");
