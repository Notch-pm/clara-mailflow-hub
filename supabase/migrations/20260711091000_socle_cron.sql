-- Planification nocturne de la sync Socle + décommissionnement du cron Arpège.
-- ⚠️ À appliquer UNIQUEMENT après validation du premier run manuel (dry-run puis run réel).

-- ─── Fonction de déclenchement (même pattern que trigger_arpege_sync) ──────────
CREATE OR REPLACE FUNCTION public.trigger_socle_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  -- Secret cron lu depuis le Vault (doit correspondre au check x-cron-secret de l'edge function)
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/sync-socle-referentiel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

-- Pas d'appel via l'API REST (PostgREST) : réservé à pg_cron / service_role.
REVOKE EXECUTE ON FUNCTION public.trigger_socle_sync() FROM PUBLIC, anon, authenticated;

-- ─── Planification : toutes les nuits à 03:00 ──────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('sync-socle-referentiel-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-socle-referentiel-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-socle-referentiel-nightly',
  '0 3 * * *',
  $$ SELECT public.trigger_socle_sync(); $$
);

-- ─── Décommissionnement Arpège ──────────────────────────────────────────────────
-- Le Socle remplace la gestion des démarches : le cron nocturne Arpège est déplanifié.
-- L'edge function sync-arpege-services reste déployée (déclenchement manuel possible)
-- mais n'est plus planifiée.
DO $$
BEGIN
  PERFORM cron.unschedule('sync-arpege-procedures-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-arpege-procedures-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
