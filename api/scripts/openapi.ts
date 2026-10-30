// Exporta la especificación OpenAPI 3.0 a docs/openapi.json (entregable de documentación del API).
import { writeFile } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import { openapi } from "../src/openapi.js";

await SwaggerParser.validate(structuredClone(openapi) as never);
await writeFile("../docs/openapi.json", JSON.stringify(openapi, null, 2) + "\n");
console.log(`docs/openapi.json: OpenAPI ${openapi.openapi}, ${Object.keys(openapi.paths).length} rutas, válida`);
