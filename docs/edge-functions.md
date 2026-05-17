# Edge Functions

Toutes en Deno, dans `supabase/functions/<name>/index.ts`. Toutes doivent :
- Gérer **CORS** (OPTIONS preflight + headers `Access-Control-Allow-*`).
- Vérifier l'auth (JWT user via `Authorization: Bearer ...`, OU service role, OU `x-cron-secret`).
- Re-vérifier l'`organization_id` côté serveur (ne pas faire confiance au client).
- Logguer les erreurs avec contexte (mais **jamais** les secrets).

## Liste

| Function | Rôle | Auth | Secrets utilisés |
|---|---|---|---|
| `analyze-courier` | OCR + analyse LLM des courriers. Routes via query `?action=ocr-courier` ou `?action=analyze`. | JWT user, vérifie membership de l'org du courrier. | `LOVABLE_API_KEY` |
| `draft-reply` | Génère un brouillon HTML de réponse via LLM. | JWT user. | `LOVABLE_API_KEY` |
| `fetch-inbound-emails` | Poll IMAP, crée des couriers inbound. | JWT user admin OU service role. | Lit `imap_settings` (chiffré en DB). |
| `send-courier-reply` | Envoie une réponse via SMTP de l'org. | JWT user. | Lit `smtp_settings`. |
| `send-test-email` | Test de config SMTP. | JWT user admin. | Idem. |
| `send-password-reset` | Envoie un mail de reset à un user **de la même org** (ou superadmin). | JWT user. Vérifie que la cible est dans une org commune. | `RESEND_API_KEY` (ou SMTP). |
| `invite-user` | Crée un user + envoie invitation, lié à une org. | JWT admin de l'org cible. | `RESEND_API_KEY`. |
| `auth-email-hook` | Hook Supabase Auth pour customiser les emails (confirmation, magic link...). | Webhook Supabase signé. | Secret hook Supabase. |
| `storage-documents` | Proxy signé pour servir un document du bucket privé `clara-documents` avec vérification d'accès. | JWT user, vérifie membership. | — |
| `sync-arpege-services` | Upsert des démarches depuis Arpège dans `procedures`. | Service role JWT OU admin user OU `x-cron-secret`. | `CRON_SECRET`, `ARPEGE_*`. |
| `sync-arpege-appointments` | Sync RDV Arpège (lecture seule actuellement). | Idem. | Idem. |
| `test-arpege-connection` | Test de connexion à l'API Arpège pour une org. | Admin de l'org cible. | `ARPEGE_*`. |

## Pattern de squelette

```ts
// supabase/functions/<name>/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // 1. Auth — multi-mode si pertinent
    const cronSecret = req.headers.get("x-cron-secret");
    const auth = req.headers.get("Authorization") ?? "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let allowed = false;
    if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
      allowed = true; // cron
    } else if (auth) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      // ... vérifier membership / superadmin / admin selon le besoin
      allowed = !!user; // affiner
    }
    if (!allowed) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    // 2. Logique métier ...

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[<name>] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

## Tester localement

```bash
supabase functions serve <name> --env-file ./supabase/.env.local
curl -X POST http://localhost:54321/functions/v1/<name> \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## Déploiement

Les fonctions sont déployées via la plateforme Lovable (ou `supabase functions deploy <name>`).
