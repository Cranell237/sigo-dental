// Roles del SRS §3 y su matriz de permisos (RNF-05).
export const ROLES = ["ADMIN", "ODONTOLOGO", "RECEPCIONISTA", "ASISTENTE", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "usuarios:gestionar"
  | "pacientes:leer"
  | "pacientes:escribir"
  | "agenda:gestionar"
  | "caja:gestionar"
  | "clinico:leer"
  | "clinico:escribir"
  | "reportes:leer"
  | "auditoria:leer";

export const PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ["usuarios:gestionar", "auditoria:leer"],
  ODONTOLOGO: ["pacientes:leer", "pacientes:escribir", "agenda:gestionar", "clinico:leer", "clinico:escribir"],
  RECEPCIONISTA: ["pacientes:leer", "pacientes:escribir", "agenda:gestionar", "caja:gestionar"],
  ASISTENTE: ["pacientes:leer", "clinico:leer", "clinico:escribir"],
  AUDITOR: ["reportes:leer", "auditoria:leer"],
};

export const can = (role: Role, p: Permission) => PERMISSIONS[role].includes(p);

// Roles con acceso clínico o financiero: MFA obligatorio (RNF-05).
export const MFA_ROLES: Role[] = ["ODONTOLOGO", "ASISTENTE", "RECEPCIONISTA", "AUDITOR"];
