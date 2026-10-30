-- CreateTable
CREATE TABLE "Hallazgo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "diente" TEXT NOT NULL,
    "superficie" TEXT,
    "tipo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "nota" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "realizadoAt" DATETIME,
    "realizadoPorId" TEXT
);

-- CreateTable
CREATE TABLE "NotaSoep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "autorId" TEXT NOT NULL,
    "subjetivo" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    "evaluacion" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firmadaAt" DATETIME,
    "firmadaPorId" TEXT,
    "firmaHash" TEXT
);

-- CreateTable
CREATE TABLE "Adenda" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notaId" TEXT,
    "hallazgoId" TEXT,
    "texto" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "firmaHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Adenda_notaId_fkey" FOREIGN KEY ("notaId") REFERENCES "NotaSoep" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Adenda_hallazgoId_fkey" FOREIGN KEY ("hallazgoId") REFERENCES "Hallazgo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerioExamen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PerioDiente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examenId" TEXT NOT NULL,
    "diente" TEXT NOT NULL,
    "puntos" TEXT NOT NULL,
    "furca" INTEGER NOT NULL DEFAULT 0,
    "movilidad" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PerioDiente_examenId_fkey" FOREIGN KEY ("examenId") REFERENCES "PerioExamen" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Hallazgo_patientId_idx" ON "Hallazgo"("patientId");

-- CreateIndex
CREATE INDEX "NotaSoep_patientId_createdAt_idx" ON "NotaSoep"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PerioExamen_patientId_createdAt_idx" ON "PerioExamen"("patientId", "createdAt");

-- RN-01: un procedimiento REALIZADO no puede modificarse ni borrarse; solo se corrige con una adenda.
CREATE TRIGGER "Hallazgo_realizado_no_update" BEFORE UPDATE ON "Hallazgo"
WHEN OLD."estado" = 'REALIZADO'
BEGIN SELECT RAISE(ABORT, 'Un hallazgo REALIZADO es inmutable (use una adenda)'); END;

CREATE TRIGGER "Hallazgo_realizado_no_delete" BEFORE DELETE ON "Hallazgo"
WHEN OLD."estado" = 'REALIZADO'
BEGIN SELECT RAISE(ABORT, 'Un hallazgo REALIZADO no puede borrarse (use una adenda)'); END;

-- RF-05: la nota firmada no se edita y ninguna nota se borra.
CREATE TRIGGER "NotaSoep_firmada_no_update" BEFORE UPDATE ON "NotaSoep"
WHEN OLD."firmaHash" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Una nota firmada es inmutable (use una adenda)'); END;

CREATE TRIGGER "NotaSoep_no_delete" BEFORE DELETE ON "NotaSoep"
BEGIN SELECT RAISE(ABORT, 'Las notas de evolución no pueden borrarse'); END;

-- Adendas y exámenes periodontales: solo inserción.
CREATE TRIGGER "Adenda_no_update" BEFORE UPDATE ON "Adenda"
BEGIN SELECT RAISE(ABORT, 'Adenda es append-only'); END;

CREATE TRIGGER "Adenda_no_delete" BEFORE DELETE ON "Adenda"
BEGIN SELECT RAISE(ABORT, 'Adenda es append-only'); END;

CREATE TRIGGER "PerioDiente_no_update" BEFORE UPDATE ON "PerioDiente"
BEGIN SELECT RAISE(ABORT, 'El periodontograma no se edita: registre un nuevo examen'); END;

CREATE TRIGGER "PerioDiente_no_delete" BEFORE DELETE ON "PerioDiente"
BEGIN SELECT RAISE(ABORT, 'El periodontograma no se borra'); END;
