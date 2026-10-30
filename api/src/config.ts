export const config = {
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-solo-local",
  encryptionKey: process.env.ENCRYPTION_KEY ?? "dev-encryption-key-solo-local",
  accessTtl: "5m" as const,
  idleMs: 15 * 60 * 1000, // cierre por inactividad (RNF-05)
  mfaEnforced: process.env.MFA_ENFORCED !== "false",
};
