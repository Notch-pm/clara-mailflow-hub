-- Rétention des journaux techniques — décision PO du 2026-09-23 (audit purge /
-- performance de la gamme, avant mise en production).
--
--   • courier_analysis_jobs : jobs terminés (done / failed) purgés 90 jours après
--     finished_at. Jusqu'ici ils ne partaient qu'avec leur courrier, donc jamais
--     pour les organisations sans courier_retention_days (6 sur 8 au 2026-09-23).
--     Les jobs pending / running ne sont jamais touchés.
--   • socle_sync_runs : 90 jours, en gardant toujours la dernière synchro réelle
--     (dry_run = false) de chaque organisation — c'est elle que lit
--     getLastSyncRun (src/services/socleSyncService.ts).
--
-- Reprend purge_expired_data() à l'identique (dernière définition :
-- 20260922190000_notifications_cadence_et_retention.sql) et y ajoute ces deux
-- blocs : un seul cron de purge nocturne (purge-expired-data-nightly, 00:00).

CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_terminal
  ON public.courier_analysis_jobs (finished_at)
  WHERE status IN ('done', 'failed');

CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org RECORD;
  v_courier_cutoff timestamptz;
  v_deleted_couriers int := 0;
  v_total_couriers int := 0;
  v_deleted_notifications int := 0;
  v_deleted_analysis_jobs int := 0;
  v_deleted_sync_runs int := 0;
BEGIN
  FOR org IN
    SELECT id, courier_retention_days
    FROM public.organizations
    WHERE courier_retention_days IS NOT NULL
  LOOP
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

  -- Jobs d'analyse terminés : trace technique, sans valeur au-delà du
  -- diagnostic d'un échec récurrent.
  WITH del AS (
    DELETE FROM public.courier_analysis_jobs
    WHERE status IN ('done', 'failed')
      AND finished_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_analysis_jobs FROM del;

  -- Historique des synchros Socle : on garde la dernière synchro réelle de
  -- chaque organisation, quel que soit son âge.
  WITH last_run AS (
    SELECT DISTINCT ON (organization_id) id
    FROM public.socle_sync_runs
    WHERE dry_run = false
    ORDER BY organization_id, started_at DESC
  ),
  del AS (
    DELETE FROM public.socle_sync_runs r
    WHERE r.started_at < now() - interval '90 days'
      AND r.id NOT IN (SELECT id FROM last_run)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_sync_runs FROM del;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'deleted_couriers', v_total_couriers,
    'deleted_notifications', v_deleted_notifications,
    'deleted_analysis_jobs', v_deleted_analysis_jobs,
    'deleted_sync_runs', v_deleted_sync_runs
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;
