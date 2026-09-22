-- Cadence du drainage push, et rétention des notifications.
--
-- Alerte mémoire Supabase du 2026-09-22 : 155 Mo de base dont ~105 de plomberie
-- (82 Mo de `net._http_response` jamais vacuumée pour 252 lignes vivantes,
-- 23 Mo d'historique pg_cron jamais purgé). Le ménage manuel a rendu 100 Mo ;
-- cette migration s'attaque à ce qui les reconstituait.
--
-- 1. Le drainage de la file push tournait CHAQUE MINUTE : 1 440 requêtes pg_net
--    par jour, autant de lignes dans `net._http_response` (TTL 6 h) et dans
--    `cron.job_run_details` (conservé indéfiniment). Toutes les 3 minutes divise
--    ce volume par trois ; le prix est une latence de notification qui passe de
--    « moins d'une minute » à « moins de trois ».
--
-- 2. `purge_expired_data()` ne bornait que les courriers : `notifications`
--    grossissait sans fin — 22 721 lignes au 2026-09-22, dont 22 361 de plus de
--    30 jours, la plus ancienne du 19 avril. Rétention fixe de 30 jours, lues ou
--    non : passé un mois la notification n'apprend plus rien, et le courrier
--    qu'elle annonçait reste, lui, dans la boîte.

-- ---------------------------------------------------------------------------
-- 1. Cadence : toutes les minutes → toutes les 3 minutes
--
-- Le nom du cron porte la cadence : le renommer évite qu'un runbook parlant de
-- `-every-min` ne décrive plus la réalité (cf. docs/deployment.md).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('notifications-push-every-min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-push-every-min');

  PERFORM cron.unschedule('notifications-push-every-3min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-push-every-3min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'notifications-push-every-3min',
  '*/3 * * * *',
  $$ SELECT public.trigger_notifications_push(); $$
);

COMMENT ON FUNCTION public.trigger_notifications_push() IS
  'Draine la boîte d''envoi push des notifications (edge function notifications-push) — appelée par pg_cron toutes les 3 minutes.';

-- ---------------------------------------------------------------------------
-- 2. Rétention des notifications : 30 jours
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  org RECORD;
  v_courier_cutoff timestamptz;
  v_deleted_couriers int := 0;
  v_total_couriers int := 0;
  v_deleted_notifications int := 0;
BEGIN
  FOR org IN
    SELECT id, courier_retention_days
    FROM public.organizations
    WHERE courier_retention_days IS NOT NULL
  LOOP
    -- Courriers : aucune activité (updated_at, dernier événement, dernière note) depuis N jours
    IF org.courier_retention_days IS NOT NULL AND org.courier_retention_days > 0 THEN
      v_courier_cutoff := now() - make_interval(days => org.courier_retention_days);

      WITH activity AS (
        SELECT c.id,
          GREATEST(
            c.updated_at,
            COALESCE((SELECT max(created_at) FROM public.courier_events e WHERE e.courier_id = c.id), c.updated_at),
            COALESCE((SELECT max(updated_at) FROM public.courier_notes n WHERE n.courier_id = c.id), c.updated_at)
          ) AS last_activity_at
        FROM public.couriers c
        WHERE c.organization_id = org.id
      ),
      del AS (
        DELETE FROM public.couriers c
        USING activity a
        WHERE c.id = a.id
          AND a.last_activity_at < v_courier_cutoff
        RETURNING 1
      )
      SELECT count(*) INTO v_deleted_couriers FROM del;

      v_total_couriers := v_total_couriers + v_deleted_couriers;
    END IF;
  END LOOP;

  -- Notifications : rétention fixe, toutes organisations confondues. Pas de
  -- réglage par organisation comme pour les courriers — une notification n'est
  -- pas une donnée d'usager mais un signal de travail, et sa durée de vie utile
  -- ne dépend pas du tenant.
  WITH del AS (
    DELETE FROM public.notifications
    WHERE created_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_notifications FROM del;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'deleted_couriers', v_total_couriers,
    'deleted_notifications', v_deleted_notifications
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;
