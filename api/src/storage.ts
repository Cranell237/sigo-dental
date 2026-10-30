import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Interfaz de almacenamiento de archivos (PDFs, firmas). Hoy es disco local (`uploads/`);
// para S3 o Azure Blob basta otra implementación de `Storage`.
export interface Storage {
  save(relativePath: string, data: Buffer): Promise<void>;
  read(relativePath: string): Promise<Buffer>;
}

class LocalStorage implements Storage {
  private resolve(relativePath: string) {
    const root = path.resolve(process.env.UPLOADS_DIR ?? "uploads");
    const full = path.resolve(root, relativePath);
    if (!full.startsWith(root + path.sep)) throw new Error("Ruta de archivo inválida");
    return full;
  }

  async save(relativePath: string, data: Buffer) {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async read(relativePath: string) {
    return readFile(this.resolve(relativePath));
  }
}

export const storage: Storage = new LocalStorage();
