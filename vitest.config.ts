import { defineConfig } from "vitest/config";
import path from "path";

// Alias resolvido à mão: `vite-tsconfig-paths` é ESM-only e o projeto não é
// `"type": "module"`, o que quebra o carregamento do config.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
