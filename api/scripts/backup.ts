// Uso:
//   npm run backup -w api                       → crea backups/sigo-<fecha>.db y lo verifica
//   npm run restaurar -w api -- backups/x.db    → restaura (con el servicio detenido)
import { prisma } from "../src/db.js";
import { respaldar, restaurar, verificarRespaldo } from "../src/backup.js";

const [accion, archivo] = process.argv.slice(2);

try {
  if (accion === "restaurar") {
    if (!archivo) throw new Error("Indica el archivo de respaldo a restaurar");
    console.log(await restaurar(archivo));
  } else {
    const destino = archivo ?? `backups/sigo-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    const r = await respaldar(destino);
    console.log({ ...r, verificacion: await verificarRespaldo(r.archivo) });
  }
} finally {
  await prisma.$disconnect();
}
