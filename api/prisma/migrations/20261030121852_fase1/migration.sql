-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cedula" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fechaNacimiento" DATETIME NOT NULL,
    "sexo" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "direccion" TEXT,
    "emergenciaNombre" TEXT NOT NULL,
    "emergenciaTelefono" TEXT NOT NULL,
    "tutorNombre" TEXT,
    "tutorCedula" TEXT,
    "tutorTelefono" TEXT,
    "seguro" TEXT,
    "convenio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Anamnesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "alergias" TEXT NOT NULL,
    "anticoagulado" BOOLEAN NOT NULL DEFAULT false,
    "coagulopatia" BOOLEAN NOT NULL DEFAULT false,
    "enfermedades" TEXT,
    "cirugias" TEXT,
    "observaciones" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Anamnesis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Consultorio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Sillon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consultorioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "Sillon_consultorioId_fkey" FOREIGN KEY ("consultorioId") REFERENCES "Consultorio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Profesional" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "nombre" TEXT NOT NULL,
    "especialidad" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Procedimiento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioBase" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "profesionalId" TEXT NOT NULL,
    "sillonId" TEXT NOT NULL,
    "inicio" DATETIME NOT NULL,
    "fin" DATETIME NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PROGRAMADO',
    "motivo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "Profesional" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_sillonId_fkey" FOREIGN KEY ("sillonId") REFERENCES "Sillon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_cedula_key" ON "Patient"("cedula");

-- CreateIndex
CREATE UNIQUE INDEX "Anamnesis_patientId_key" ON "Anamnesis"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Consultorio_nombre_key" ON "Consultorio"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Sillon_consultorioId_nombre_key" ON "Sillon"("consultorioId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Profesional_userId_key" ON "Profesional"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Procedimiento_codigo_key" ON "Procedimiento"("codigo");

-- CreateIndex
CREATE INDEX "Appointment_sillonId_inicio_idx" ON "Appointment"("sillonId", "inicio");

-- CreateIndex
CREATE INDEX "Appointment_inicio_idx" ON "Appointment"("inicio");
