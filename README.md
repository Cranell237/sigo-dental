# SIGO-Dental

Sistema Integral de Gestión Odontológica y Expediente Clínico Digital (proyecto académico de Ingeniería en Software).

## Documentación
- Requerimientos: [`docs/srs-sigo-dental.md`](docs/srs-sigo-dental.md)
- Arquitectura: [`docs/architecture.md`](docs/architecture.md)
- Plan de implementación por fases: [`docs/plan-de-implementacion.md`](docs/plan-de-implementacion.md)

## Stack
React + Vite + TypeScript + Tailwind · Node.js + Express + TypeScript · SQLite + Prisma

## Despliegue
Render (un solo Web Service; Express sirve el API y el build de React). Ver la sección "Despliegue en Render" del plan.

## Ejecución local
```bash
npm install
cp api/.env.example api/.env
npm run db:migrate -w api
npm run seed
npm run dev
```
Web en http://localhost:5173 · API en http://localhost:3000/api/health

Usuarios de demo (contraseña `Demo1234!`): admin, odontologo, recepcion, asistente, auditor @sigo.test
MFA: todos menos admin lo tienen activo con el secreto de demo `JBSWY3DPEHPK3PXP` (agrégalo a Google Authenticator o similar). API docs en `/api/docs`.

## Estado
- **Fase 0 (fundamentos y seguridad): completa.** Ver [`docs/architecture.md`](docs/architecture.md).
- **Fase 1 (administrativo y turnos): en curso.** Hecho: ficha del paciente, anamnesis con alertas (1.1, 1.2), catálogos (1.3), agenda día/semana, no solapamiento por sillón y estados de cita (1.4-1.6). Pendiente: recordatorios (1.7), caja (1.8), cierre ciego (1.9) y facturación simulada (1.10).
