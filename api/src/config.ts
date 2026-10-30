export const config = {
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-solo-local",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "dev-encryption-key-solo-local",
  accessTtl: "5m" as const,
  idleMs: 15 * 60 * 1000, // cierre por inactividad (RNF-05)
  // RF-05: plazo tras el cual una nota ya no se puede editar (configurable, 24 h por defecto).
  soepLockHours: Number(process.env.SOEP_LOCK_HOURS ?? 24),
  // En la demo el OTP del consentimiento también se devuelve en la respuesta (el canal es simulado).
  demoMode: process.env.DEMO_MODE !== "false",
  mfaEnforced: process.env.MFA_ENFORCED !== "false",
};
