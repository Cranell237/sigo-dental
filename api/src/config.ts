const produccion = process.env.NODE_ENV === "production";

// En producción los secretos son obligatorios: arrancar con los valores de desarrollo sería inseguro.
if (produccion) {
  for (const k of ["JWT_SECRET", "ENCRYPTION_KEY", "DATABASE_URL"]) {
    if (!process.env[k]) throw new Error(`Falta la variable de entorno ${k} (obligatoria en producción)`);
  }
}

export const config = {
  produccion,
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-solo-local",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "dev-encryption-key-solo-local",
  accessTtl: "5m" as const,
  idleMs: 15 * 60 * 1000, // cierre por inactividad (RNF-05)
  // RF-05: plazo tras el cual una nota ya no se puede editar (configurable, 24 h por defecto).
  soepLockHours: Number(process.env.SOEP_LOCK_HOURS ?? 24),
  // En la demo el OTP del consentimiento también se devuelve en la respuesta (el canal es simulado).
  demoMode: process.env.DEMO_MODE !== "false",
  mfaEnforced: process.env.MFA_ENFORCED !== "false",
  // Intentos de login/MFA por IP cada 15 minutos (protege el código TOTP de 6 dígitos de fuerza bruta).
  maxIntentosLogin: Number(process.env.MAX_INTENTOS_LOGIN ?? 20),
};
