-- Planification de la réconciliation des demandes Iris.
--
-- Une fois déposée, la demande est instruite DANS Iris : Clara relit son état,
-- elle ne le pilote pas. Une fois par nuit suffit — un statut de demande n'est
-- pas une donnée temps réel, et le contrat prévoit exactement ce chemin
-- (`GET /v1/requests?updated_since=`, garde sur la version monotone).
--
-- 03:30, après la synchronisation du référentiel de 03:00 : les démarches et
-- l'arbre d'organisations sont alors à jour, ce qui évite de réconcilier des
-- demandes contre un miroir périmé.
--
-- ⚠️ Cette migration passe APRÈS le déploiement de `sync-iris-requests`
-- (cf. docs/deployment.md) : planifier avant produirait un échec toutes les
-- nuits jusqu'au déploiement.

CREATE OR REPLACE FUNCTION public.trigger_iris_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  -- Secret cron lu au Vault : il doit correspondre au contrôle x-cron-secret
  -- de l'edge function (le cron n'envoie aucun en-tête Authorization).
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/sync-iris-requests',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION public.trigger_iris_sync() IS
  'Déclenche la réconciliation des demandes Iris (edge function sync-iris-requests) — appelée par pg_cron.';

REVOKE EXECUTE ON FUNCTION public.trigger_iris_sync() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('iris-sync-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'iris-sync-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'iris-sync-nightly',
  '30 3 * * *',
  $$ SELECT public.trigger_iris_sync(); $$
);
