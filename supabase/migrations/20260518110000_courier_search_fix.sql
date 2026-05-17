-- Fix search_couriers: direction as text (cast internally) + tags filter
-- Tags are stored in couriers.metadata->'tags' as a JSONB string array.

CREATE OR REPLACE FUNCTION search_couriers(
  p_organization_id   uuid,
  p_direction         text      DEFAULT NULL,   -- text, cast to courier_direction inside
  p_workflow_state_id uuid      DEFAULT NULL,
  p_service           text      DEFAULT NULL,
  p_keywords          text      DEFAULT NULL,
  p_tag_names         text[]    DEFAULT NULL,   -- filter by any of these tag names
  p_date_from         date      DEFAULT NULL,
  p_date_to           date      DEFAULT NULL,
  p_limit             int       DEFAULT 20,
  p_offset            int       DEFAULT 0
)
RETURNS TABLE(
  id                  uuid,
  subject             text,
  direction           text,
  received_at         timestamptz,
  workflow_state_id   uuid,
  assigned_service    text,
  organization_id     uuid,
  match_in            text[],
  total_count         bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION search_couriers TO authenticated;
