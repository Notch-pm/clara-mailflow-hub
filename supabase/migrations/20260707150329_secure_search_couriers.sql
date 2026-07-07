-- Ferme la fuite inter-tenant de search_couriers (SECURITY DEFINER exposée à anon,
-- filtrée uniquement sur un organization_id fourni par l'appelant).
-- Ajoute une garde d'appartenance, fige le search_path, et retire l'accès anon.
CREATE OR REPLACE FUNCTION public.search_couriers(
  p_organization_id uuid,
  p_direction text DEFAULT NULL::text,
  p_workflow_state_id uuid DEFAULT NULL::uuid,
  p_service text DEFAULT NULL::text,
  p_keywords text DEFAULT NULL::text,
  p_tag_names text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, subject text, direction text, received_at timestamp with time zone, workflow_state_id uuid, assigned_service text, organization_id uuid, match_in text[], total_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tsq AS (
    SELECT
      CASE
        WHEN p_keywords IS NOT NULL AND trim(p_keywords) <> ''
        THEN websearch_to_tsquery('french', p_keywords)
      END AS q
  ),
  base AS (
    SELECT
      c.id, c.subject, c.direction::text, c.received_at,
      c.workflow_state_id, c.assigned_service, c.organization_id,
      c.fts_subject, c.fts_body
    FROM couriers c
    WHERE c.organization_id = p_organization_id
      AND public.is_member_of(p_organization_id)
      AND (p_direction         IS NULL OR c.direction         = p_direction::courier_direction)
      AND (p_workflow_state_id IS NULL OR c.workflow_state_id = p_workflow_state_id)
      AND (p_service           IS NULL OR c.assigned_service  = p_service)
      AND (p_date_from         IS NULL OR c.received_at::date >= p_date_from)
      AND (p_date_to           IS NULL OR c.received_at::date <= p_date_to)
      AND (p_tag_names         IS NULL OR (c.metadata->'tags') ?| p_tag_names)
  ),
  kw_matches AS (
    SELECT
      b.id,
      array_remove(ARRAY[
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL
              AND b.fts_subject @@ (SELECT q FROM tsq)
             THEN 'subject' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL
              AND b.fts_body @@ (SELECT q FROM tsq)
             THEN 'body' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL
              AND EXISTS(
                SELECT 1 FROM courier_participants cp
                WHERE cp.courier_id = b.id
                  AND cp.fts_participant @@ (SELECT q FROM tsq)
              )
             THEN 'participants' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL
              AND EXISTS(
                SELECT 1 FROM courier_document_extracts de
                WHERE de.courier_id = b.id
                  AND de.fts_extract @@ (SELECT q FROM tsq)
              )
             THEN 'documents' END
      ], NULL) AS match_in
    FROM base b
    WHERE (SELECT q FROM tsq) IS NULL
       OR b.fts_subject @@ (SELECT q FROM tsq)
       OR b.fts_body    @@ (SELECT q FROM tsq)
       OR EXISTS(
            SELECT 1 FROM courier_participants cp
            WHERE cp.courier_id = b.id
              AND cp.fts_participant @@ (SELECT q FROM tsq)
          )
       OR EXISTS(
            SELECT 1 FROM courier_document_extracts de
            WHERE de.courier_id = b.id
              AND de.fts_extract @@ (SELECT q FROM tsq)
          )
  ),
  result_set AS (
    SELECT
      b.id, b.subject, b.direction, b.received_at,
      b.workflow_state_id, b.assigned_service, b.organization_id,
      km.match_in,
      COUNT(*) OVER() AS total_count
    FROM base b
    JOIN kw_matches km ON km.id = b.id
    ORDER BY b.received_at DESC
    LIMIT  p_limit
    OFFSET p_offset
  )
  SELECT * FROM result_set;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, text, text, text[], date, date, integer, integer) FROM anon;
