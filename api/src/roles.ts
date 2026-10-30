// Roles del SRS §3 y su matriz de permisos (RNF-05).
export const ROLES = ["ADMIN", "ODONTOLOGO", "RECEPCIONISTA", "ASISTENTE", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "usuarios:gestionar"
  | "pacientes:leer"
  | "pacientes:escribir"
  | "catalogos:leer"
  | "catalogos:gestionar"
  | "agenda:leer"
  | "agenda:gestionar"
  | "caja:gestionar"
  | "clinico:leer"
  | "clinico:escribir"
  | "clinico:firmar"
  | "presupuestos:leer"
  | "presupuestos:gestionar"
  | "presupuestos:aprobar"
  | "reportes:leer"
  | "auditoria:leer";

export const PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ["usuarios:gestionar", "auditoria:leer", "catalogos:leer", "catalogos:gestionar"],
  ODONTOLOGO: ["pacientes:leer", "pacientes:escribir", "catalogos:leer", "agenda:leer", "agenda:gestionar", "clinico:leer", "clinico:escribir", "clinico:firmar", "presupuestos:leer", "presupuestos:gestionar", "presupuestos:aprobar"],
  RECEPCIONISTA: ["pacientes:leer", "pacientes:escribir", "catalogos:leer", "agenda:leer", "agenda:gestionar", "caja:gestionar", "presupuestos:leer", "presupuestos:aprobar"],
  ASISTENTE: ["pacientes:leer", "catalogos:leer", "agenda:leer", "clinico:leer", "clinico:escribir"],
  AUDITOR: ["reportes:leer", "auditoria:leer", "catalogos:leer"],
};

export const can = (role: Role, p: Permission) => PERMISSIONS[role].includes(p);

// Roles con acceso clínico o financiero: MFA obligatorio (RNF-05).
export const MFA_ROLES: Role[] = ["ODONTOLOGO", "ASISTENTE", "RECEPCIONISTA", "AUDITOR"];
