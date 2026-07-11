import { defineConfig } from "vitest/config";
import path from "path";

// Suite d'INTÉGRATION : vrais clients Supabase authentifiés contre le projet de
// test (tenants [TEST] créés par `bun run seed:test`). Séparée de la suite
// unitaire : pas de jsdom, pas de mocks, fichiers en *.itest.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test-integration/**/*.itest.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Appels réseau réels : séquentiel pour des assertions déterministes
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
