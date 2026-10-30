import { execSync } from "node:child_process";

// Base SQLite aparte para las pruebas: migra y siembra antes de correr.
export default function setup() {
  process.env.DATABASE_URL = "file:./test.db";
  process.env.UPLOADS_DIR = "./uploads-test";
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore", env: process.env });
}
