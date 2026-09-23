// Edge function: storage-maintenance
//
// Draine l'outbox `storage_deletions` : retire du bucket `clara-documents` les
// fichiers dont la ligne `courier_documents` a été supprimée (écran, cascade
// depuis le courrier ou l'organisation, purge de rétention). Appelée par pg_cron
// une fois par nuit (`trigger_storage_maintenance()`), qui n'envoie aucun
// en-tête Authorization : d'où `verify_jwt = false` dans supabase/config.toml et
// l'authentification par `x-cron-secret` comparé à `get_cron_secret()`, motif de
// process-analysis-queue.
//
// LA BASE DÉCIDE, CETTE FONCTION EXÉCUTE (motif Iris attachments-maintenance) :
// un objet ne se retire que par l'API Storage, jamais par un DELETE SQL sur
// storage.objects. Le trigger `trg_courier_documents_enqueue_deletion` enfile ;
// ici on retire et on solde. Rien ici ne choisit ce qui doit partir.
//
// ⚠️ CORS : aucun. Cette fonction n'est jamais appelée depuis un navigateur.

import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const BUCKET = "clara-documents";
/** Lots de 100, au plus 5 lots par exécution : un passage nocturne suffit au
 *  volume attendu, et ce qui reste repart la nuit suivante. */
const BATCH = 100;
const MAX_BATCHES = 5;

interface DeletionRow {
  id: string;
  bucket: string;
  storage_path: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getCronSecret(): Promise<string> {
  try {
    const { data, error } = await admin.rpc("get_cron_secret");
    if (error) {
      console.error("[storage-maintenance] get_cron_secret:", error.message);
      return "";
    }
    return (data as string) ?? "";
  } catch (e) {
    console.error("[storage-maintenance] get_cron_secret exception:", e);
    return "";
  }
}

/** Retire un objet ; « introuvable » vaut succès (déjà parti). */
async function removeObject(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) {
    if (/not found|does not exist/i.test(error.message)) return { ok: true };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  const provided = req.headers.get("x-cron-secret");
  const expected = await getCronSecret();
  if (!provided || !expected || provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const counters = { claimed: 0, done: 0, failed: 0, settled_purged: 0 };

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await admin.rpc("claim_storage_deletions", { p_limit: BATCH });
    if (error) {
      console.error("[storage-maintenance] claim_storage_deletions:", error.message);
      return jsonResponse({ error: error.message, ...counters }, 500);
    }
    const rows = (data ?? []) as DeletionRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      counters.claimed++;
      // L'outbox ne porte que ce bucket ; une ligne d'un autre bucket serait
      // un bug d'enfilement, pas un objet à retirer ici.
      const removed = row.bucket === BUCKET
        ? await removeObject(row.storage_path)
        : { ok: false as const, error: `bucket inattendu : ${row.bucket}` };
      const { error: settleError } = await admin.rpc("settle_storage_deletion", {
        p_id: row.id,
        p_ok: removed.ok,
        p_error: removed.ok ? null : removed.error,
      });
      if (settleError) console.error("[storage-maintenance] settle_storage_deletion:", settleError.message);
      if (removed.ok) counters.done++;
      else {
        counters.failed++;
        console.error(`[storage-maintenance] objet non retiré ${row.storage_path} — ${removed.error}`);
      }
    }
    if (rows.length < BATCH) break;
  }

  const { data: purged, error: purgeError } = await admin.rpc("purge_settled_storage_deletions");
  if (purgeError) console.error("[storage-maintenance] purge_settled_storage_deletions:", purgeError.message);
  else counters.settled_purged = (purged as number) ?? 0;

  console.log("[storage-maintenance]", JSON.stringify(counters));
  return jsonResponse(counters);
});
