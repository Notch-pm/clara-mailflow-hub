-- Function called by the nightly cron job
CREATE OR REPLACE FUNCTION public.trigger_arpege_sync()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  -- Read cron secret from Supabase Vault (must match CRON_SECRET edge function env var)
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/sync-arpege-services',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- Unschedule previous job if it exists, then schedule fresh
DO $$
BEGIN
  PERFORM cron.unschedule('sync-arpege-procedures-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-arpege-procedures-nightly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'sync-arpege-procedures-nightly',
  '0 2 * * *',
  $$ SELECT public.trigger_arpege_sync(); $$
);