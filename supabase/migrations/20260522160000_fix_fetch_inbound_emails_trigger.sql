-- Supprime la clé JWT anon hardcodée dans trigger_fetch_inbound_emails.
-- La fonction edge fetch-inbound-emails vérifie uniquement x-cron-secret
-- pour les appels pg_cron — Authorization et apikey sont inutiles ici.
CREATE OR REPLACE FUNCTION public.trigger_fetch_inbound_emails()
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
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/fetch-inbound-emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_fetch_inbound_emails() FROM PUBLIC, anon, authenticated;
