-- Performance — `stats_processing_times` (12,5 s sur ACCM après 20261014170000).
--
-- En SECURITY INVOKER, la jointure sur `courier_events` et `workflow_states`
-- rejouait leurs policies (`is_member_of` + `can_read_courier`) à chaque ligne.
-- La fonction passe en SECURITY DEFINER et fait elle-même ce que la RLS
-- faisait : appartenance vérifiée UNE fois (`is_member_of(p_org_id)`, sans
-- colonne : filtre évalué une seule fois), puis visibilité des courriers
-- reprise de `couriers.auth_select` (supprimés et confidentiels non lisibles
-- exclus). Les événements, états et organisations lus sont ceux de ces seuls
-- courriers, de la même organisation.

CREATE OR REPLACE FUNCTION public.stats_processing_times(
  p_org_id uuid,
  p_since timestamp with time zone DEFAULT (now() - '1 year'::interval)
)
RETURNS TABLE(socle_organization_id uuid, service_name text, avg_days_to_instruction double precision, avg_days_to_processed double precision, courier_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH transitions AS (
    SELECT
      c.id,
      c.socle_organization_id,
      c.received_at,
      MIN(ce.created_at) FILTER (WHERE ws.category = 'processing') AS instructed_at,
      MIN(ce.created_at) FILTER (WHERE ws.category = 'processed')  AS processed_at
    FROM couriers c
    LEFT JOIN courier_events ce
      ON ce.courier_id = c.id AND ce.event_type = 'state_changed'
    LEFT JOIN workflow_states ws
      ON ws.id = (ce.payload ->> 'to_id')::uuid AND ws.organization_id = c.organization_id
    WHERE public.is_member_of(p_org_id)
      AND c.organization_id = p_org_id
      AND c.deleted_at IS NULL
      AND (NOT c.is_confidential
           OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata))
      AND c.direction::text = 'inbound'
      AND c.received_at >= p_since
      AND c.received_at IS NOT NULL
      AND c.socle_organization_id IS NOT NULL
    GROUP BY c.id, c.socle_organization_id, c.received_at
  )
  SELECT
    t.socle_organization_id,
    COALESCE(so.name, 'Non assigné')                                                             AS service_name,
    ROUND(AVG(EXTRACT(EPOCH FROM (t.instructed_at - t.received_at)) / 86400)::numeric, 1)::float AS avg_days_to_instruction,
    ROUND(AVG(EXTRACT(EPOCH FROM (t.processed_at  - t.received_at)) / 86400)::numeric, 1)::float AS avg_days_to_processed,
    COUNT(*)::bigint                                                                              AS courier_count
  FROM transitions t
  LEFT JOIN socle_organizations so ON so.id = t.socle_organization_id AND so.organization_id = p_org_id
  GROUP BY t.socle_organization_id, so.name
  ORDER BY avg_days_to_processed DESC NULLS LAST;
$function$;

REVOKE EXECUTE ON FUNCTION public.stats_processing_times(uuid, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stats_processing_times(uuid, timestamp with time zone) TO authenticated, service_role;
