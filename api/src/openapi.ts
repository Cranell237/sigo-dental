const bearer = [{ bearerAuth: [] }];
const json = (schema: object) => ({ "application/json": { schema } });
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required });
const str = { type: "string" };

// OpenAPI 3 (entregable 8.2 del SRS). Se amplía a medida que se agregan módulos.
export const openapi = {
  openapi: "3.0.3",
  info: { title: "SIGO-Dental API", version: "0.1.0", description: "Sistema Integral de Gestión Odontológica" },
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths: {
    "/api/health": { get: { tags: ["Sistema"], summary: "Estado del servicio", responses: { 200: { description: "ok" } } } },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Paso 1: correo y contraseña. Si el usuario tiene MFA responde mfaRequired + mfaToken.",
        requestBody: { content: json(obj({ email: str, password: str }, ["email", "password"])) },
        responses: { 200: { description: "Sesión o desafío MFA" }, 401: { description: "Credenciales incorrectas" } },
      },
    },
    "/api/auth/login/mfa": {
      post: {
        tags: ["Auth"],
        summary: "Paso 2: código TOTP de 6 dígitos",
        requestBody: { content: json(obj({ mfaToken: str, code: str }, ["mfaToken", "code"])) },
        responses: { 200: { description: "Sesión (token de acceso 5 min + refreshToken)" }, 401: { description: "Código incorrecto" } },
      },
    },
    "/api/auth/mfa/setup": {
      post: { tags: ["Auth"], summary: "Genera el secreto TOTP", security: bearer, responses: { 200: { description: "secret y otpauthUrl" } } },
    },
    "/api/auth/mfa/enable": {
      post: {
        tags: ["Auth"],
        summary: "Activa MFA verificando un código",
        security: bearer,
        requestBody: { content: json(obj({ code: str }, ["code"])) },
        responses: { 200: { description: "Nueva sesión con MFA verificado" } },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rota el refresh token (expira a los 15 min de inactividad)",
        requestBody: { content: json(obj({ refreshToken: str }, ["refreshToken"])) },
        responses: { 200: { description: "Nueva sesión" }, 401: { description: "Expirado, revocado o reutilizado" } },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoca el refresh token",
        requestBody: { content: json(obj({ refreshToken: str }, ["refreshToken"])) },
        responses: { 204: { description: "Sesión cerrada" } },
      },
    },
    "/api/auth/me": { get: { tags: ["Auth"], summary: "Usuario actual y permisos", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/clinico": {
      get: {
        tags: ["Clínico"],
        summary: "Marcador de la Fase 2 (requiere clinico:leer y MFA). Cada acceso se audita.",
        security: bearer,
        responses: { 200: { description: "ok" }, 403: { description: "Sin permiso o MFA pendiente" } },
      },
    },
    "/api/auditoria": {
      get: { tags: ["Auditoría"], summary: "Últimas filas del log (admin/auditor)", security: bearer, responses: { 200: { description: "ok" } } },
    },
    "/api/auditoria/verificar": {
      get: { tags: ["Auditoría"], summary: "Verifica la cadena de hashes", security: bearer, responses: { 200: { description: "{ ok, brokenAt, total }" } } },
    },
  },
};
