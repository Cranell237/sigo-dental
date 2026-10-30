export const config = {
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-solo-local",
  accessTtl: "15m" as const,
};
