# Fase 4 — Auditoría, pruebas y preparación para producción

Fecha: 30/10/2026. Alcance: API (`api/`), frontend (`web/`) y configuración de despliegue.

## Hallazgos y correcciones

| # | Severidad | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| 1 | **Crítica** | Express 4 no captura errores de handlers `async`. Un parámetro repetido (`?insumoId=a&insumoId=b`) colgaba la petición y dejaba una promesa rechazada sin manejar; en producción Node termina el proceso → cualquiera podía tumbar el servicio con una URL. | Migración a Express 5 (propaga los rechazos) + manejador de errores global: 400 para validación/JSON inválido, 413 para cuerpos grandes, 500 genérico sin detalles internos. | `seguridad.test.ts` |
| 2 | **Alta** | Con 150 lecturas clínicas concurrentes se **perdían filas de auditoría** (~130 en 10 s): cada fila abría una transacción interactiva que agotaba su espera por la única conexión de SQLite. Incumplía RNF-06. | Cola en memoria que encadena los hashes y escribe por lotes (`createMany`). | `audit.test.ts` (300 escrituras concurrentes, cadena íntegra) y prueba de carga |
| 3 | Alta | Sin límite de intentos: el código TOTP de 6 dígitos y las contraseñas admitían fuerza bruta. | `express-rate-limit`: 20 intentos por IP cada 15 min en login, login MFA y activación de MFA. | `seguridad.test.ts` |
| 4 | Media | Sin cabeceras de seguridad (CSP, HSTS, nosniff, frame-ancestors) y `X-Powered-By` expuesto. | `helmet` con CSP `default-src 'self'`. Verificado que React y Swagger funcionan sin violaciones de CSP. | `seguridad.test.ts`, navegador |
| 5 | Media | En producción la app arrancaba con secretos de desarrollo si faltaban `JWT_SECRET`/`ENCRYPTION_KEY`. | Arranque falla si faltan en `NODE_ENV=production`. | — |
| 6 | Media | Detrás del proxy de Render `req.ip` sería la IP del proxy (auditoría y rate limit incorrectos). | `trust proxy = 1`. | — |
| 7 | Baja | `cors()` abierto a cualquier origen, innecesario (mismo origen). | Eliminado. | — |
| 8 | Baja | `jwt.verify` sin fijar algoritmo. | `algorithms: ["HS256"]`. | — |
| 9 | Baja | Límite de JSON de 100 KB menor que el tope de la firma del consentimiento. | Límite de 1 MB. | — |
| 10 | Baja | Rutas `/api` inexistentes devolvían HTML. | 404 en JSON. | `seguridad.test.ts` |
| 11 | Baja | Un respaldo podía intentar escribirse sobre otro existente. | `respaldar` nunca sobrescribe. | `backup.test.ts` |

Revisado sin hallazgos: autorización por rol en todos los endpoints (RBAC + MFA), inmutabilidad por triggers (auditoría, notas firmadas, procedimientos realizados, recetas, consentimientos, liquidaciones, movimientos de inventario), cifrado AES-256-GCM de datos clínicos sensibles, contraseñas con bcrypt, refresh token rotativo con detección de reutilización, protección contra path traversal en archivos, neutralización de fórmulas en CSV, XSS (React escapa todo el contenido), pagos sin números de tarjeta (solo tokens).

## Riesgos aceptados

- **`npm audit`**: 3 alertas altas de `deepmerge-ts` dentro del CLI de Prisma (solo se ejecuta al migrar, no atiende peticiones). Se resuelve migrando a Prisma 7. El CI audita en nivel `critical`.
- **Datos de demostración en producción**: usuarios con contraseña conocida y secreto TOTP público. Es intencional para la presentación; en un uso real se elimina la semilla y `DEMO_MODE=false`.
- **Un solo proceso escritor**: la cadena de auditoría y SQLite suponen una sola instancia (el caso en Render).
- **Tokens en `sessionStorage`**: aceptable para el alcance; en producción real irían en cookies `HttpOnly`.

## Resultados

**Pruebas automatizadas:** 98 tests de API (Vitest + Supertest), todos en verde en el CI.

**Cobertura** (`npm run coverage -w api`): 94 % de líneas y 78 % de ramas en `api/src`. Endpoints críticos: autenticación 92–98 %, pacientes 100 %, expediente clínico 98 %, caja 95 %, citas 97 %, honorarios 92 %, presupuestos 93 %, inventario 96 %. Meta del SRS (≥ 80 %) cumplida.

**Carga** (`npm run carga -w api`, 150 conexiones concurrentes, 10 s por endpoint, equipo local):

| Endpoint | Antes de la corrección | Después |
|---|---|---|
| `GET /api/health` | 3 154 req/s · p99 113 ms | 3 205 req/s · p99 95 ms |
| `GET /api/pacientes` | 98 req/s · p99 1 902 ms | 590 req/s · p99 378 ms |
| Odontograma del paciente | 90 req/s · p99 2 037 ms · **filas de auditoría perdidas** | 729 req/s · p99 398 ms · 0 errores |
| Notas SOEP del paciente | 105 req/s · p99 1 523 ms | 768 req/s · p99 357 ms · 0 errores |

Con 150 usuarios concurrentes la lectura del expediente responde en menos de 0,4 s (p99), dentro de RNF-01 (< 1,5 s). El plan gratuito de Render tiene menos CPU, así que allí los tiempos serán mayores.

**Respaldo y restauración (RNF-02):** `npm run backup -w api` genera una copia consistente con `VACUUM INTO` y la verifica (`PRAGMA integrity_check` y conteos); `npm run restaurar -w api -- <archivo>` rechaza archivos corruptos. Probado restaurando sobre otra base: los datos y los triggers de inmutabilidad se conservan.

## Pendiente

- **DAST con OWASP ZAP** contra la URL de Render: requiere descargar la imagen Docker de ZAP (~1,5 GB). Comando listo: `docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://<tu-servicio>.onrender.com`.
- **Gestión de usuarios** desde la interfaz (la sección "Usuarios" del administrador es un marcador): los usuarios se crean hoy por la semilla.
- Ejecutar el guion de UAT (`docs/uat.md`) con el evaluador y firmar el acta.
