import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// Déconnexion unique (voir lib/sso.ts) : Keycloak charge cette page dans une iframe
// invisible quand l'agent se déconnecte d'une autre application de la gamme. On
// efface la session de l'application ; ses onglets ouverts l'apprennent par
// supabase-js (même origine) et retombent sur la page de connexion.
// ⚠️ scope "local" : les sessions de l'agent sur ses autres appareils restent.
export default function SsoLogout() {
  useEffect(() => {
    void supabase.auth.signOut({ scope: "local" });
  }, []);
  return null;
}
