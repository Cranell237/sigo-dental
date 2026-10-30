import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts", "src/openapi.ts"], reporter: ["text-summary", "text"] },
  },
});
