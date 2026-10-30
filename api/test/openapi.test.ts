import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import request from "supertest";
import SwaggerParser from "@apidevtools/swagger-parser";
import { createApp } from "../src/app.js";
import { openapi } from "../src/openapi.js";

describe("documentación OpenAPI 3.0 (entregable 8.2)", () => {
  it("es una especificación OpenAPI 3.0 válida", async () => {
    await expect(SwaggerParser.validate(structuredClone(openapi) as never)).resolves.toBeTruthy();
    expect(openapi.openapi).toBe("3.0.3");
  });

  it("se sirve como JSON y con Swagger UI", async () => {
    const app = createApp();
    const json = await request(app).get("/api/docs/openapi.json");
    expect(json.status).toBe(200);
    expect(json.body.openapi).toBe("3.0.3");
    expect((await request(app).get("/api/docs/")).status).toBe(200);
  });

  it("docs/openapi.json está al día (npm run openapi -w api)", async () => {
    const archivo = JSON.parse(await readFile("../docs/openapi.json", "utf8"));
    expect(archivo).toEqual(JSON.parse(JSON.stringify(openapi)));
  });

  it("documenta todas las rutas que expone el API", async () => {
    const app = await readFile("src/app.ts", "utf8");
    const montajes = [...app.matchAll(/app\.use\("([^"]+)", (\w+)Router\)/g)].map((m) => ({ base: m[1], nombre: m[2] }));
    const documentadas = new Set(Object.entries(openapi.paths).flatMap(([p, ms]) => Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`)));
    const faltan: string[] = [];
    let revisadas = 0;
    for (const f of await readdir("src/routes")) {
      const m = montajes.find((x) => x.nombre === f.replace(".ts", ""));
      expect(m, `router sin montar: ${f}`).toBeTruthy();
      for (const r of (await readFile(`src/routes/${f}`, "utf8")).matchAll(/\w+Router\.(get|post|put|patch|delete)\("([^"]+)"/g)) {
        revisadas++;
        const ruta = (m!.base + (r[2] === "/" ? "" : r[2])).replace(/:(\w+)/g, "{$1}");
        if (!documentadas.has(`${r[1].toUpperCase()} ${ruta}`)) faltan.push(`${r[1].toUpperCase()} ${ruta}`);
      }
    }
    expect(revisadas).toBeGreaterThan(60); // la búsqueda de rutas funciona
    expect(faltan).toEqual([]);
  });

  it("toda ruta con parámetros de ruta los declara", () => {
    for (const [ruta, metodos] of Object.entries(openapi.paths)) {
      const enRuta = [...ruta.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const op of Object.values(metodos as Record<string, { parameters?: { $ref: string }[] }>)) {
        const declarados = (op.parameters ?? []).map((p) => (openapi.components.parameters as Record<string, { name: string; in: string }>)[p.$ref.split("/").pop()!]).filter((p) => p.in === "path").map((p) => p.name);
        expect(declarados.sort(), ruta).toEqual(enRuta.sort());
      }
    }
  });
});
