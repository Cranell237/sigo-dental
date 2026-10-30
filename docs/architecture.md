# Arquitectura — SIGO-Dental

Versión simplificada de la arquitectura sugerida en el SRS §7 (proyecto académico): un **monolito modular** en lugar de microservicios.

| SRS §7 | Implementación |
|---|---|
| Cliente web (React + Tailwind) | `web/`: React + Vite + TypeScript + Tailwind |
| API Gateway / Ingress, JWT sobre HTTPS | Un solo Express (`api/`); Render termina TLS |
| Servicio clínico/agenda y facturación/stock | Módulos por carpeta dentro de `api/src` |
| PostgreSQL / MySQL | SQLite + Prisma (migrable cambiando `provider`) |
| Redis (cache y mensajería) | `node-cron` (recordatorios) |
| S3 / Blob | `uploads/` detrás de una interfaz `Storage` |

```
Navegador (React) ──HTTPS──▶ Express ──▶ Prisma ──▶ SQLite
                              │  ├─ /api/auth       login, MFA, refresh
                              │  ├─ /api/clinico    (Fase 2)
                              │  ├─ /api/auditoria  solo lectura
                              │  └─ /api/docs       Swagger
                              └─ sirve web/dist en producción (un solo servicio)
```

## Seguridad transversal (Fase 0)

- **RBAC (RNF-05):** matriz rol → permisos en `api/src/roles.ts`; la guarda `requirePermission` se aplica por endpoint y el frontend solo muestra las secciones permitidas.
- **Autenticación:** contraseña (bcrypt) + TOTP. Roles clínicos/financieros (odontólogo, asistente, recepcionista, auditor) tienen MFA obligatorio: sin él, `authenticate` responde 403 `MFA_REQUIRED` y solo pueden enrolarlo.
- **Sesión:** token de acceso de 5 min + refresh token opaco, rotativo y guardado como hash. Reutilizar un token ya rotado revoca todas las sesiones del usuario. El refresh expira a los 15 min de inactividad y el frontend cierra la sesión por inactividad.
- **Auditoría (RNF-06):** tabla `AuditLog` solo de inserción. Triggers de SQLite rechazan `UPDATE`/`DELETE`; cada fila guarda el hash de la anterior (`/api/auditoria/verificar` recorre la cadena). Se registran logins y todo acceso a `/api/clinico`.
- **Cifrado (RNF-04):** AES-256-GCM (`api/src/crypto.ts`) para campos sensibles; hoy cifra el secreto TOTP. La clave sale de `ENCRYPTION_KEY`.

## Decisiones y límites conocidos

- Los tokens se guardan en `sessionStorage` (se pierden al cerrar la pestaña). Es aceptable para el alcance académico; en producción real irían en cookies `HttpOnly`.
- Las pruebas usan una base SQLite aparte (`api/test.db`) que se migra y siembra en `globalSetup`.
- `npm audit` marca `deepmerge-ts` (dependencia del CLI de Prisma, solo en migraciones). Se acepta hasta migrar a Prisma 7; el CI audita en nivel `critical`.
- CodeQL solo corre si el repositorio es público.
- El secreto TOTP de la demo es fijo y público (`README`); no usar fuera de pruebas.
