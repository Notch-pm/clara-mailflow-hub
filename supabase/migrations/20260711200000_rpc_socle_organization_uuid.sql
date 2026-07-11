-- Dette technique phase 3 : les RPC stats/recherche filtraient par TEXTE
-- (couriers.assigned_service = nom). Bascule sur couriers.socle_organization_id (UUID).
-- assigned_service reste une dénormalisation d'affichage (toujours écrite),
-- mais plus aucune logique ne compare des noms.
-- Les anciennes signatures sont DROPpées (une surcharge rendrait l'appel RPC ambigu).

-- ─── stats_inbound_by_month ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_inbound_by_month(uuid, integer, text);
CREATE OR REPLACE FUNCTION public.stats_inbound_by_month(
  p_org_id uuid,
  p_months integer DEFAULT 12,
  p_socle_organization_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(month text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    to_char(date_trunc('month', received_at), 'YYYY-MM') AS month,
    COUNT(*)::bigint                                      AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= date_trunc('month', now()) - ((p_months - 1) * INTERVAL '1 month')
    AND (p_socle_organization_id IS NULL OR socle_organization_id = p_socle_organization_id)
  GROUP BY date_trunc('month', received_at)
  ORDER BY date_trunc('month', received_at);
$function$;

-- ─── stats_inbound_by_day ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_inbound_by_day(uuid, text);
CREATE OR REPLACE FUNCTION public.stats_inbound_by_day(
  p_org_id uuid,
  p_socle_organization_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(day text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    to_char(date_trunc('day', received_at), 'YYYY-MM-DD') AS day,
    COUNT(*)::bigint                                        AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= now() - INTERVAL '30 days'
    AND (p_socle_organization_id IS NULL OR socle_organization_id = p_socle_organization_id)
  GROUP BY date_trunc('day', received_at)
  ORDER BY date_trunc('day', received_at);
$function$;

-- ─── stats_by_channel ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_by_channel(uuid, timestamp with time zone, text);
CREATE OR REPLACE FUNCTION public.stats_by_channel(
  p_org_id uuid,
  p_since timestamp with time zone DEFAULT (now() - '30 days'::interval),
  p_socle_organization_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(channel text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(channel::text, 'inconnu') AS channel,
    COUNT(*)::bigint              AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= p_since
    AND (p_socle_organization_id IS NULL OR socle_organization_id = p_socle_organization_id)
  GROUP BY channel
  ORDER BY count DESC;
$function$;

-- ─── stats_tag_evolution ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_tag_evolution(uuid, timestamp with time zone, text);
CREATE OR REPLACE FUNCTION public.stats_tag_evolution(
  p_org_id uuid,
  p_since timestamp with time zone DEFAULT (now() - '1 year'::interval),
  p_socle_organization_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(period text, tag_name text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    to_char(date_trunc('month', c.received_at), 'YYYY-MM') AS period,
    tag_name,
    COUNT(*)::bigint                                         AS count
  FROM couriers c,
    jsonb_array_elements_text(c.metadata -> 'tags') AS tag_name
  WHERE c.organization_id = p_org_id
    AND c.received_at >= p_since
    AND c.metadata ? 'tags'
    AND jsonb_array_length(c.metadata -> 'tags') > 0
    AND (p_socle_organization_id IS NULL OR c.socle_organization_id = p_socle_organization_id)
  GROUP BY date_trunc('month', c.received_at), tag_name
  ORDER BY date_trunc('month', c.received_at), tag_name;
$function$;

-- ─── stats_replies_by_month ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_replies_by_month(uuid, integer, text);
CREATE OR REPLACE FUNCTION public.stats_replies_by_month(
  p_org_id uuid,
  p_months integer DEFAULT 12,
  p_socle_organization_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(month text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    to_char(date_trunc('month', COALESCE(sent_at, created_at)), 'YYYY-MM') AS month,
    COUNT(*)::bigint                                                          AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'outbound'
    AND parent_courier_id IS NOT NULL
    AND COALESCE(sent_at, created_at) >= date_trunc('month', now()) - ((p_months - 1) * INTERVAL '1 month')
    AND (p_socle_organization_id IS NULL OR socle_organization_id = p_socle_organization_id)
  GROUP BY date_trunc('month', COALESCE(sent_at, created_at))
  ORDER BY date_trunc('month', COALESCE(sent_at, created_at));
$function$;

-- ─── stats_by_service : groupé par UUID, nom joint depuis le miroir ──────────────
DROP FUNCTION IF EXISTS public.stats_by_service(uuid, text, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.stats_by_service(
  p_org_id uuid,
  p_direction text,
  p_since timestamp with time zone DEFAULT (now() - '30 days'::interval)
)
RETURNS TABLE(socle_organization_id uuid, service_name text, count bigint)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    c.socle_organization_id,
    COALESCE(so.name, c.assigned_service, 'Non assigné') AS service_name,
    COUNT(*)::bigint                                       AS count
  FROM couriers c
  LEFT JOIN socle_organizations so ON so.id = c.socle_organization_id
  WHERE c.organization_id = p_org_id
    AND c.direction::text = p_direction
    AND COALESCE(c.received_at, c.sent_at, c.created_at) >= p_since
  GROUP BY c.socle_organization_id, COALESCE(so.name, c.assigned_service, 'Non assigné')
  ORDER BY count DESC;
$function$;

-- ─── stats_processing_times : groupé par UUID ────────────────────────────────────
DROP FUNCTION IF EXISTS public.stats_processing_times(uuid, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.stats_processing_times(
  p_org_id uuid,
  p_since timestamp with time zone DEFAULT (now() - '1 year'::interval)
)
RETURNS TABLE(socle_organization_id uuid, service_name text, avg_days_to_instruction double precision, avg_days_to_processed double precision, courier_count bigint)
LANGUAGE sql STABLE
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
      ON ws.id = (ce.payload ->> 'to_id')::uuid
    WHERE c.organization_id = p_org_id
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
  LEFT JOIN socle_organizations so ON so.id = t.socle_organization_id
  GROUP BY t.socle_organization_id, so.name
  ORDER BY avg_days_to_processed DESC NULLS LAST;
$function$;

-- ─── search_couriers : filtre par UUID d'organisation ────────────────────────────
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, text, text, text[], date, date, integer, integer);
CREATE OR REPLACE FUNCTION public.search_couriers(
  p_organization_id uuid,
  p_direction text DEFAULT NULL::text,
  p_workflow_state_id uuid DEFAULT NULL::uuid,
  p_socle_organization_id uuid DEFAULT NULL::uuid,
  p_keywords text DEFAULT NULL::text,
  p_tag_names text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, subject text, direction text, received_at timestamp with time zone, workflow_state_id uuid, assigned_service text, socle_organization_id uuid, organization_id uuid, match_in text[], total_count bigint)
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
      c.workflow_state_id, c.assigned_service, c.socle_organization_id, c.organization_id,
      c.fts_subject, c.fts_body
    FROM couriers c
    WHERE c.organization_id = p_organization_id
      AND public.is_member_of(p_organization_id)
      AND (p_direction              IS NULL OR c.direction             = p_direction::courier_direction)
      AND (p_workflow_state_id      IS NULL OR c.workflow_state_id    = p_workflow_state_id)
      AND (p_socle_organization_id  IS NULL OR c.socle_organization_id = p_socle_organization_id)
      AND (p_date_from              IS NULL OR c.received_at::date >= p_date_from)
      AND (p_date_to                IS NULL OR c.received_at::date <= p_date_to)
      AND (p_tag_names              IS NULL OR (c.metadata->'tags') ?| p_tag_names)
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
      b.workflow_state_id, b.assigned_service, b.socle_organization_id, b.organization_id,
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

REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer) FROM anon;
