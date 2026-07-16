-- Le Socle devient la source de vérité des contacts (ex-usagers).
-- Clara ne stocke plus aucune donnée d'identité : chaque participant d'un
-- courrier porte une simple référence `socle_contact_id` (uuid du contact dans
-- le Socle, sans FK — référentiel externe, lecture/écriture via contacts-api).
-- Les fonctionnalités quartiers et fichier domiciliaire sont retirées de Clara
-- (portage prévu côté Socle — instantané de référence dans le repo Socle,
-- references/clara-quartiers/).

-- 1. Référence au contact Socle sur les participants (ex soft-link usager_id)
ALTER TABLE public.courier_participants RENAME COLUMN usager_id TO socle_contact_id;
ALTER INDEX IF EXISTS idx_courier_participants_usager RENAME TO idx_courier_participants_socle_contact;

-- 2. RPC usagers / quartiers (signatures live)
DROP FUNCTION IF EXISTS public.search_usagers(uuid, text, uuid[], integer, integer, date, date, integer[], integer[], integer, integer);
DROP FUNCTION IF EXISTS public.recalculate_usager_quartiers(uuid);
DROP FUNCTION IF EXISTS public.quartier_for_point(uuid, double precision, double precision);
DROP FUNCTION IF EXISTS public.stats_usagers_by_quartier(uuid);
DROP FUNCTION IF EXISTS public.usagers_outside_quartiers(uuid);
DROP FUNCTION IF EXISTS public.create_quartier_from_geojson(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.list_quartiers_geojson(uuid);
DROP FUNCTION IF EXISTS public.create_quartiers_batch(uuid, jsonb);

-- 3. Tables locales d'identité (usagers d'abord : sa FK quartier_id pointe sur quartiers)
DROP TABLE IF EXISTS public.usagers;
DROP TABLE IF EXISTS public.quartiers;

-- 4. Enums orphelins
DROP TYPE IF EXISTS public.usager_category;
DROP TYPE IF EXISTS public.usager_civilite;
DROP TYPE IF EXISTS public.usager_family_status;

-- 5. Colonnes de configuration devenues sans objet
ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS domiciliary_file_enabled,
  DROP COLUMN IF EXISTS usager_retention_days;

-- 6. Purge nocturne : le volet usagers disparaît (les contacts vivent au Socle)
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

  RETURN jsonb_build_object(
    'ran_at', now(),
    'deleted_couriers', v_total_couriers
  );
END;
$function$;
