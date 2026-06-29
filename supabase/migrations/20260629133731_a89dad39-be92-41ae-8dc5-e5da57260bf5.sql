
-- 1) Cascade replies on parent deletion (sinon la purge d'un courrier parent serait bloquée par ses réponses)
ALTER TABLE public.couriers
  DROP CONSTRAINT IF EXISTS couriers_parent_courier_id_fkey;
ALTER TABLE public.couriers
  ADD CONSTRAINT couriers_parent_courier_id_fkey
  FOREIGN KEY (parent_courier_id) REFERENCES public.couriers(id) ON DELETE CASCADE;

-- 2) Fonction de purge nocturne — courriers + usagers inactifs au-delà de la rétention configurée par org
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org RECORD;
  v_courier_cutoff timestamptz;
  v_usager_cutoff timestamptz;
  v_deleted_couriers int := 0;
  v_deleted_usagers int := 0;
  v_total_couriers int := 0;
  v_total_usagers int := 0;
BEGIN
  FOR org IN
    SELECT id, courier_retention_days, usager_retention_days
    FROM public.organizations
    WHERE courier_retention_days IS NOT NULL OR usager_retention_days IS NOT NULL
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

    -- Usagers : aucune activité (updated_at, dernier courrier auquel l'usager participe) depuis N jours
    IF org.usager_retention_days IS NOT NULL AND org.usager_retention_days > 0 THEN
      v_usager_cutoff := now() - make_interval(days => org.usager_retention_days);

      WITH activity AS (
        SELECT u.id,
          GREATEST(
            u.updated_at,
            COALESCE((
              SELECT max(c.updated_at)
              FROM public.courier_participants p
              JOIN public.couriers c ON c.id = p.courier_id
              WHERE p.usager_id = u.id
            ), u.updated_at)
          ) AS last_activity_at
        FROM public.usagers u
        WHERE u.organization_id = org.id
      ),
      del AS (
        DELETE FROM public.usagers u
        USING activity a
        WHERE u.id = a.id
          AND a.last_activity_at < v_usager_cutoff
        RETURNING 1
      )
      SELECT count(*) INTO v_deleted_usagers FROM del;

      v_total_usagers := v_total_usagers + v_deleted_usagers;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'deleted_couriers', v_total_couriers,
    'deleted_usagers', v_total_usagers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_data() TO service_role;

-- 3) Planification pg_cron : tous les jours à 00:00 UTC (~01:00 Paris en hiver, ~02:00 en été)
DO $$
BEGIN
  PERFORM cron.unschedule('purge-expired-data-nightly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-data-nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-expired-data-nightly',
  '0 0 * * *',
  $$ SELECT public.purge_expired_data(); $$
);
