-- Ajout d'un paramètre d'offset à search_usagers, pour permettre l'export
-- complet (paginé) de la liste filtrée des usagers sans être limité au
-- plafond utilisé par l'écran (200 lignes). DROP + CREATE car on ajoute
-- un paramètre.
DROP FUNCTION IF EXISTS public.search_usagers(uuid, text, uuid[], int, int, date, date, int[], int[], int);

CREATE FUNCTION public.search_usagers(
  p_org_id               uuid,
  p_search               text    DEFAULT NULL,
  p_quartier_ids         uuid[]  DEFAULT NULL,
  p_min_inbound          int     DEFAULT NULL,
  p_max_inbound          int     DEFAULT NULL,
  p_sent_from            date    DEFAULT NULL,
  p_sent_to              date    DEFAULT NULL,
  p_marriage_anniv_years int[]   DEFAULT NULL,
  p_birthday_years       int[]   DEFAULT NULL,
  p_limit                int     DEFAULT 200,
  p_offset               int     DEFAULT 0
)
RETURNS TABLE (
  id                  uuid,
  organization_id     uuid,
  category             usager_category,
  civilite             usager_civilite,
  first_name           text,
  last_name            text,
  email                text,
  phone                text,
  created_at           timestamptz,
  updated_at           timestamptz,
  created_by           uuid,
  quartier_id          uuid,
  quartier_auto        boolean,
  usual_name           text,
  birth_date           date,
  death_date           date,
  family_status        usager_family_status,
  marriage_date        date,
  pacs_date            date,
  arrival_date         date,
  departure_date       date,
  nationality          text,
  address_number       text,
  address_btq          text,
  address_street       text,
  address_building     text,
  address_apartment    text,
  address_complement   text,
  address_postal_code  text,
  address_city         text,
  address_lat          double precision,
  address_lon          double precision,
  phone_2              text,
  inbound_count        bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    u.id, u.organization_id, u.category, u.civilite, u.first_name, u.last_name,
    u.email, u.phone, u.created_at, u.updated_at, u.created_by,
    u.quartier_id, u.quartier_auto, u.usual_name, u.birth_date, u.death_date,
    u.family_status, u.marriage_date, u.pacs_date, u.arrival_date, u.departure_date, u.nationality,
    u.address_number, u.address_btq, u.address_street, u.address_building,
    u.address_apartment, u.address_complement, u.address_postal_code, u.address_city,
    u.address_lat, u.address_lon, u.phone_2,
    COALESCE(ic.inbound_count, 0) AS inbound_count
  FROM usagers u
  LEFT JOIN (
    SELECT cp.usager_id, COUNT(DISTINCT cp.courier_id) AS inbound_count
    FROM courier_participants cp
    JOIN couriers c ON c.id = cp.courier_id
    WHERE c.organization_id = p_org_id
      AND c.direction = 'inbound'
      AND cp.usager_id IS NOT NULL
    GROUP BY cp.usager_id
  ) ic ON ic.usager_id = u.id
  WHERE u.organization_id = p_org_id
    AND (
      p_search IS NULL OR trim(p_search) = '' OR
      u.last_name ILIKE '%' || p_search || '%' OR
      u.first_name ILIKE '%' || p_search || '%' OR
      u.email ILIKE '%' || p_search || '%' OR
      u.phone ILIKE '%' || p_search || '%'
    )
    AND (p_quartier_ids IS NULL OR u.quartier_id = ANY(p_quartier_ids))
    AND (p_min_inbound IS NULL OR COALESCE(ic.inbound_count, 0) >= p_min_inbound)
    AND (p_max_inbound IS NULL OR COALESCE(ic.inbound_count, 0) <= p_max_inbound)
    AND (
      (p_sent_from IS NULL AND p_sent_to IS NULL) OR EXISTS (
        SELECT 1
        FROM courier_participants cp2
        JOIN couriers c2 ON c2.id = cp2.courier_id
        WHERE cp2.usager_id = u.id
          AND c2.organization_id = p_org_id
          AND c2.direction = 'inbound'
          AND (p_sent_from IS NULL OR c2.received_at::date >= p_sent_from)
          AND (p_sent_to   IS NULL OR c2.received_at::date <= p_sent_to)
      )
    )
    -- Grands anniversaires de mariage : exclut explicitement les personnes
    -- divorcées, même si elles ont une date de mariage renseignée.
    AND (
      p_marriage_anniv_years IS NULL OR (
        u.family_status IS DISTINCT FROM 'divorce'::usager_family_status
        AND u.marriage_date IS NOT NULL
        AND EXTRACT(YEAR FROM u.marriage_date)::int = ANY (
          ARRAY(SELECT EXTRACT(YEAR FROM now())::int - x FROM unnest(p_marriage_anniv_years) AS x)
        )
      )
    )
    -- Grands anniversaires (âge atteint dans l'année courante, basé sur l'année de naissance).
    AND (
      p_birthday_years IS NULL OR (
        u.birth_date IS NOT NULL
        AND EXTRACT(YEAR FROM u.birth_date)::int = ANY (
          ARRAY(SELECT EXTRACT(YEAR FROM now())::int - x FROM unnest(p_birthday_years) AS x)
        )
      )
    )
  ORDER BY u.last_name ASC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;

REVOKE EXECUTE ON FUNCTION public.search_usagers(uuid, text, uuid[], int, int, date, date, int[], int[], int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_usagers(uuid, text, uuid[], int, int, date, date, int[], int[], int, int) TO authenticated;
