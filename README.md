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
- **Fase 1 (administrativo y turnos): completa.** Pacientes y anamnesis con alertas, catálogos, agenda sin solapes y con estados, recordatorios 48 h/24 h (canales simulados), caja con pagos mixtos, cierre ciego y factura electrónica XML con autorización simulada del SRI.
- **Fase 2 (clínico): completa.** Odontograma SVG, periodontograma con NIC, notas SOEP inmutables con firma y adendas, RN-01, consentimiento informado (firma en pantalla u OTP) con PDF, recetas en PDF con aviso de alergias y presupuestos por fases con aprobación parcial y paso a citas.
- **Fase 3 (finanzas, inventario y reportes): completa.** Inventario por consultorio con lotes (FEFO), descargo automático y transaccional al realizar un procedimiento, liquidación de honorarios (porcentaje, monto fijo o porcentaje neto, en enteros), reportes con exportación CSV y pasarela de pagos simulada.
- Siguiente: Fase 4 (UAT, auditoría de seguridad, rendimiento y despliegue en Render).
