# Plan de implementación — SIGO-Dental

Fuente: `documento_de_requerimientos_de_software_sistema_odontol_gico.md` (SRS v1.0, 29/10/2026).
Este plan respeta las 4 fases del SRS (§8.1) y antepone una **Fase 0 de fundamentos**, porque varios RNF (RBAC, MFA, auditoría inmutable, cifrado) son transversales y se encarecen si se agregan al final.

> Estado: **propuesta**. Stack simplificado a petición del equipo (proyecto académico).

---

## Stack (simplificado para un proyecto académico)

Criterio: pocas piezas, un solo lenguaje (TypeScript), cero servicios externos obligatorios y que corra con `npm install && npm run dev`.

| Capa | Elección | Por qué |
|---|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS | El SRS sugiere React/Vue/Angular + Tailwind. El odontograma se dibuja con SVG, sin librerías de gráficos. |
| Backend | Node.js + Express + TypeScript | Mucho más simple que NestJS; una carpeta por módulo (`pacientes`, `agenda`, `clinico`, `facturacion`). |
| Base de datos | SQLite con Prisma | Sin instalar ni administrar un servidor; un solo archivo. Prisma permite pasar a PostgreSQL cambiando una línea, si se necesita después. |
| Validación | Zod | Valida entradas del API y comparte los tipos con el frontend. |
| Autenticación | JWT + bcrypt; MFA con TOTP (`otplib`) | Cumple RNF-05 sin infraestructura extra. |
| Recordatorios | `node-cron` | Reemplaza a Redis/BullMQ: un cron revisa cada hora las citas de las próximas 24/48 h. |
| Archivos | Carpeta local `uploads/` | Reemplaza a S3; detrás de una interfaz `Storage` para poder migrar. |
| PDFs | `pdfkit` | Recetas, consentimientos y presupuestos. |
| API docs | `swagger-ui-express` + OpenAPI 3 | Entregable obligatorio del SRS (8.2). |
| Pruebas | Vitest + Supertest; Playwright solo para el flujo principal | Meta: 80 % en endpoints críticos. |
| CI | GitHub Actions: lint, typecheck, test, build | Un solo workflow. |

Integraciones externas (SRI, WhatsApp, pasarela de pagos): cada una detrás de una interfaz con una **implementación simulada** (mock). Para la entrega académica se demuestra el flujo completo y se documenta cómo conectar el proveedor real.

Pendiente de la propuesta anterior (descartado por complejidad): NestJS, PostgreSQL, Redis, MinIO, Docker Compose, microservicios.

## Despliegue en Render

El stack **no cambia**; solo se acomoda la forma de desplegarlo:

- **Un solo Web Service**: en producción Express sirve el build de React (`web/dist`) y el API bajo `/api`. Una URL, sin CORS, un solo servicio gratuito.
- **TLS**: Render lo entrega por defecto (cubre la parte de HTTPS de RNF-04; no hay que configurar proxy).
- **SQLite en Render**: el disco del plan gratuito es efímero (se borra en cada deploy/reinicio). Como es una demo, la app ejecuta `prisma migrate deploy` + `seed` al arrancar, así que siempre hay datos de prueba. Si se quiere persistencia real: Render Postgres (cambiar `provider` en `schema.prisma`) o un Persistent Disk (de pago).
- **`uploads/` y `node-cron`**: también son efímeros / se duermen con el servicio gratuito (se duerme tras 15 min sin tráfico). Para la demo los recordatorios se pueden disparar manualmente desde un endpoint de administración.
- **Variables de entorno** (`JWT_SECRET`, `ENCRYPTION_KEY`, etc.) se configuran en el panel de Render; `render.yaml` en la raíz define el servicio (Infrastructure as Code).
- Scripts requeridos en la raíz: `build` (instala, compila web y api, `prisma generate`) y `start` (migra, siembra, arranca).

## Flujo de trabajo con las skills `vibe`

Instaladas en `.claude/skills/`. Ciclo por cada fase:

1. `project-setup` (una sola vez): rol, política de docs, `CLAUDE.md`.
2. `issue-creator`: convierte los entregables de la fase en issues de GitHub (una por PR).
3. `task-intake`: toma una issue → análisis → aprobación → rama, código, pruebas, commit.
4. Abrir PR (título y descripción listos para copiar).
5. `pr-review` en **otra sesión** → `pr-feedback` si hay observaciones → merge.
6. Al cerrar cada fase: `security-audit` (y `repo-audit` en las fases 2 y 4).
7. `flow` sirve como enrutador cuando no esté claro qué sigue.

Requisitos previos: el proyecto debe ser un repositorio git y tener remoto en GitHub con `gh` autenticado (lo usan `issue-creator`, `pr-review` y `pr-feedback`).

---

## Fase 0 — Fundamentos y seguridad base (Sprint 0) — ✅ completada

**Objetivo:** un esqueleto que ya cumpla los RNF transversales, para que todo módulo nuevo los herede.

| # | Entregable | Cubre |
|---|---|---|
| 0.1 | Repo git + `project-setup` + README + `docs/architecture.md` | 8.2 (documentación) |
| 0.2 | Estructura `web/` y `api/` (dos paquetes npm), SQLite + Prisma, scripts `dev`, `test`, `lint` | §7 |
| 0.3 | Modelo de usuarios, roles y permisos (5 roles del §3) + guardas RBAC | RNF-05 |
| 0.4 | Login con JWT (access corto + refresh rotativo) + MFA TOTP obligatorio para roles clínicos/financieros | RNF-05 |
| 0.5 | Cierre de sesión por 15 min de inactividad (frontend + expiración en servidor) | RNF-05 |
| 0.6 | Log de auditoría append-only: quién, qué, registro, acción, timestamp ISO-8601, IP. Tabla solo de inserción (sin endpoints de edición/borrado) + hash encadenado entre filas para detectar manipulación | RNF-06 |
| 0.7 | Cifrado: HTTPS en despliegue (TLS 1.3 en el proxy), cifrado AES-256-GCM de campos sensibles desde la app, contraseñas con bcrypt | RNF-04 |
| 0.8 | Shell del frontend: layout responsive, navegación por rol, sistema de diseño Tailwind | RNF-07, RNF-08 |
| 0.9 | CI: lint, typecheck, tests, build, SAST; Swagger en `/api/docs` | 8.2 |

**Criterios de aceptación**
- `npm install` + `npm run seed` + `npm run dev` levantan el sistema con un usuario por rol.
- Un recepcionista recibe 403 al consultar un endpoint clínico (test automatizado).
- Toda lectura/escritura sobre un recurso clínico de prueba genera una fila de auditoría; intentar modificarla falla.
- El pipeline de CI pasa en verde en `main`.

---

## Fase 1 — Core administrativo y turnos (Sprints 1-4) — ✅ completada

| # | Entregable | Cubre |
|---|---|---|
| 1.1 | Ficha única del paciente: datos demográficos, contacto de emergencia, tutor legal (obligatorio si es menor), seguro/convenio. Búsqueda por cédula/nombre | RF-01 |
| 1.2 | Anamnesis obligatoria + alertas críticas (alergias, anticoagulados, coagulopatías) con badge visible en la cabecera del expediente | RF-02 |
| 1.3 | Catálogos: consultorios, sillones, profesionales/especialidades, procedimientos con precio base | §8.1 "catálogo médico" |
| 1.4 | Agenda día/semana filtrable por sillón y profesional | RF-09 |
| 1.5 | Regla de no solapamiento por sillón (validación dentro de una transacción de base de datos) | RN-03 |
| 1.6 | Máquina de estados de la cita con transiciones válidas | RF-10 |
| 1.7 | Recordatorios 48h/24h con `node-cron` y un adaptador de canal (email por SMTP de pruebas; WhatsApp/SMS simulados) | RF-11 |
| 1.8 | Caja básica: cobro con pagos mixtos, comprobante interno | RF-12 (parcial) |
| 1.9 | Cierre de caja ciego | RN-02 |
| 1.10 | Facturación electrónica: generación del comprobante (XML) y adaptador del SRI simulado; integración real queda documentada | RF-12, §7.1 |

**Criterios de aceptación**
- No se puede crear una cita que se solape en el mismo sillón, ni con dos peticiones concurrentes (test de concurrencia).
- Pasar de "Atendido" a "Programado" está rechazado.
- La recepcionista no ve el total teórico antes de registrar su conteo físico.
- Un paciente con alergia a penicilina muestra el badge en cualquier pantalla de su expediente.

---

## Fase 2 — Core clínico (Sprints 5-8)

| # | Entregable | Cubre |
|---|---|---|
| 2.1 | Odontograma SVG: permanente (32) y temporal (20), notación FDI ⇄ Universal, 5 superficies por diente | RF-03 |
| 2.2 | Catálogo visual de hallazgos (caries rojo, restauración azul, endodoncia, implante, prótesis, exodoncia, sellante) y estados "existente/requerido/realizado" | RF-03 |
| 2.3 | Periodontograma: 6 puntos por diente, margen gingival, NIC calculado, furca, movilidad, sangrado | RF-04 |
| 2.4 | Notas SOEP inmutables: bloqueo tras un plazo configurable (24h por defecto), firma del profesional, adendas firmadas | RF-05, RN-01 |
| 2.5 | Procedimientos "Realizado": sin borrado físico; corrección solo vía adenda | RN-01 |
| 2.6 | Consentimiento informado: plantillas por procedimiento, firma en tablet (canvas) u OTP, PDF guardado en `uploads/` | RF-06 |
| 2.7 | Recetas odontológicas en PDF | §8.1 |
| 2.8 | Presupuestos por fases/sesiones (honorarios, laboratorio, descuentos autorizados) | RF-07 |
| 2.9 | Aprobación total/parcial del presupuesto → ítems agendables | RF-08 |

**Criterios de aceptación**
- Expediente + odontograma cargan en < 1.5 s con datos de prueba realistas (medido con Playwright/Lighthouse).
- Una nota SOEP con más de 24 h rechaza la edición; la adenda queda enlazada a la original.
- El odontograma se usa cómodamente en una tablet de 10.5" (pruebas a 768 px y 1024 px).

---

## Fase 3 — Finanzas avanzadas, inventario y reportes (Sprints 9-11)

| # | Entregable | Cubre |
|---|---|---|
| 3.1 | Inventario por consultorio: insumos, lotes, stock mínimo, movimientos | §2.2 |
| 3.2 | Receta estándar de consumo por procedimiento + descargo automático y transaccional al marcar "Realizado" | RF-14 |
| 3.3 | Liquidación de honorarios: % fijo, monto fijo o % tras costos de laboratorio/materiales | RF-13 |
| 3.4 | Reportes: corte de caja, honorarios, inventario, ausentismo (no-show) | §3 Auditor, §2.2 |
| 3.5 | Pasarela de pagos (adaptador simulado) | §7.1 |

**Criterios de aceptación**
- Completar un procedimiento descuenta exactamente la receta de consumo; si falla el descargo, el procedimiento no queda a medias.
- Los cálculos de comisión con montos de prueba coinciden al centavo (redondeo con decimal, nunca con float).

---

## Fase 4 — UAT, auditoría de seguridad y salida a producción (Sprint 12)

| # | Entregable | Cubre |
|---|---|---|
| 4.1 | `security-audit` + `repo-audit` completos; cero hallazgos altos o críticos | 8.2 (OWASP) |
| 4.2 | DAST (OWASP ZAP) contra staging | 8.2 |
| 4.3 | Cobertura ≥ 80 % en endpoints críticos | 8.2 |
| 4.4 | Prueba de carga básica con `autocannon` (objetivo: 150 usuarios concurrentes) | RNF-03 |
| 4.5 | Backup del archivo SQLite + prueba de restauración; endpoint `/health` | RNF-02 |
| 4.6 | Guion de UAT por rol y acta de aceptación | §1.2 |
| 4.7 | Despliegue a producción con TLS 1.3 y rollback documentado | RNF-04 |

---

## Matriz de trazabilidad

| Requisito | Fase | | Requisito | Fase |
|---|---|---|---|---|
| RF-01, RF-02 | 1 | | RNF-01 | 2 (medido en 4) |
| RF-03, RF-04, RF-05, RF-06 | 2 | | RNF-02, RNF-03 | 4 |
| RF-07, RF-08 | 2 | | RNF-04, RNF-05, RNF-06 | 0 |
| RF-09, RF-10, RF-11 | 1 | | RNF-07, RNF-08 | 0 (validado en cada fase) |
| RF-12 | 1 | | RN-01 | 2 |
| RF-13, RF-14 | 3 | | RN-02, RN-03 | 1 |

## Decisiones abiertas

1. **Alcance de integraciones reales:** qué integraciones (SRI, WhatsApp, pagos) se demuestran solo simuladas y cuáles con proveedor real.
2. **Firma de notas SOEP (RF-05):** firma simple (re-autenticación + hash) o firma electrónica con certificado `.p12` del profesional.
3. **Facturación electrónica:** integración directa con el SRI o mediante un proveedor intermediario.
4. **WhatsApp Business:** requiere una cuenta verificada de Meta; mientras tanto se trabaja en modo sandbox.
5. **Marco normativo:** el SRS cita HIPAA; para Ecuador aplica la LOPDP (Ley Orgánica de Protección de Datos Personales).
