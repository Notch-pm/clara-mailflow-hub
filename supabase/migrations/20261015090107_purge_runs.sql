-- Journal des exécutions de la purge RGPD (dette P1.7).
--
-- Le cron `purge-expired-data-nightly` fait `SELECT purge_expired_data();` et
-- jetait le compte rendu : une purge qui n'efface rien, ou qui échoue, ne
-- laissait aucune trace au-delà des 7 jours de `cron.job_run_details` (qui ne
-- disent d'ailleurs que « succeeded »). Chaque exécution écrit désormais une
-- ligne dans `purge_runs`, avec le détail des courriers effacés par organisation.
--
-- Une erreur est consignée (status = 'failed', message SQLSTATE) au lieu d'être
-- relevée : relever annulerait la transaction, et la ligne du journal avec. Le
-- travail de purge, lui, est bien annulé (bloc EXCEPTION = sous-transaction).

CREATE TABLE IF NOT EXISTS public.purge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE INDEX IF NOT EXISTS idx_purge_runs_started_at ON public.purge_runs (started_at DESC);

COMMENT ON TABLE public.purge_runs IS
  'Une ligne par exécution de purge_expired_data() : compteurs, détail par organisation (report.by_organization), erreur éventuelle. Conservé 1 an.';

ALTER TABLE public.purge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purge_runs FROM anon, authenticated;
DROP POLICY IF EXISTS service_role_full ON public.purge_runs;
CREATE POLICY service_role_full ON public.purge_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.purge_expired_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  org RECORD;
  v_started_at timestamptz := clock_timestamp();
  v_courier_cutoff timestamptz;
  v_deleted_couriers int := 0;
  v_total_couriers int := 0;
  v_trashed_couriers int := 0;
  v_deleted_notifications int := 0;
  v_deleted_analysis_jobs int := 0;
  v_deleted_sync_runs int := 0;
  v_deleted_purge_runs int := 0;
  v_by_org jsonb := '{}'::jsonb;
  v_report jsonb;
  v_error text;
BEGIN
  BEGIN
    -- Corbeille : 30 jours après la mise à la corbeille, quel que soit le
    -- réglage de rétention de l'organisation. Les réponses partent par cascade.
    WITH del AS (
      DELETE FROM public.couriers
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - interval '30 days'
        AND parent_courier_id IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_trashed_couriers FROM del;

    FOR org IN
      SELECT id, courier_retention_days
      FROM public.organizations
      WHERE courier_retention_days IS NOT NULL
    LOOP
      IF org.courier_retention_days > 0 THEN
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
        IF v_deleted_couriers > 0 THEN
          v_by_org := v_by_org || jsonb_build_object(org.id::text, v_deleted_couriers);
        END IF;
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

    -- Le journal de la purge elle-même : un an suffit pour répondre à
    -- « la purge a-t-elle tourné, et qu'a-t-elle effacé ? ».
    WITH del AS (
      DELETE FROM public.purge_runs
      WHERE started_at < now() - interval '1 year'
      RETURNING 1
    )
    SELECT count(*) INTO v_deleted_purge_runs FROM del;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLSTATE || ' ' || SQLERRM;
    RAISE WARNING 'purge_expired_data a échoué : %', v_error;
  END;

  IF v_error IS NULL THEN
    v_report := jsonb_build_object(
      'ran_at', v_started_at,
      'deleted_couriers', v_total_couriers,
      'trashed_couriers_purged', v_trashed_couriers,
      'deleted_notifications', v_deleted_notifications,
      'deleted_analysis_jobs', v_deleted_analysis_jobs,
      'deleted_sync_runs', v_deleted_sync_runs,
      'deleted_purge_runs', v_deleted_purge_runs,
      'by_organization', v_by_org
    );
  ELSE
    v_report := jsonb_build_object('ran_at', v_started_at, 'error', v_error);
  END IF;

  INSERT INTO public.purge_runs (started_at, status, report, error)
  VALUES (
    v_started_at,
    CASE WHEN v_error IS NULL THEN 'succeeded' ELSE 'failed' END,
    v_report,
    v_error
  );

  RETURN v_report;
END;
$function$;

-- CREATE OR REPLACE conserve les droits, mais on les repose explicitement :
-- la purge ne s'exécute qu'en service_role (cron, harnais de tests).
REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
