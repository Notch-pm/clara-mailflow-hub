-- ============================================================================
-- Cron de la file des avis à Iris (courrier de réponse, 2026-11-12).
--
-- ⚠️ À appliquer APRÈS le déploiement de `notify-iris-reply` (et la vérification
-- de `verify_jwt = false`, docs/deployment.md « le piège des fonctions cron ») :
-- sinon l'appel répond 404 chaque minute et la file s'accumule en silence.
-- Motif `trigger_notifications_push` : secret du cron lu au Vault.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_notify_iris_reply()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  -- Rien en file : pas d'appel (la plupart des minutes).
  IF NOT EXISTS (SELECT 1 FROM public.iris_reply_notifications
                  WHERE status = 'pending' AND next_attempt_at <= now()) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT net.http_post(
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/notify-iris-reply',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', COALESCE(v_secret, '')),
    body    := '{}'::jsonb
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trigger_notify_iris_reply() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('notify-iris-reply-every-min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-iris-reply-every-min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'notify-iris-reply-every-min',
  '* * * * *',
  $$ SELECT public.trigger_notify_iris_reply(); $$
);
