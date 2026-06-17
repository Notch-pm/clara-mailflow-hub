-- Import GeoJSON atomique + dédoublonnage automatique des noms en collision
-- (ex: plusieurs communes ayant chacune un quartier "Centre"/"Bourg").

-- Met aussi à jour la fonction d'import unitaire avec le même garde-fou,
-- pour qu'elle reste cohérente (utilisée par la Phase 2 / dessin futur).
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
  v_final_name text;
  v_suffix int := 1;
  v_id uuid;
BEGIN
  v_geom := ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326));
  IF GeometryType(v_geom) = 'POLYGON' THEN
    v_geom := ST_Multi(v_geom);
  END IF;

  v_final_name := p_name;
  WHILE EXISTS (
    SELECT 1 FROM public.quartiers q WHERE q.organization_id = p_org_id AND q.name = v_final_name
  ) LOOP
    v_suffix := v_suffix + 1;
    v_final_name := p_name || ' (' || v_suffix || ')';
  END LOOP;

  INSERT INTO public.quartiers (organization_id, name, color, geom, created_by)
  VALUES (p_org_id, v_final_name, p_color, v_geom, auth.uid())
  RETURNING quartiers.id INTO v_id;

  RETURN v_id;
END;
$$;

-- Import en lot : un seul appel de fonction = une seule transaction
-- implicite côté Postgres -> si un élément échoue (géométrie invalide…),
-- tout le lot est annulé, pas d'import partiel comme avec N appels séparés.
CREATE OR REPLACE FUNCTION public.create_quartiers_batch(p_org_id uuid, p_items jsonb)
RETURNS TABLE (quartier_id uuid, quartier_name text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  item jsonb;
  v_geom geometry;
  v_name text;
  v_final_name text;
  v_suffix int;
  v_new_id uuid;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_geom := ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON((item->'geometry')::text), 4326));
    IF GeometryType(v_geom) = 'POLYGON' THEN
      v_geom := ST_Multi(v_geom);
    END IF;

    v_name := item->>'name';
    v_final_name := v_name;
    v_suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.quartiers q WHERE q.organization_id = p_org_id AND q.name = v_final_name
    ) LOOP
      v_suffix := v_suffix + 1;
      v_final_name := v_name || ' (' || v_suffix || ')';
    END LOOP;

    INSERT INTO public.quartiers (organization_id, name, color, geom, created_by)
    VALUES (p_org_id, v_final_name, item->>'color', v_geom, auth.uid())
    RETURNING quartiers.id INTO v_new_id;

    quartier_id := v_new_id;
    quartier_name := v_final_name;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_quartiers_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quartiers_batch(uuid, jsonb) TO authenticated;
