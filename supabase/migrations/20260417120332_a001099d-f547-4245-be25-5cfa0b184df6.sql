CREATE OR REPLACE FUNCTION public.trigger_fetch_inbound_emails()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/fetch-inbound-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

-- Planification toutes les 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('fetch-inbound-emails-every-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-inbound-emails-every-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'fetch-inbound-emails-every-5min',
  '*/5 * * * *',
  $$ SELECT public.trigger_fetch_inbound_emails(); $$
);
