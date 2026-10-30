# Despliegue en Render — SIGO-Dental

Un solo **Web Service** de Node: Express sirve el API (`/api`) y el build de React. Render entrega HTTPS (TLS 1.2/1.3) y la app añade HSTS y el resto de cabeceras de seguridad (`helmet`).

## 1. Crear el servicio

**Opción A — Web Service manual (recomendada en el plan gratuito)**

1. En Render: **New → Web Service** → conecta tu GitHub y elige el repo `sigo-dental`. Si es privado, concede acceso a ese repositorio.
2. Configuración:

| Campo | Valor |
|---|---|
| Name | `sigo-dental` |
| Language / Runtime | Node |
| Branch | `main` |
| Root Directory | *(vacío)* |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path *(Advanced)* | `/api/health` |

3. **Environment Variables** (todas obligatorias; la app no arranca en producción si falta alguna):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `DATABASE_URL` | `file:./prod.db` |
| `JWT_SECRET` | botón **Generate** (o una cadena aleatoria larga) |
| `ENCRYPTION_KEY` | botón **Generate** (o una cadena aleatoria larga) |

Para generar una cadena aleatoria en tu equipo: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

4. **Create Web Service**. El primer deploy tarda unos 3–5 min.

**Opción B — Blueprint:** New → Blueprint → elige el repo; Render lee `render.yaml` y crea todo lo anterior. (Puede pedir un método de pago aunque el plan sea gratuito.)

## 2. Verificar

- `https://<tu-servicio>.onrender.com/api/health` → `{"status":"ok","db":"ok"}`
- `https://<tu-servicio>.onrender.com/` → pantalla de login.
- `https://<tu-servicio>.onrender.com/api/docs` → Swagger.
- Ingresa con `odontologo@sigo.test` / `Demo1234!` y el código TOTP del secreto `JBSWY3DPEHPK3PXP` (ver README).

## 3. Qué pasa en cada arranque

`npm start` ejecuta `prisma migrate deploy` → semilla de demostración (idempotente) → servidor. En el plan gratuito el disco es **efímero**: cada deploy o reinicio parte de una base nueva con los datos de demostración. Para conservar datos: Render Postgres (cambiar `provider` en `api/prisma/schema.prisma`) o un Persistent Disk (de pago) con `DATABASE_URL=file:/var/data/prod.db`.

El servicio gratuito se duerme tras 15 min sin tráfico (el primer acceso tarda ~30 s). Abre la URL un rato antes de la presentación. Los recordatorios se pueden disparar a mano desde **Agenda → Enviar recordatorios**.

## 4. Rollback

- **Código:** en Render → *Events* → elige un deploy anterior → **Rollback**. O en git: `git revert <commit>` y push a `main` (Render redeploya solo).
- **Datos (con disco persistente):** respaldo y restauración con los scripts del API:
  - `npm run backup -w api` → crea `api/backups/sigo-<fecha>.db` y verifica su integridad (no sobrescribe respaldos existentes).
  - `npm run restaurar -w api -- backups/<archivo>.db` → verifica el respaldo y lo copia sobre la base. Hacerlo con el servicio detenido.
- Si un deploy no pasa el health check, Render mantiene la versión anterior en línea.

## 5. Variables opcionales

| Variable | Por defecto | Uso |
|---|---|---|
| `DEMO_MODE` | `true` | Muestra el OTP del consentimiento en pantalla (canal simulado). Poner `false` fuera de la demo. |
| `MFA_ENFORCED` | `true` | MFA obligatorio para roles clínicos/financieros. |
| `SOEP_LOCK_HOURS` | `24` | Plazo de edición de una nota SOEP. |
| `MAX_INTENTOS_LOGIN` | `20` | Intentos de login/MFA por IP cada 15 min. |
| `UPLOADS_DIR` | `uploads` | Carpeta de PDFs (efímera en el plan gratuito). |
