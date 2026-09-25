import { defineConfig } from "vitest/config";
import path from "path";

// Alias resolvido à mão: `vite-tsconfig-paths` é ESM-only e o projeto não é
// `"type": "module"`, o que quebra o carregamento do config.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // Mesmo runtime de JSX do Next: componente sem `import React` renderiza no teste.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // URL de exemplo: os testes nunca dependem do projeto real do Supabase.
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co" },
  },
});
