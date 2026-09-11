import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // La suite unitaire ne doit jamais dépendre d'un `.env` local. Importer un
    // service construit le client Supabase AU CHARGEMENT DU MODULE, et
    // `createClient` refuse une URL vide : en CI, où il n'y a pas de `.env`, le
    // moindre test qui importe un service — même pour n'en tirer qu'une
    // constante pure — échouait dès la collecte (« supabaseUrl is required »).
    // Valeurs factices et volontairement injoignables : un test qui tenterait
    // un vrai appel doit échouer bruyamment, jamais taper un projet réel. Les
    // tests qui ont besoin du client le simulent (`vi.mock`) ; ceux qui parlent
    // au vrai Supabase vivent dans la suite d'intégration, qui a sa propre
    // configuration et ses propres secrets.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "clef-anon-factice-suite-unitaire",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
