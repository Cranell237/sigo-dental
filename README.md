# SIGO-Dental

Sistema Integral de Gestión Odontológica y Expediente Clínico Digital (proyecto académico de Ingeniería en Software).

## Documentación
- Requerimientos: [`docs/srs-sigo-dental.md`](docs/srs-sigo-dental.md)
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

## Estado
Fase 0 en curso: esqueleto (web + api + Prisma/SQLite + render.yaml) listo. Pendiente: RBAC, login/MFA, auditoría, CI.
