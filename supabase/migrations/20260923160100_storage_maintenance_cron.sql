-- Planification du drain de l'outbox `storage_deletions`
-- (20260923160000_storage_deletions_outbox.sql).
--
-- ⚠️ ORDRE DE DÉPLOIEMENT (docs/deployment.md) : cette migration passe APRÈS le
-- déploiement de l'edge function `storage-maintenance`, sinon le cron échoue
-- chaque nuit jusqu'au déploiement.
--
-- Une fois par nuit, à 04:30 : un fichier dont la ligne a disparu peut attendre
-- quelques heures, et un seul appel pg_net par jour n'ajoute rien de sensible à
-- net._http_response (cf. incident mémoire du 2026-09-22).

CREATE OR REPLACE FUNCTION public.trigger_storage_maintenance()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/storage-maintenance',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_storage_maintenance() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'storage-maintenance-nightly',
  '30 4 * * *',
  $$ SELECT public.trigger_storage_maintenance(); $$
);
