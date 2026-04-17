CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cron_secret() FROM anon;
REVOKE ALL ON FUNCTION public.get_cron_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;