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
    "/api/clinico/pacientes/{pid}/odontograma": { get: { tags: ["Expediente"], summary: "Hallazgos del odontograma con sus adendas (RF-03)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/clinico/pacientes/{pid}/hallazgos": { post: { tags: ["Expediente"], summary: "Registra un hallazgo (EXISTENTE o REQUERIDO). Caries, restauración y sellante van por superficie.", security: bearer, responses: { 201: { description: "Creado" }, 400: { description: "Diente o superficie inválidos" } } } },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}": {
      patch: { tags: ["Expediente"], summary: "Edita un hallazgo no realizado", security: bearer, responses: { 200: { description: "ok" }, 409: { description: "Ya realizado (RN-01)" } } },
      delete: { tags: ["Expediente"], summary: "Borra un hallazgo no realizado. Lo realizado nunca se borra (RN-01).", security: bearer, responses: { 204: { description: "Borrado" }, 409: { description: "Realizado" } } },
    },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}/realizar": { post: { tags: ["Expediente"], summary: "Marca un hallazgo REQUERIDO como realizado (solo odontólogo). Con procedimientoId y consultorioId descuenta los insumos de su receta en una sola transacción (409 STOCK_INSUFICIENTE si falta).", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}/adenda": { post: { tags: ["Expediente"], summary: "Adenda firmada (texto + contraseña) para corregir un procedimiento realizado", security: bearer, responses: { 201: { description: "Creada" }, 401: { description: "Contraseña incorrecta" } } } },
    "/api/clinico/pacientes/{pid}/periodontograma": {
      get: { tags: ["Expediente"], summary: "Exámenes periodontales con NIC calculado (RF-04)", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Expediente"], summary: "Nuevo examen: 6 sitios por diente, furca, movilidad y sangrado. Los exámenes no se editan.", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/clinico/pacientes/{pid}/notas": {
      get: { tags: ["Expediente"], summary: "Notas SOEP en orden cronológico inverso", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Expediente"], summary: "Nueva nota SOEP (cifrada en base de datos)", security: bearer, responses: { 201: { description: "Creada" } } },
    },
    "/api/clinico/pacientes/{pid}/notas/{nid}": { patch: { tags: ["Expediente"], summary: "Edita mientras no esté firmada ni venza el plazo (SOEP_LOCK_HOURS, 24 h)", security: bearer, responses: { 200: { description: "ok" }, 409: { description: "Bloqueada" } } } },
    "/api/clinico/pacientes/{pid}/notas/{nid}/firmar": { post: { tags: ["Expediente"], summary: "Firma la nota (re-autenticación con contraseña); queda inmutable", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/clinico/pacientes/{pid}/notas/{nid}/adenda": { post: { tags: ["Expediente"], summary: "Adenda firmada a una nota bloqueada", security: bearer, responses: { 201: { description: "Creada" } } } },
    "/api/consentimientos/plantillas": { get: { tags: ["Consentimientos"], summary: "Plantillas por procedimiento", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/consentimientos": {
      get: { tags: ["Consentimientos"], summary: "Consentimientos de un paciente (?patientId=)", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Consentimientos"], summary: "Genera un consentimiento (metodo FIRMA u OTP). Con OTP envía el código al paciente o a su tutor.", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/consentimientos/{id}/firmar": { post: { tags: ["Consentimientos"], summary: "Firma con trazo PNG (data URL) o código OTP; genera el PDF. Queda inmutable.", security: bearer, responses: { 200: { description: "Firmado" }, 401: { description: "OTP incorrecto" }, 410: { description: "OTP vencido" } } } },
    "/api/consentimientos/{id}/pdf": { get: { tags: ["Consentimientos"], summary: "PDF del consentimiento firmado", security: bearer, responses: { 200: { description: "application/pdf" } } } },
    "/api/recetas": {
      get: { tags: ["Recetas"], summary: "Recetas de un paciente (?patientId=)", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Recetas"], summary: "Emite una receta en PDF (solo odontólogo). 409 ALERGIA si el medicamento coincide con una alergia registrada, salvo confirmarAlergia.", security: bearer, responses: { 201: { description: "Emitida" }, 409: { description: "Alergia registrada" } } },
    },
    "/api/recetas/{id}/pdf": { get: { tags: ["Recetas"], summary: "PDF de la receta", security: bearer, responses: { 200: { description: "application/pdf" } } } },
    "/api/presupuestos": {
      get: { tags: ["Presupuestos"], summary: "Presupuestos de un paciente con totales (?patientId=)", security: bearer, responses: { 200: { description: "ok" } } },
      post: { tags: ["Presupuestos"], summary: "Crea un borrador por fases y sesiones (importes en centavos; el precio sale del catálogo). El descuento lo autoriza el odontólogo.", security: bearer, responses: { 201: { description: "Creado" } } },
    },
    "/api/presupuestos/agendables": { get: { tags: ["Presupuestos"], summary: "Ítems aprobados aún sin cita (?patientId=)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/presupuestos/{id}/presentar": { post: { tags: ["Presupuestos"], summary: "Presenta el borrador al paciente", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/presupuestos/{id}/aprobar": { post: { tags: ["Presupuestos"], summary: "Aprobación total (sin itemIds) o parcial (itemIds)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/presupuestos/items/{iid}/agendar": { post: { tags: ["Presupuestos"], summary: "Convierte un ítem aprobado en cita respetando RN-03", security: bearer, responses: { 201: { description: "Cita creada" }, 409: { description: "Sillón ocupado o ítem no agendable" } } } },
    "/api/inventario": { get: { tags: ["Inventario"], summary: "Insumos con stock por consultorio, lotes y alerta de mínimo (?consultorioId=)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/inventario/insumos": { post: { tags: ["Inventario"], summary: "Crea un insumo (admin). Costo unitario en centavos.", security: bearer, responses: { 201: { description: "Creado" } } } },
    "/api/inventario/entradas": { post: { tags: ["Inventario"], summary: "Ingresa un lote (suma si el lote ya existe)", security: bearer, responses: { 201: { description: "Lote" } } } },
    "/api/inventario/ajustes": { post: { tags: ["Inventario"], summary: "Ajuste por conteo físico, con motivo", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/inventario/movimientos": { get: { tags: ["Inventario"], summary: "Libro de movimientos (solo inserción)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/inventario/receta-consumo/{procedimientoId}": {
      get: { tags: ["Inventario"], summary: "Receta estándar de consumo del procedimiento", security: bearer, responses: { 200: { description: "ok" } } },
      put: { tags: ["Inventario"], summary: "Reemplaza la receta (admin)", security: bearer, responses: { 200: { description: "ok" } } },
    },
    "/api/honorarios/reglas": {
      get: { tags: ["Honorarios"], summary: "Reglas de un profesional", security: bearer, responses: { 200: { description: "ok" } } },
      put: { tags: ["Honorarios"], summary: "Define o reemplaza una regla: PORCENTAJE y PORCENTAJE_NETO en puntos básicos (4000 = 40 %), MONTO_FIJO en centavos (admin)", security: bearer, responses: { 200: { description: "ok" } } },
    },
    "/api/honorarios/previsualizar": { get: { tags: ["Honorarios"], summary: "Calcula la liquidación sin guardarla; lista lo que no tiene regla", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/honorarios/liquidar": { post: { tags: ["Honorarios"], summary: "Liquida los procedimientos pendientes del periodo. Cada uno se liquida una sola vez.", security: bearer, responses: { 201: { description: "Liquidación" }, 409: { description: "Nada que liquidar" } } } },
    "/api/honorarios/liquidaciones": { get: { tags: ["Honorarios"], summary: "Historial de liquidaciones", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/reportes/corte-caja": { get: { tags: ["Reportes"], summary: "Corte de caja por turno cerrado, con el cuadre de efectivo (?formato=csv para exportar)", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/reportes/honorarios": { get: { tags: ["Reportes"], summary: "Honorarios liquidados por profesional", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/reportes/inventario": { get: { tags: ["Reportes"], summary: "Inventario valorizado con alertas de mínimo y lotes por vencer", security: bearer, responses: { 200: { description: "ok" } } } },
    "/api/reportes/ausentismo": { get: { tags: ["Reportes"], summary: "Tasa de no-show por profesional", security: bearer, responses: { 200: { description: "ok" } } } },
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
