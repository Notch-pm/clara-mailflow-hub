-- Planification du worker de la file d'analyse.
--
-- Toutes les 2 minutes : compromis entre la réactivité attendue (un courrier
-- numérisé doit être océrisé « tout de suite ») et le coût de réveils à vide.
-- Le worker s'arrête de lui-même quand la file est vide (claim renvoie 0 ligne).

CREATE OR REPLACE FUNCTION public.trigger_process_analysis_queue()
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
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/process-analysis-queue',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_process_analysis_queue() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('process-analysis-queue-every-2min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-analysis-queue-every-2min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'process-analysis-queue-every-2min',
  '*/2 * * * *',
  $$ SELECT public.trigger_process_analysis_queue(); $$
);
