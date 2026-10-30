import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
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
