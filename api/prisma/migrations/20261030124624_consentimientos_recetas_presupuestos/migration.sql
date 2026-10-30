-- CreateTable
CREATE TABLE "ConsentimientoPlantilla" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "procedimientoId" TEXT,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Consentimiento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "otpHash" TEXT,
    "otpExpira" DATETIME,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "firmanteNombre" TEXT,
    "pdfPath" TEXT,
    "pdfHash" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firmadoAt" DATETIME
);

-- CreateTable
CREATE TABLE "Receta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "diagnostico" TEXT,
    "items" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Presupuesto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "descuento" INTEGER NOT NULL DEFAULT 0,
    "autorizadoPorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprobadoAt" DATETIME
);

-- CreateTable
CREATE TABLE "PresupuestoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presupuestoId" TEXT NOT NULL,
    "fase" INTEGER NOT NULL,
    "sesion" INTEGER NOT NULL,
    "procedimientoId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "diente" TEXT,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" INTEGER NOT NULL,
    "honorario" INTEGER NOT NULL,
    "costoLaboratorio" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "appointmentId" TEXT,
    CONSTRAINT "PresupuestoItem_presupuestoId_fkey" FOREIGN KEY ("presupuestoId") REFERENCES "Presupuesto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Consentimiento_patientId_idx" ON "Consentimiento"("patientId");

-- CreateIndex
CREATE INDEX "Receta_patientId_idx" ON "Receta"("patientId");

-- CreateIndex
CREATE INDEX "Presupuesto_patientId_idx" ON "Presupuesto"("patientId");

-- Un consentimiento firmado y una receta emitida no se modifican ni se borran.
CREATE TRIGGER "Consentimiento_firmado_no_update" BEFORE UPDATE ON "Consentimiento"
WHEN OLD."estado" = 'FIRMADO'
BEGIN SELECT RAISE(ABORT, 'Un consentimiento firmado es inmutable'); END;

CREATE TRIGGER "Consentimiento_firmado_no_delete" BEFORE DELETE ON "Consentimiento"
WHEN OLD."estado" = 'FIRMADO'
BEGIN SELECT RAISE(ABORT, 'Un consentimiento firmado no puede borrarse'); END;

CREATE TRIGGER "Receta_no_update" BEFORE UPDATE ON "Receta"
BEGIN SELECT RAISE(ABORT, 'La receta emitida es inmutable'); END;

CREATE TRIGGER "Receta_no_delete" BEFORE DELETE ON "Receta"
BEGIN SELECT RAISE(ABORT, 'La receta emitida no puede borrarse'); END;
