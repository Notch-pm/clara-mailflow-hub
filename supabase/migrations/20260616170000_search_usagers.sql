-- Recherche avancée des usagers (/usagers) : texte libre + quartiers
-- (multi-sélection) + plage du nombre de courriers entrants reçus.

CREATE OR REPLACE FUNCTION public.search_usagers(
  p_org_id       uuid,
  p_search       text    DEFAULT NULL,
  p_quartier_ids uuid[]  DEFAULT NULL,
  p_min_inbound  int     DEFAULT NULL,
  p_max_inbound  int     DEFAULT NULL,
  p_limit        int     DEFAULT 200
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
    u.family_status, u.arrival_date, u.departure_date, u.nationality,
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
  ORDER BY u.last_name ASC NULLS LAST
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.search_usagers(uuid, text, uuid[], int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_usagers(uuid, text, uuid[], int, int, int) TO authenticated;
