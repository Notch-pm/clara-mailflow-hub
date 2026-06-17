-- Découpage de la commune en quartiers (polygones), association des usagers,
-- statistiques par quartier. Phase 1 : import GeoJSON uniquement (pas de
-- dessin dans l'app — cf. docs/data-model.md).

-- 1. Extension PostGIS (gratuite, incluse dans tous les plans Supabase)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Table quartiers
CREATE TABLE public.quartiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  color varchar,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_quartiers_org ON public.quartiers (organization_id);
CREATE INDEX idx_quartiers_geom ON public.quartiers USING GIST (geom);

ALTER TABLE public.quartiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.quartiers FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY admin_insert ON public.quartiers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.quartiers FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.quartiers FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY service_role_full ON public.quartiers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER quartiers_set_updated_at
  BEFORE UPDATE ON public.quartiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Association usager → quartier
-- quartier_auto = false dès qu'un admin force manuellement une valeur,
-- pour ne pas l'écraser lors d'un recalcul de masse après import/édition.
ALTER TABLE public.usagers
  ADD COLUMN IF NOT EXISTS quartier_id uuid REFERENCES public.quartiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quartier_auto boolean NOT NULL DEFAULT true;

CREATE INDEX idx_usagers_quartier ON public.usagers (quartier_id);

-- 4. Fonctions ----------------------------------------------------------

-- Quartier contenant un point donné (utilisée à l'assignation auto + recalcul de masse)
CREATE OR REPLACE FUNCTION public.quartier_for_point(p_org_id uuid, p_lon double precision, p_lat double precision)
RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT id FROM public.quartiers
  WHERE organization_id = p_org_id
    AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
  LIMIT 1;
$$;

-- Création d'un quartier à partir d'un GeoJSON (geometry Polygon ou MultiPolygon).
-- ST_MakeValid répare les polygones auto-intersectants (fréquents dans des
-- exports QGIS/opendata de qualité variable).
CREATE OR REPLACE FUNCTION public.create_quartier_from_geojson(
  p_org_id  uuid,
  p_name    text,
  p_color   text,
  p_geojson jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_geom geometry;
  v_id uuid;
BEGIN
  v_geom := ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326));
  IF GeometryType(v_geom) = 'POLYGON' THEN
    v_geom := ST_Multi(v_geom);
  END IF;

  INSERT INTO public.quartiers (organization_id, name, color, geom, created_by)
  VALUES (p_org_id, p_name, p_color, v_geom, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Lecture des quartiers en GeoJSON (pour le composant <GeoJSON> de react-leaflet).
-- PostGIS stocke en geometry binaire : sans ce cast côté serveur, le client
-- recevrait du WKB illisible par Leaflet.
CREATE OR REPLACE FUNCTION public.list_quartiers_geojson(p_org_id uuid)
RETURNS TABLE (id uuid, name text, color text, geojson json)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT id, name, color, ST_AsGeoJSON(geom)::json
  FROM public.quartiers
  WHERE organization_id = p_org_id
  ORDER BY name;
$$;

-- Réapplique quartier_for_point à tous les usagers en assignation automatique
-- (utile après import/édition d'un polygone).
CREATE OR REPLACE FUNCTION public.recalculate_usager_quartiers(p_org_id uuid)
RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$
  UPDATE public.usagers u
  SET quartier_id = public.quartier_for_point(p_org_id, u.address_lon, u.address_lat)
  WHERE u.organization_id = p_org_id
    AND u.quartier_auto = true
    AND u.address_lat IS NOT NULL
    AND u.address_lon IS NOT NULL;
$$;

-- Statistiques : nombre d'usagers par quartier, + ligne "Sans quartier"
CREATE OR REPLACE FUNCTION public.stats_usagers_by_quartier(p_org_id uuid)
RETURNS TABLE (quartier_id uuid, quartier_name text, color text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT q.id, q.name, q.color, COUNT(u.id)::bigint
  FROM public.quartiers q
  LEFT JOIN public.usagers u ON u.quartier_id = q.id AND u.organization_id = p_org_id
  WHERE q.organization_id = p_org_id
  GROUP BY q.id, q.name, q.color
  UNION ALL
  SELECT NULL::uuid, 'Sans quartier', NULL::text, COUNT(*)::bigint
  FROM public.usagers
  WHERE organization_id = p_org_id AND quartier_id IS NULL
  ORDER BY count DESC;
$$;

-- Substitut pragmatique à "rues hors quartiers" : usagers géolocalisés ne
-- tombant dans aucun polygone de quartier (aucune donnée de voirie externe).
CREATE OR REPLACE FUNCTION public.usagers_outside_quartiers(p_org_id uuid)
RETURNS TABLE (id uuid, first_name text, last_name text, address_lat double precision, address_lon double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT u.id, u.first_name, u.last_name, u.address_lat, u.address_lon
  FROM public.usagers u
  WHERE u.organization_id = p_org_id
    AND u.address_lat IS NOT NULL AND u.address_lon IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.quartiers q
      WHERE q.organization_id = p_org_id
        AND ST_Contains(q.geom, ST_SetSRID(ST_MakePoint(u.address_lon, u.address_lat), 4326))
    );
$$;

REVOKE EXECUTE ON FUNCTION public.quartier_for_point(uuid, double precision, double precision) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_quartier_from_geojson(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_quartiers_geojson(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_usager_quartiers(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stats_usagers_by_quartier(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usagers_outside_quartiers(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.quartier_for_point(uuid, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_quartier_from_geojson(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_quartiers_geojson(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_usager_quartiers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stats_usagers_by_quartier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.usagers_outside_quartiers(uuid) TO authenticated;
