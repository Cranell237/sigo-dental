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
    "/api/pacientes": {
      get: { tags: ["Pacientes"], summary: "Busca por cédula o nombre (?q=). Incluye alertas críticas.", security: bearer, responses: { 200: { description: "ok" } } },
      post: {
        tags: ["Pacientes"],
        summary: "Alta con anamnesis obligatoria; los menores requieren tutor legal (RF-01, RF-02)",
        security: bearer,
        responses: { 201: { description: "Creado" }, 400: { description: "Datos inválidos" }, 409: { description: "Cédula duplicada" } },
      },
    },
    "/api/pacientes/{id}": {
      get: { tags: ["Pacientes"], summary: "Ficha; el detalle de anamnesis solo con acceso clínico", security: bearer, responses: { 200: { description: "ok" }, 404: { description: "No existe" } } },
      patch: { tags: ["Pacientes"], summary: "Modifica datos demográficos", security: bearer, responses: { 200: { description: "ok" } } },
    },
    "/api/pacientes/{id}/anamnesis": {
      put: { tags: ["Pacientes"], summary: "Actualiza la anamnesis", security: bearer, responses: { 200: { description: "ok" } } },
    },
    "/api/catalogos/consultorios": {
      get: { tags: ["Catálogos"], summary: "Consultorios con sus sillones", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Catálogos"], summary: "Crea un consultorio (admin)", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/catalogos/consultorios/{id}/sillones": {
      post: { tags: ["Catálogos"], summary: "Agrega un sillón (admin)", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/catalogos/profesionales": {
      get: { tags: ["Catálogos"], summary: "Profesionales y especialidades", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Catálogos"], summary: "Crea un profesional (admin)", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/catalogos/procedimientos": {
      get: { tags: ["Catálogos"], summary: "Procedimientos con precio base en centavos", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Catálogos"], summary: "Crea un procedimiento (admin)", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/citas": {
      get: { tags: ["Agenda"], summary: "Citas entre desde y hasta (día/semana), filtrables por sillón y profesional", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Agenda"], summary: "Agenda una cita. 409 si el sillón está ocupado (RN-03)", security: bearer, responses: { 201: { description: "Creada" }, 409: { description: "Sillón ocupado" } } },
    },
    "/api/citas/{id}/estado": {
      patch: { tags: ["Agenda"], summary: "Cambia el estado respetando las transiciones válidas (RF-10)", security: bearer, responses: { 200: { description: "ok" }, 409: { description: "Transición no permitida" } } },
    },
    "/api/caja/apertura": { post: { tags: ["Caja"], summary: "Abre el turno de caja con el fondo inicial (centavos)", security: bearer, responses: { 201: { description: "Turno abierto" }, 409: { description: "Ya hay un turno abierto" } } } },
    "/api/caja/turno": { get: { tags: ["Caja"], summary: "Turno abierto del cajero. No expone totales (RN-02).", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/caja/cobros": {
      post: {
        tags: ["Caja"],
        summary: "Cobro con pagos mixtos. El total se calcula en el servidor y los pagos deben sumarlo al centavo. Emite factura XML simulada.",
        security: bearer,
        responses: { 201: { description: "Cobro y factura" }, 400: { description: "Pagos no cuadran" }, 409: { description: "Sin turno abierto" } },
      },
    },
    "/api/caja/cobros/{id}": { get: { tags: ["Caja"], summary: "Comprobante interno", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/caja/cobros/{id}/factura.xml": { get: { tags: ["Caja"], summary: "XML del comprobante electrónico (autorización simulada)", security: bearer, responses: { 200: { description: "application/xml" } } } },
    "/api/caja/cierre": {
      post: {
        tags: ["Caja"],
        summary: "Cierre ciego: recibe el conteo físico y solo entonces revela el efectivo teórico y la diferencia (RN-02)",
        security: bearer,
        requestBody: { content: json(obj({ conteoEfectivo: { type: "integer" } }, ["conteoEfectivo"])) },
        responses: { 200: { description: "Turno cerrado con diferencia" } },
      },
    },
    "/api/recordatorios": { get: { tags: ["Agenda"], summary: "Bitácora de recordatorios enviados", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/recordatorios/ejecutar": { post: { tags: ["Agenda"], summary: "Ejecuta a mano el envío de recordatorios 48 h / 24 h (también corre cada hora con node-cron)", security: bearer, responses: { 200: { description: "{ revisadas, enviados }" } } } },
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
