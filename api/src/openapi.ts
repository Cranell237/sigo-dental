// Especificación OpenAPI 3.0.3 del API de SIGO-Dental (entregable 8.2 del SRS).
// Se sirve en /api/docs (Swagger UI) y /api/docs/openapi.json, y se exporta a docs/openapi.json
// con `npm run openapi -w api`.

type Schema = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = (extra: Schema = {}): Schema => ({ type: "string", ...extra });
const int = (description?: string, extra: Schema = {}): Schema => ({ type: "integer", ...(description ? { description } : {}), ...extra });
const bool = { type: "boolean" };
const fecha = { type: "string", format: "date-time" };
const centavos = (description = "Importe en centavos (entero)") => int(description, { minimum: 0, example: 4500 });
const arr = (items: Schema) => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, ...(required.length ? { required } : {}), ...extra });
const json = (schema: Schema) => ({ "application/json": { schema } });

const R = {
  400: { $ref: "#/components/responses/Invalido" },
  401: { $ref: "#/components/responses/NoAutenticado" },
  403: { $ref: "#/components/responses/SinPermiso" },
  404: { $ref: "#/components/responses/NoEncontrado" },
  409: { $ref: "#/components/responses/Conflicto" },
};

interface Op {
  summary: string;
  description?: string;
  body?: Schema;
  ok?: Schema;
  okStatus?: number;
  okDescription?: string;
  okContent?: Record<string, unknown>;
  params?: string[]; // nombres en components.parameters
  errors?: (keyof typeof R)[];
  extra?: Record<string, unknown>; // respuestas adicionales
  publico?: boolean;
}

function op(tag: string, o: Op) {
  const status = o.okStatus ?? 200;
  const responses: Record<string, unknown> = {
    [status]: { description: o.okDescription ?? "Operación correcta", ...(o.okContent ? { content: o.okContent } : o.ok ? { content: json(o.ok) } : {}) },
    ...Object.fromEntries((o.errors ?? []).map((e) => [e, R[e]])),
    ...(o.extra ?? {}),
  };
  if (!o.publico) Object.assign(responses, { 401: R[401], 403: R[403] });
  return {
    tags: [tag],
    summary: o.summary,
    ...(o.description ? { description: o.description } : {}),
    ...(o.publico ? { security: [] } : {}),
    ...(o.params ? { parameters: o.params.map((p) => ({ $ref: `#/components/parameters/${p}` })) } : {}),
    ...(o.body ? { requestBody: { required: true, content: json(o.body) } } : {}),
    responses,
  };
}

// ---------- Esquemas ----------

const schemas: Record<string, Schema> = {
  Error: obj({ error: str({ example: "Sin permiso" }), code: str({ description: "Código de negocio opcional (MFA_REQUIRED, ALERGIA, STOCK_INSUFICIENTE)" }) }, ["error"]),
  Rol: str({ enum: ["ADMIN", "ODONTOLOGO", "RECEPCIONISTA", "ASISTENTE", "AUDITOR"] }),
  Usuario: obj({ id: str(), name: str(), email: str({ format: "email" }), role: ref("Rol") }),
  Sesion: obj(
    {
      token: str({ description: "JWT de acceso (5 min). Enviar como `Authorization: Bearer <token>`." }),
      refreshToken: str({ description: "Token opaco y rotativo; expira tras 15 min de inactividad." }),
      user: ref("Usuario"),
      mfaEnrollRequired: { ...bool, description: "true si el rol exige MFA y aún no lo activó: solo puede enrolarse." },
    },
    ["token", "refreshToken", "user"],
  ),
  DesafioMfa: obj({ mfaRequired: { type: "boolean", enum: [true] }, mfaToken: str({ description: "Token temporal (5 min) para el paso 2." }) }, ["mfaRequired", "mfaToken"]),
  Me: obj({ id: str(), name: str(), email: str(), role: ref("Rol"), permissions: arr(str()), mfaEnabled: bool, mfaVerified: bool }),

  AnamnesisEntrada: obj(
    {
      alergias: { ...arr(str()), description: "Alergias a fármacos; lista vacía si no tiene.", example: ["Penicilina"] },
      anticoagulado: bool,
      coagulopatia: bool,
      enfermedades: str({ description: "Enfermedades sistémicas" }),
      cirugias: str({ description: "Antecedentes quirúrgicos" }),
      observaciones: str({ description: "Se guarda cifrada (AES-256-GCM)" }),
    },
    ["alergias", "anticoagulado", "coagulopatia"],
  ),
  PacienteEntrada: obj(
    {
      cedula: str({ example: "1712345678" }),
      nombres: str({ example: "Ana" }),
      apellidos: str({ example: "Pérez" }),
      fechaNacimiento: str({ format: "date", example: "1990-05-10" }),
      sexo: str({ enum: ["F", "M", "O"] }),
      telefono: str({ example: "0991234567" }),
      email: str({ format: "email" }),
      direccion: str(),
      emergenciaNombre: str(),
      emergenciaTelefono: str(),
      tutorNombre: str({ description: "Obligatorio (con cédula y teléfono) si el paciente es menor de edad" }),
      tutorCedula: str(),
      tutorTelefono: str(),
      seguro: str(),
      convenio: str(),
    },
    ["cedula", "nombres", "apellidos", "fechaNacimiento", "sexo", "telefono", "emergenciaNombre", "emergenciaTelefono"],
  ),
  PacienteNuevo: { allOf: [ref("PacienteEntrada"), obj({ anamnesis: ref("AnamnesisEntrada") }, ["anamnesis"])] },
  Paciente: {
    allOf: [
      ref("PacienteEntrada"),
      obj({
        id: str(),
        esMenor: bool,
        alertas: { ...arr(str()), description: "Alertas críticas para el badge (RF-02)", example: ["Alergia: Penicilina", "Anticoagulado"] },
        anamnesis: { ...ref("AnamnesisEntrada"), description: "Solo para roles con acceso clínico" },
      }),
    ],
  },

  Consultorio: obj({ id: str(), nombre: str(), sillones: arr(obj({ id: str(), nombre: str(), consultorioId: str() })) }),
  Profesional: obj({ id: str(), nombre: str(), especialidad: str(), userId: str({ nullable: true }) }),
  Procedimiento: obj({ id: str(), codigo: str({ example: "REST" }), nombre: str({ example: "Restauración con resina" }), precioBase: centavos("Precio base en centavos") }),

  EstadoCita: str({ enum: ["PROGRAMADO", "CONFIRMADO", "EN_SALA_ESPERA", "EN_ATENCION", "ATENDIDO", "CANCELADO", "NO_ASISTIO"] }),
  CitaNueva: obj(
    { patientId: str(), profesionalId: str(), sillonId: str(), inicio: fecha, fin: fecha, motivo: str() },
    ["patientId", "profesionalId", "sillonId", "inicio", "fin"],
  ),
  Cita: obj({
    id: str(),
    inicio: fecha,
    fin: fecha,
    estado: ref("EstadoCita"),
    motivo: str({ nullable: true }),
    patient: obj({ id: str(), nombres: str(), apellidos: str() }),
    profesional: ref("Profesional"),
    sillon: obj({ id: str(), nombre: str(), consultorio: obj({ nombre: str() }) }),
  }),

  MetodoPago: str({ enum: ["EFECTIVO", "TARJETA_CREDITO", "TARJETA_DEBITO", "TRANSFERENCIA", "SEGURO", "PASARELA"] }),
  Turno: obj({
    id: str(),
    estado: str({ enum: ["ABIERTA", "CERRADA"] }),
    fondoInicial: centavos(),
    abiertaAt: fecha,
    conteoEfectivo: { ...centavos(), description: "Solo tras el cierre" },
    totalTeorico: { ...centavos(), description: "Solo tras el cierre (cierre ciego, RN-02)" },
    diferencia: int("Conteo − teórico, en centavos. Solo tras el cierre."),
  }),
  CobroNuevo: obj(
    {
      patientId: str(),
      lineas: arr(obj({ procedimientoId: str(), cantidad: int(undefined, { minimum: 1 }) }, ["procedimientoId", "cantidad"])),
      pagos: arr(
        obj(
          {
            metodo: ref("MetodoPago"),
            monto: centavos(),
            referencia: str(),
            token: str({ description: "Solo PASARELA. Token del proveedor; en la simulación: tok_visa, tok_mastercard (aprueban), tok_declined, tok_sinfondos (rechazan).", example: "tok_visa" }),
          },
          ["metodo", "monto"],
        ),
      ),
      facturar: { ...bool, default: true },
    },
    ["patientId", "lineas", "pagos"],
  ),
  Cobro: obj({
    id: int(),
    total: centavos(),
    lineas: arr(obj({ descripcion: str(), cantidad: int(), precioUnitario: centavos() })),
    pagos: arr(obj({ metodo: ref("MetodoPago"), monto: centavos(), referencia: str({ nullable: true }) })),
    factura: obj({ secuencial: int(), claveAcceso: str({ description: "Clave de acceso de 49 dígitos (módulo 11)" }), estado: str({ example: "AUTORIZADO" }), numeroAutorizacion: str() }),
  }),

  TipoHallazgo: str({ enum: ["CARIES", "RESTAURACION", "ENDODONCIA", "IMPLANTE", "PROTESIS_FIJA", "PROTESIS_REMOVIBLE", "EXODONCIA", "SELLANTE", "AUSENTE"] }),
  HallazgoNuevo: obj(
    {
      diente: str({ description: "Numeración FDI (11–48 permanentes, 51–85 temporales)", example: "16" }),
      superficie: str({ enum: ["M", "D", "O", "V", "L"], description: "Obligatoria para CARIES, RESTAURACION y SELLANTE; omitir para hallazgos de diente completo" }),
      tipo: ref("TipoHallazgo"),
      estado: str({ enum: ["EXISTENTE", "REQUERIDO"] }),
      nota: str(),
    },
    ["diente", "tipo", "estado"],
  ),
  Adenda: obj({ id: str(), texto: str(), autorId: str(), firmaHash: str({ description: "Sello HMAC-SHA256 de la firma" }), createdAt: fecha }),
  Hallazgo: obj({
    id: str(),
    diente: str(),
    superficie: str({ nullable: true }),
    tipo: ref("TipoHallazgo"),
    estado: str({ enum: ["EXISTENTE", "REQUERIDO", "REALIZADO"] }),
    nota: str({ nullable: true }),
    realizadoAt: { ...fecha, nullable: true },
    procedimientoId: str({ nullable: true }),
    adendas: arr(ref("Adenda")),
  }),
  Firma: obj({ password: str({ format: "password", description: "Re-autenticación del profesional para firmar" }) }, ["password"]),
  AdendaNueva: obj({ texto: str({ minLength: 5 }), password: str({ format: "password" }) }, ["texto", "password"]),

  PuntoPerio: obj(
    {
      punto: str({ enum: ["DV", "V", "MV", "DL", "L", "ML"] }),
      profundidad: int("Profundidad al sondaje (mm)", { minimum: 0, maximum: 15 }),
      margen: int("Recesión gingival (mm); negativa si el margen cubre el límite amelocementario", { minimum: -10, maximum: 15 }),
      sangrado: bool,
      nic: int("Nivel de inserción clínica = profundidad + recesión (solo en respuestas)"),
    },
    ["punto", "profundidad", "margen", "sangrado"],
  ),
  PerioExamen: obj({
    id: str(),
    createdAt: fecha,
    dientes: arr(obj({ diente: str(), puntos: arr(ref("PuntoPerio")), furca: int(undefined, { minimum: 0, maximum: 3 }), movilidad: int(undefined, { minimum: 0, maximum: 3 }) })),
  }),

  NotaNueva: obj({ subjetivo: str(), objetivo: str(), evaluacion: str(), plan: str(), appointmentId: str() }, ["subjetivo", "objetivo", "evaluacion", "plan"]),
  Nota: obj({
    id: str(),
    subjetivo: str(),
    objetivo: str(),
    evaluacion: str(),
    plan: str(),
    autorId: str(),
    createdAt: fecha,
    firmada: bool,
    bloqueada: { ...bool, description: "Firmada o vencido el plazo de edición (SOEP_LOCK_HOURS, 24 h)" },
    bloqueaEn: fecha,
    adendas: arr(ref("Adenda")),
  }),

  Consentimiento: obj({
    id: str(),
    patientId: str(),
    titulo: str(),
    texto: str(),
    metodo: str({ enum: ["FIRMA", "OTP"] }),
    estado: str({ enum: ["PENDIENTE", "FIRMADO"] }),
    firmanteNombre: str({ nullable: true, description: "Paciente o tutor legal si es menor" }),
    pdfHash: str({ nullable: true }),
    createdAt: fecha,
    firmadoAt: { ...fecha, nullable: true },
    otpDemo: str({ description: "Solo con DEMO_MODE: el OTP enviado por el canal simulado" }),
  }),
  ItemReceta: obj({ medicamento: str({ example: "Ibuprofeno 400 mg" }), dosis: str({ example: "1 tableta" }), frecuencia: str({ example: "cada 8 horas" }), duracion: str({ example: "3 días" }), indicaciones: str() }, ["medicamento", "dosis", "frecuencia", "duracion"]),
  Receta: obj({ id: str(), patientId: str(), diagnostico: str({ nullable: true }), items: arr(ref("ItemReceta")), createdAt: fecha }),

  PresupuestoNuevo: obj(
    {
      patientId: str(),
      descuento: { ...centavos("Descuento autorizado en centavos (solo el odontólogo)"), default: 0 },
      items: arr(
        obj(
          {
            fase: int(undefined, { minimum: 1 }),
            sesion: int(undefined, { minimum: 1 }),
            procedimientoId: str(),
            diente: str(),
            cantidad: int(undefined, { minimum: 1, default: 1 }),
            honorario: { ...centavos("Honorario del profesional por unidad (≤ precio)"), default: 0 },
            costoLaboratorio: { ...centavos("Costo de laboratorio en centavos"), default: 0 },
          },
          ["fase", "sesion", "procedimientoId"],
        ),
      ),
    },
    ["patientId", "items"],
  ),
  Presupuesto: obj({
    id: str(),
    patientId: str(),
    estado: str({ enum: ["BORRADOR", "PRESENTADO", "APROBADO", "APROBADO_PARCIAL", "RECHAZADO"] }),
    descuento: centavos(),
    items: arr(
      obj({
        id: str(),
        fase: int(),
        sesion: int(),
        descripcion: str(),
        diente: str({ nullable: true }),
        cantidad: int(),
        precioUnitario: centavos(),
        honorario: centavos(),
        costoLaboratorio: centavos(),
        estado: str({ enum: ["PENDIENTE", "APROBADO", "RECHAZADO", "AGENDADO"] }),
        appointmentId: str({ nullable: true }),
      }),
    ),
    totales: obj({ subtotal: centavos(), descuento: centavos(), total: centavos(), subtotalAprobado: centavos(), totalAprobado: centavos(), porFase: { type: "object", additionalProperties: { type: "integer" } } }),
  }),

  Insumo: obj({
    id: str(),
    codigo: str(),
    nombre: str(),
    unidad: str(),
    stockMinimo: int(),
    costoUnitario: centavos(),
    stock: int("Saldo en el consultorio consultado"),
    bajoMinimo: bool,
    lotes: arr(obj({ id: str(), lote: str(), vence: { ...fecha, nullable: true }, cantidad: int() })),
  }),
  ReglaHonorario: obj(
    {
      profesionalId: str(),
      procedimientoId: str({ description: "Omitir para la regla general del profesional" }),
      modalidad: str({ enum: ["PORCENTAJE", "MONTO_FIJO", "PORCENTAJE_NETO"] }),
      valor: int("PORCENTAJE y PORCENTAJE_NETO: puntos básicos (4000 = 40 %). MONTO_FIJO: centavos.", { minimum: 0, example: 4000 }),
    },
    ["profesionalId", "modalidad", "valor"],
  ),
  Liquidacion: obj({
    id: str(),
    profesionalId: str(),
    desde: fecha,
    hasta: fecha,
    total: centavos(),
    lineas: arr(obj({ realizadoId: str(), descripcion: str(), base: centavos(), modalidad: str(), valor: int(), comision: centavos() })),
  }),
  Periodo: obj({ profesionalId: str(), desde: fecha, hasta: fecha }, ["profesionalId", "desde", "hasta"]),
  Reporte: obj({ resumen: { type: "object", additionalProperties: true }, filas: arr({ type: "object", additionalProperties: true }) }),
  RegistroAuditoria: obj({
    id: int(),
    timestamp: str({ format: "date-time", description: "ISO-8601" }),
    userId: str({ nullable: true }),
    action: str({ example: "READ" }),
    resource: str({ example: "clinico" }),
    resourceId: str({ nullable: true }),
    ip: str({ nullable: true }),
    prevHash: str(),
    hash: str({ description: "SHA-256 encadenado con la fila anterior" }),
  }),
};

const parameters = {
  pid: { name: "pid", in: "path", required: true, description: "Id del paciente", schema: str() },
  id: { name: "id", in: "path", required: true, description: "Id del recurso", schema: str() },
  idCobro: { name: "id", in: "path", required: true, description: "Número del cobro", schema: int() },
  hid: { name: "hid", in: "path", required: true, description: "Id del hallazgo", schema: str() },
  nid: { name: "nid", in: "path", required: true, description: "Id de la nota", schema: str() },
  iid: { name: "iid", in: "path", required: true, description: "Id del ítem del presupuesto", schema: str() },
  procedimientoId: { name: "procedimientoId", in: "path", required: true, schema: str() },
  patientId: { name: "patientId", in: "query", required: true, schema: str() },
  consultorioId: { name: "consultorioId", in: "query", required: true, schema: str() },
  profesionalIdQ: { name: "profesionalId", in: "query", required: false, schema: str() },
  profesionalIdReq: { name: "profesionalId", in: "query", required: true, schema: str() },
  sillonIdQ: { name: "sillonId", in: "query", required: false, schema: str() },
  insumoIdQ: { name: "insumoId", in: "query", required: false, schema: str() },
  consultorioIdQ: { name: "consultorioId", in: "query", required: false, schema: str() },
  q: { name: "q", in: "query", required: false, description: "Cédula, nombres o apellidos", schema: str() },
  desde: { name: "desde", in: "query", required: true, schema: fecha },
  hasta: { name: "hasta", in: "query", required: true, schema: fecha },
  limit: { name: "limit", in: "query", required: false, schema: int(undefined, { maximum: 500, default: 100 }) },
  formato: { name: "formato", in: "query", required: false, description: "csv para exportar las filas", schema: str({ enum: ["json", "csv"], default: "json" }) },
};

const errorResp = (description: string) => ({ description, content: json(ref("Error")) });
const pdf = { "application/pdf": { schema: { type: "string", format: "binary" } } };
const reporte = { "application/json": { schema: ref("Reporte") }, "text/csv": { schema: str() } };

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "SIGO-Dental API",
    version: "1.0.0",
    description: [
      "API REST del Sistema Integral de Gestión Odontológica y Expediente Clínico Digital.",
      "",
      "**Autenticación:** `POST /api/auth/login` (correo y contraseña). Los roles clínicos y financieros tienen MFA obligatorio: el login devuelve `mfaRequired` y un `mfaToken`, y la sesión se obtiene con `POST /api/auth/login/mfa` y el código TOTP. Las demás rutas usan `Authorization: Bearer <token>`.",
      "",
      "**Convenciones:** importes en **centavos** (enteros), porcentajes de honorarios en **puntos básicos**, fechas ISO-8601 en UTC, dientes en numeración **FDI**. Los errores devuelven `{ \"error\": \"…\" }`.",
      "",
      "**Roles:** ADMIN, ODONTOLOGO, RECEPCIONISTA, ASISTENTE, AUDITOR. Cada operación indica el permiso requerido; sin él responde 403.",
      "",
      "**Auditoría:** todo acceso a datos clínicos, pacientes, caja, inventario y reportes queda en un log inmutable con hash encadenado.",
    ].join("\n"),
    contact: { name: "SIGO-Dental", url: "https://github.com/Cranell237/sigo-dental" },
  },
  servers: [
    { url: "/", description: "Este servidor" },
    { url: "https://sigo-dental-iyr0.onrender.com", description: "Producción (Render)" },
  ],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Sistema" },
    { name: "Auth", description: "Login, MFA TOTP y sesión (RNF-05)" },
    { name: "Pacientes", description: "Ficha única y anamnesis (RF-01, RF-02)" },
    { name: "Catálogos", description: "Consultorios, sillones, profesionales y procedimientos" },
    { name: "Agenda", description: "Citas, estados y recordatorios (RF-09, RF-10, RF-11, RN-03)" },
    { name: "Caja", description: "Cobros, cierre ciego, facturación y pasarela (RF-12, RN-02)" },
    { name: "Expediente", description: "Odontograma, periodontograma y notas SOEP (RF-03, RF-04, RF-05, RN-01)" },
    { name: "Consentimientos", description: "Consentimiento informado digital (RF-06)" },
    { name: "Recetas" },
    { name: "Presupuestos", description: "Presupuestos por fases y aprobación (RF-07, RF-08)" },
    { name: "Inventario", description: "Insumos, lotes y descargo automático (RF-14)" },
    { name: "Honorarios", description: "Liquidación de honorarios (RF-13)" },
    { name: "Reportes" },
    { name: "Auditoría", description: "Log inmutable (RNF-06)" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas,
    parameters,
    responses: {
      Invalido: errorResp("Datos inválidos"),
      NoAutenticado: errorResp("Falta el token o expiró"),
      SinPermiso: errorResp("El rol no tiene permiso, o falta verificar MFA (code MFA_REQUIRED)"),
      NoEncontrado: errorResp("No existe"),
      Conflicto: errorResp("Regla de negocio violada"),
    },
  },
  paths: {
    "/api/health": { get: op("Sistema", { summary: "Estado del servicio y de la base de datos (RNF-02)", publico: true, ok: obj({ status: str({ example: "ok" }), db: str({ example: "ok" }) }), extra: { 503: errorResp("Base de datos sin conexión") } }) },

    // ---------- Auth ----------
    "/api/auth/login": {
      post: op("Auth", {
        summary: "Paso 1: correo y contraseña",
        description: "Devuelve la sesión, o un desafío MFA si el usuario tiene MFA activo. Limitado a 20 intentos por IP cada 15 min.",
        publico: true,
        body: obj({ email: str({ format: "email", example: "odontologo@sigo.test" }), password: str({ format: "password", example: "Demo1234!" }) }, ["email", "password"]),
        okContent: json({ oneOf: [ref("Sesion"), ref("DesafioMfa")] }),
        errors: [400],
        extra: { 401: errorResp("Credenciales incorrectas"), 429: errorResp("Demasiados intentos") },
      }),
    },
    "/api/auth/login/mfa": {
      post: op("Auth", {
        summary: "Paso 2: código TOTP de 6 dígitos",
        publico: true,
        body: obj({ mfaToken: str(), code: str({ pattern: "^\\d{6}$", example: "123456" }) }, ["mfaToken", "code"]),
        ok: ref("Sesion"),
        errors: [400],
        extra: { 401: errorResp("Código incorrecto o sesión MFA vencida"), 429: errorResp("Demasiados intentos") },
      }),
    },
    "/api/auth/mfa/setup": { post: op("Auth", { summary: "Genera el secreto TOTP para enrolar MFA", ok: obj({ secret: str(), otpauthUrl: str() }), errors: [409] }) },
    "/api/auth/mfa/enable": { post: op("Auth", { summary: "Activa MFA verificando un código; devuelve una sesión con MFA verificado", body: obj({ code: str() }, ["code"]), ok: ref("Sesion"), errors: [400] }) },
    "/api/auth/refresh": {
      post: op("Auth", {
        summary: "Rota el refresh token",
        description: "Cada uso entrega uno nuevo. Reutilizar uno ya rotado revoca todas las sesiones del usuario.",
        publico: true,
        body: obj({ refreshToken: str() }, ["refreshToken"]),
        ok: ref("Sesion"),
        extra: { 401: errorResp("Expirado por inactividad, revocado o reutilizado") },
      }),
    },
    "/api/auth/logout": { post: op("Auth", { summary: "Revoca el refresh token", publico: true, body: obj({ refreshToken: str() }, ["refreshToken"]), okStatus: 204, okDescription: "Sesión cerrada" }) },
    "/api/auth/me": { get: op("Auth", { summary: "Usuario actual y sus permisos", ok: ref("Me") }) },

    // ---------- Pacientes ----------
    "/api/pacientes": {
      get: op("Pacientes", { summary: "Busca pacientes (permiso pacientes:leer)", params: ["q"], ok: arr(ref("Paciente")) }),
      post: op("Pacientes", { summary: "Alta con anamnesis obligatoria (pacientes:escribir)", body: ref("PacienteNuevo"), okStatus: 201, ok: ref("Paciente"), errors: [400, 409] }),
    },
    "/api/pacientes/{id}": {
      get: op("Pacientes", { summary: "Ficha del paciente", params: ["id"], ok: ref("Paciente"), errors: [404] }),
      patch: op("Pacientes", { summary: "Modifica datos demográficos", params: ["id"], body: ref("PacienteEntrada"), ok: ref("Paciente"), errors: [400, 404] }),
    },
    "/api/pacientes/{id}/anamnesis": { put: op("Pacientes", { summary: "Actualiza la anamnesis (pacientes:escribir o clinico:escribir)", params: ["id"], body: ref("AnamnesisEntrada"), ok: ref("Paciente"), errors: [400, 404] }) },

    // ---------- Catálogos ----------
    "/api/catalogos/consultorios": {
      get: op("Catálogos", { summary: "Consultorios con sus sillones", ok: arr(ref("Consultorio")) }),
      post: op("Catálogos", { summary: "Crea un consultorio (catalogos:gestionar)", body: obj({ nombre: str() }, ["nombre"]), okStatus: 201, ok: ref("Consultorio"), errors: [400, 409] }),
    },
    "/api/catalogos/consultorios/{id}/sillones": { post: op("Catálogos", { summary: "Agrega un sillón", params: ["id"], body: obj({ nombre: str() }, ["nombre"]), okStatus: 201, errors: [400, 404, 409] }) },
    "/api/catalogos/profesionales": {
      get: op("Catálogos", { summary: "Profesionales", ok: arr(ref("Profesional")) }),
      post: op("Catálogos", { summary: "Crea un profesional", body: obj({ nombre: str(), especialidad: str(), userId: str() }, ["nombre", "especialidad"]), okStatus: 201, ok: ref("Profesional"), errors: [400] }),
    },
    "/api/catalogos/procedimientos": {
      get: op("Catálogos", { summary: "Procedimientos con precio base", ok: arr(ref("Procedimiento")) }),
      post: op("Catálogos", { summary: "Crea un procedimiento", body: obj({ codigo: str(), nombre: str(), precioBase: centavos() }, ["codigo", "nombre", "precioBase"]), okStatus: 201, ok: ref("Procedimiento"), errors: [400, 409] }),
    },

    // ---------- Agenda ----------
    "/api/citas": {
      get: op("Agenda", { summary: "Citas del periodo (vista día o semana), filtrables por sillón y profesional (agenda:leer)", params: ["desde", "hasta", "sillonIdQ", "profesionalIdQ"], ok: arr(ref("Cita")), errors: [400] }),
      post: op("Agenda", { summary: "Agenda una cita (agenda:gestionar)", description: "RN-03: rechaza la cita si el sillón está ocupado en ese horario, aunque el profesional sea otro. Validado en transacción (seguro ante peticiones concurrentes).", body: ref("CitaNueva"), okStatus: 201, ok: ref("Cita"), errors: [400, 404, 409] }),
    },
    "/api/citas/{id}/estado": {
      patch: op("Agenda", {
        summary: "Cambia el estado de la cita (RF-10)",
        description: "Transiciones válidas: PROGRAMADO→CONFIRMADO|CANCELADO|NO_ASISTIO; CONFIRMADO→EN_SALA_ESPERA|CANCELADO|NO_ASISTIO; EN_SALA_ESPERA→EN_ATENCION|CANCELADO|NO_ASISTIO; EN_ATENCION→ATENDIDO.",
        params: ["id"],
        body: obj({ estado: ref("EstadoCita") }, ["estado"]),
        ok: ref("Cita"),
        errors: [400, 404, 409],
      }),
    },
    "/api/recordatorios": { get: op("Agenda", { summary: "Bitácora de recordatorios enviados", ok: arr(obj({ appointmentId: str(), tipo: str({ enum: ["48H", "24H"] }), canal: str(), destino: str(), mensaje: str(), sentAt: fecha })) }) },
    "/api/recordatorios/ejecutar": { post: op("Agenda", { summary: "Envía ahora los recordatorios 48 h / 24 h pendientes (también corre cada hora)", ok: obj({ revisadas: int(), enviados: int() }) }) },

    // ---------- Caja ----------
    "/api/caja/apertura": { post: op("Caja", { summary: "Abre el turno de caja (caja:gestionar)", body: obj({ fondoInicial: centavos() }, ["fondoInicial"]), okStatus: 201, ok: ref("Turno"), errors: [400, 409] }) },
    "/api/caja/turno": { get: op("Caja", { summary: "Turno abierto del cajero, sin totales (cierre ciego)", okContent: json({ ...ref("Turno"), nullable: true }) }) },
    "/api/caja/cobros": {
      post: op("Caja", {
        summary: "Cobro con pagos mixtos y factura electrónica",
        description: "El total se calcula en el servidor con los precios del catálogo; los pagos deben sumarlo al centavo. Genera el comprobante XML con autorización simulada del SRI.",
        body: ref("CobroNuevo"),
        okStatus: 201,
        ok: ref("Cobro"),
        errors: [400, 404, 409],
        extra: { 402: errorResp("Pago rechazado por la pasarela") },
      }),
    },
    "/api/caja/cobros/{id}": { get: op("Caja", { summary: "Comprobante interno de un cobro propio", params: ["idCobro"], ok: ref("Cobro"), errors: [404] }) },
    "/api/caja/cobros/{id}/factura.xml": { get: op("Caja", { summary: "XML del comprobante electrónico", params: ["idCobro"], okContent: { "application/xml": { schema: str() } }, errors: [404] }) },
    "/api/caja/cierre": { post: op("Caja", { summary: "Cierre ciego: recibe el conteo y solo entonces revela el teórico y la diferencia (RN-02)", body: obj({ conteoEfectivo: centavos() }, ["conteoEfectivo"]), ok: ref("Turno"), errors: [400, 409] }) },

    // ---------- Expediente ----------
    "/api/clinico/pacientes/{pid}/odontograma": { get: op("Expediente", { summary: "Hallazgos del odontograma con sus adendas (clinico:leer)", params: ["pid"], ok: obj({ hallazgos: arr(ref("Hallazgo")) }), errors: [404] }) },
    "/api/clinico/pacientes/{pid}/hallazgos": { post: op("Expediente", { summary: "Registra un hallazgo (clinico:escribir)", params: ["pid"], body: ref("HallazgoNuevo"), okStatus: 201, ok: ref("Hallazgo"), errors: [400, 404] }) },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}": {
      patch: op("Expediente", { summary: "Edita un hallazgo no realizado", params: ["pid", "hid"], body: obj({ estado: str({ enum: ["EXISTENTE", "REQUERIDO"] }), nota: str() }), ok: ref("Hallazgo"), errors: [400, 404, 409] }),
      delete: op("Expediente", { summary: "Borra un hallazgo no realizado (RN-01: lo realizado nunca se borra)", params: ["pid", "hid"], okStatus: 204, okDescription: "Borrado", errors: [404, 409] }),
    },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}/realizar": {
      post: op("Expediente", {
        summary: "Marca como realizado (clinico:firmar) y descuenta insumos (RF-14)",
        description: "Con procedimientoId y consultorioId descuenta la receta de consumo (lotes FEFO) y deja el procedimiento listo para liquidar honorarios, todo en una transacción. Si falta stock responde 409 con code STOCK_INSUFICIENTE y no cambia nada.",
        params: ["pid", "hid"],
        body: obj({ procedimientoId: str(), consultorioId: str(), costoLaboratorio: centavos() }),
        ok: ref("Hallazgo"),
        errors: [400, 404, 409],
      }),
    },
    "/api/clinico/pacientes/{pid}/hallazgos/{hid}/adenda": { post: op("Expediente", { summary: "Adenda firmada para corregir un procedimiento realizado", params: ["pid", "hid"], body: ref("AdendaNueva"), okStatus: 201, ok: ref("Adenda"), errors: [400, 404], extra: { 401: errorResp("Contraseña incorrecta") } }) },
    "/api/clinico/pacientes/{pid}/periodontograma": {
      get: op("Expediente", { summary: "Exámenes periodontales con NIC calculado (RF-04)", params: ["pid"], ok: arr(ref("PerioExamen")) }),
      post: op("Expediente", {
        summary: "Registra un examen periodontal (no editable)",
        params: ["pid"],
        body: obj({ dientes: arr(obj({ diente: str(), puntos: { ...arr(ref("PuntoPerio")), minItems: 6, maxItems: 6 }, furca: int(), movilidad: int() }, ["diente", "puntos", "furca", "movilidad"])) }, ["dientes"]),
        okStatus: 201,
        ok: ref("PerioExamen"),
        errors: [400, 404],
      }),
    },
    "/api/clinico/pacientes/{pid}/notas": {
      get: op("Expediente", { summary: "Notas SOEP (cronología inversa)", params: ["pid"], ok: arr(ref("Nota")) }),
      post: op("Expediente", { summary: "Nueva nota SOEP (cifrada en reposo)", params: ["pid"], body: ref("NotaNueva"), okStatus: 201, ok: ref("Nota"), errors: [400, 404] }),
    },
    "/api/clinico/pacientes/{pid}/notas/{nid}": { patch: op("Expediente", { summary: "Edita la nota (solo su autor, sin firmar y dentro del plazo)", params: ["pid", "nid"], body: ref("NotaNueva"), ok: ref("Nota"), errors: [400, 404, 409] }) },
    "/api/clinico/pacientes/{pid}/notas/{nid}/firmar": { post: op("Expediente", { summary: "Firma la nota con re-autenticación; queda inmutable", params: ["pid", "nid"], body: ref("Firma"), ok: ref("Nota"), errors: [400, 404, 409], extra: { 401: errorResp("Contraseña incorrecta") } }) },
    "/api/clinico/pacientes/{pid}/notas/{nid}/adenda": { post: op("Expediente", { summary: "Adenda firmada a una nota bloqueada", params: ["pid", "nid"], body: ref("AdendaNueva"), okStatus: 201, ok: ref("Adenda"), errors: [400, 404, 409] }) },
    "/api/clinico": { get: op("Expediente", { summary: "Comprobación de acceso clínico (clinico:leer + MFA)", ok: obj({ items: arr({}) }) }) },

    // ---------- Consentimientos ----------
    "/api/consentimientos/plantillas": { get: op("Consentimientos", { summary: "Plantillas por procedimiento", ok: arr(obj({ id: str(), procedimientoId: str({ nullable: true }), titulo: str(), texto: str() })) }) },
    "/api/consentimientos": {
      get: op("Consentimientos", { summary: "Consentimientos del paciente", params: ["patientId"], ok: arr(ref("Consentimiento")), errors: [400] }),
      post: op("Consentimientos", {
        summary: "Genera un consentimiento a firmar (FIRMA en pantalla u OTP)",
        description: "Con OTP envía un código de 6 dígitos (válido 10 min) al paciente, o a su tutor si es menor.",
        body: obj({ patientId: str(), procedimientoId: str(), metodo: str({ enum: ["FIRMA", "OTP"] }) }, ["patientId", "metodo"]),
        okStatus: 201,
        ok: ref("Consentimiento"),
        errors: [400, 404],
      }),
    },
    "/api/consentimientos/{id}/firmar": {
      post: op("Consentimientos", {
        summary: "Firma el consentimiento y genera el PDF",
        params: ["id"],
        body: obj({ firma: str({ description: "Trazo como data URL PNG (método FIRMA)" }), otp: str({ description: "Código de 6 dígitos (método OTP)" }) }),
        ok: ref("Consentimiento"),
        errors: [400, 404, 409],
        extra: { 401: errorResp("OTP incorrecto"), 410: errorResp("OTP vencido") },
      }),
    },
    "/api/consentimientos/{id}/pdf": { get: op("Consentimientos", { summary: "PDF del consentimiento firmado", params: ["id"], okContent: pdf, errors: [404] }) },

    // ---------- Recetas ----------
    "/api/recetas": {
      get: op("Recetas", { summary: "Recetas del paciente", params: ["patientId"], ok: arr(ref("Receta")), errors: [400] }),
      post: op("Recetas", {
        summary: "Emite una receta en PDF (clinico:firmar)",
        description: "Si un medicamento coincide con una alergia registrada responde 409 con code ALERGIA, salvo que se envíe confirmarAlergia: true.",
        body: obj({ patientId: str(), diagnostico: str(), items: arr(ref("ItemReceta")), confirmarAlergia: { ...bool, default: false } }, ["patientId", "items"]),
        okStatus: 201,
        ok: ref("Receta"),
        errors: [400, 404, 409],
      }),
    },
    "/api/recetas/{id}/pdf": { get: op("Recetas", { summary: "PDF de la receta", params: ["id"], okContent: pdf, errors: [404] }) },

    // ---------- Presupuestos ----------
    "/api/presupuestos": {
      get: op("Presupuestos", { summary: "Presupuestos del paciente con totales", params: ["patientId"], ok: arr(ref("Presupuesto")), errors: [400] }),
      post: op("Presupuestos", { summary: "Crea un borrador por fases y sesiones (presupuestos:gestionar)", body: ref("PresupuestoNuevo"), okStatus: 201, ok: ref("Presupuesto"), errors: [400, 404] }),
    },
    "/api/presupuestos/agendables": { get: op("Presupuestos", { summary: "Ítems aprobados aún sin cita", params: ["patientId"], ok: arr({ type: "object" }), errors: [400] }) },
    "/api/presupuestos/{id}/presentar": { post: op("Presupuestos", { summary: "Presenta el borrador al paciente", params: ["id"], ok: ref("Presupuesto"), errors: [404, 409] }) },
    "/api/presupuestos/{id}/aprobar": {
      post: op("Presupuestos", {
        summary: "Registra la aprobación total o parcial (presupuestos:aprobar)",
        description: "Sin itemIds se aprueba todo; con itemIds solo esos y el resto queda rechazado. El descuento se prorratea sobre lo aprobado.",
        params: ["id"],
        body: obj({ itemIds: arr(str()) }),
        ok: ref("Presupuesto"),
        errors: [400, 404, 409],
      }),
    },
    "/api/presupuestos/items/{iid}/agendar": {
      post: op("Presupuestos", {
        summary: "Convierte un ítem aprobado en cita (RF-08), respetando RN-03",
        params: ["iid"],
        body: obj({ profesionalId: str(), sillonId: str(), inicio: fecha, fin: fecha }, ["profesionalId", "sillonId", "inicio", "fin"]),
        okStatus: 201,
        ok: obj({ item: { type: "object" }, cita: ref("Cita") }),
        errors: [400, 404, 409],
      }),
    },

    // ---------- Inventario ----------
    "/api/inventario": { get: op("Inventario", { summary: "Stock por consultorio con lotes y alerta de mínimo (inventario:leer)", params: ["consultorioId"], ok: arr(ref("Insumo")), errors: [400] }) },
    "/api/inventario/insumos": { post: op("Inventario", { summary: "Crea un insumo (catalogos:gestionar)", body: obj({ codigo: str(), nombre: str(), unidad: str(), stockMinimo: int(), costoUnitario: centavos() }, ["codigo", "nombre", "unidad"]), okStatus: 201, errors: [400, 409] }) },
    "/api/inventario/entradas": { post: op("Inventario", { summary: "Ingresa un lote (inventario:gestionar)", body: obj({ insumoId: str(), consultorioId: str(), lote: str(), vence: fecha, cantidad: int(undefined, { minimum: 1 }) }, ["insumoId", "consultorioId", "lote", "cantidad"]), okStatus: 201, errors: [400, 404] }) },
    "/api/inventario/ajustes": { post: op("Inventario", { summary: "Ajuste por conteo físico", body: obj({ loteId: str(), cantidadReal: int(), motivo: str() }, ["loteId", "cantidadReal", "motivo"]), errors: [400, 404] }) },
    "/api/inventario/movimientos": { get: op("Inventario", { summary: "Libro de movimientos (solo inserción)", params: ["insumoIdQ", "consultorioIdQ"], ok: arr({ type: "object" }), errors: [400] }) },
    "/api/inventario/receta-consumo/{procedimientoId}": {
      get: op("Inventario", { summary: "Receta estándar de consumo del procedimiento", params: ["procedimientoId"], ok: arr(obj({ insumoId: str(), cantidad: int() })) }),
      put: op("Inventario", { summary: "Reemplaza la receta de consumo (catalogos:gestionar)", params: ["procedimientoId"], body: obj({ items: arr(obj({ insumoId: str(), cantidad: int() }, ["insumoId", "cantidad"])) }, ["items"]), errors: [400, 404] }),
    },

    // ---------- Honorarios ----------
    "/api/honorarios/reglas": {
      get: op("Honorarios", { summary: "Reglas de honorarios (honorarios:leer)", params: ["profesionalIdQ"], ok: arr(ref("ReglaHonorario")) }),
      put: op("Honorarios", { summary: "Define o reemplaza una regla (honorarios:configurar)", body: ref("ReglaHonorario"), ok: ref("ReglaHonorario"), errors: [400, 404] }),
    },
    "/api/honorarios/previsualizar": {
      get: op("Honorarios", {
        summary: "Calcula la liquidación sin guardarla (honorarios:gestionar)",
        params: ["profesionalIdReq", "desde", "hasta"],
        ok: obj({ lineas: arr({ type: "object" }), sinRegla: arr({ type: "object" }), total: centavos() }),
        errors: [400],
      }),
    },
    "/api/honorarios/liquidar": { post: op("Honorarios", { summary: "Liquida los procedimientos pendientes del periodo; cada uno se liquida una sola vez", body: ref("Periodo"), okStatus: 201, ok: ref("Liquidacion"), errors: [400, 409] }) },
    "/api/honorarios/liquidaciones": { get: op("Honorarios", { summary: "Historial de liquidaciones", params: ["profesionalIdQ"], ok: arr(ref("Liquidacion")) }) },

    // ---------- Reportes ----------
    "/api/reportes/corte-caja": { get: op("Reportes", { summary: "Corte de caja por turno cerrado (reportes:leer)", params: ["desde", "hasta", "formato"], okContent: reporte, errors: [400] }) },
    "/api/reportes/honorarios": { get: op("Reportes", { summary: "Honorarios liquidados por profesional", params: ["desde", "hasta", "formato"], okContent: reporte, errors: [400] }) },
    "/api/reportes/inventario": { get: op("Reportes", { summary: "Inventario valorizado, mínimos y lotes por vencer", params: ["formato"], okContent: reporte }) },
    "/api/reportes/ausentismo": { get: op("Reportes", { summary: "Tasa de no-show por profesional", params: ["desde", "hasta", "formato"], okContent: reporte, errors: [400] }) },

    // ---------- Auditoría ----------
    "/api/auditoria": { get: op("Auditoría", { summary: "Últimos registros del log (auditoria:leer)", params: ["limit"], ok: arr(ref("RegistroAuditoria")) }) },
    "/api/auditoria/verificar": { get: op("Auditoría", { summary: "Verifica la cadena de hashes", ok: obj({ ok: bool, brokenAt: int(undefined, { nullable: true }), total: int() }) }) },
  },
};
