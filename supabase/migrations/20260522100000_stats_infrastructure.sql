-- Stats infrastructure: indexes + RPC functions for the statistics module

-- Composite index for all stats queries filtering by org, direction, date, service, channel
CREATE INDEX IF NOT EXISTS idx_couriers_stats
  ON public.couriers (organization_id, direction, received_at, assigned_service, channel);

-- Partial index on state_changed events for processing time queries
CREATE INDEX IF NOT EXISTS idx_courier_events_state_changed
  ON public.courier_events (courier_id, created_at)
  WHERE event_type = 'state_changed';


-- Courriers entrants groupés par mois (12 derniers mois par défaut)
CREATE OR REPLACE FUNCTION public.stats_inbound_by_month(
  p_org_id       uuid,
  p_months       int  DEFAULT 12,
  p_service_name text DEFAULT NULL
)
RETURNS TABLE (month text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', received_at), 'YYYY-MM') AS month,
    COUNT(*)::bigint                                      AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= date_trunc('month', now()) - ((p_months - 1) * INTERVAL '1 month')
    AND (p_service_name IS NULL OR assigned_service = p_service_name)
  GROUP BY date_trunc('month', received_at)
  ORDER BY date_trunc('month', received_at);
$$;


-- Courriers entrants groupés par jour (30 derniers jours)
CREATE OR REPLACE FUNCTION public.stats_inbound_by_day(
  p_org_id       uuid,
  p_service_name text DEFAULT NULL
)
RETURNS TABLE (day text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('day', received_at), 'YYYY-MM-DD') AS day,
    COUNT(*)::bigint                                        AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= now() - INTERVAL '30 days'
    AND (p_service_name IS NULL OR assigned_service = p_service_name)
  GROUP BY date_trunc('day', received_at)
  ORDER BY date_trunc('day', received_at);
$$;


-- Evolution des tags reçus groupée par mois
-- Les tags sont stockés dans couriers.metadata->'tags' (tableau JSON de noms)
CREATE OR REPLACE FUNCTION public.stats_tag_evolution(
  p_org_id       uuid,
  p_since        timestamptz DEFAULT now() - INTERVAL '1 year',
  p_service_name text        DEFAULT NULL
)
RETURNS TABLE (period text, tag_name text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
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
    AND (p_service_name IS NULL OR c.assigned_service = p_service_name)
  GROUP BY date_trunc('month', c.received_at), tag_name
  ORDER BY date_trunc('month', c.received_at), tag_name;
$$;


-- Courriers entrants par canal
CREATE OR REPLACE FUNCTION public.stats_by_channel(
  p_org_id       uuid,
  p_since        timestamptz DEFAULT now() - INTERVAL '30 days',
  p_service_name text        DEFAULT NULL
)
RETURNS TABLE (channel text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    COALESCE(channel::text, 'inconnu') AS channel,
    COUNT(*)::bigint              AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'inbound'
    AND received_at >= p_since
    AND (p_service_name IS NULL OR assigned_service = p_service_name)
  GROUP BY channel
  ORDER BY count DESC;
$$;


-- Courriers entrants ou sortants groupés par service
CREATE OR REPLACE FUNCTION public.stats_by_service(
  p_org_id    uuid,
  p_direction text,
  p_since     timestamptz DEFAULT now() - INTERVAL '30 days'
)
RETURNS TABLE (service_name text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    COALESCE(assigned_service, 'Non assigné') AS service_name,
    COUNT(*)::bigint                           AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = p_direction
    AND COALESCE(received_at, sent_at, created_at) >= p_since
  GROUP BY assigned_service
  ORDER BY count DESC;
$$;


-- Réponses émises (sortants avec parent_courier_id) groupées par mois
CREATE OR REPLACE FUNCTION public.stats_replies_by_month(
  p_org_id       uuid,
  p_months       int  DEFAULT 12,
  p_service_name text DEFAULT NULL
)
RETURNS TABLE (month text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', COALESCE(sent_at, created_at)), 'YYYY-MM') AS month,
    COUNT(*)::bigint                                                          AS count
  FROM couriers
  WHERE organization_id = p_org_id
    AND direction::text = 'outbound'
    AND parent_courier_id IS NOT NULL
    AND COALESCE(sent_at, created_at) >= date_trunc('month', now()) - ((p_months - 1) * INTERVAL '1 month')
    AND (p_service_name IS NULL OR assigned_service = p_service_name)
  GROUP BY date_trunc('month', COALESCE(sent_at, created_at))
  ORDER BY date_trunc('month', COALESCE(sent_at, created_at));
$$;


-- Délais de traitement moyens par service (réception → instruction et → traité)
CREATE OR REPLACE FUNCTION public.stats_processing_times(
  p_org_id uuid,
  p_since  timestamptz DEFAULT now() - INTERVAL '1 year'
)
RETURNS TABLE (
  service_name             text,
  avg_days_to_instruction  float,
  avg_days_to_processed    float,
  courier_count            bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH transitions AS (
    SELECT
      c.id,
      c.assigned_service,
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
    GROUP BY c.id, c.assigned_service, c.received_at
  )
  SELECT
    COALESCE(assigned_service, 'Non assigné')                                                    AS service_name,
    ROUND(AVG(EXTRACT(EPOCH FROM (instructed_at - received_at)) / 86400)::numeric, 1)::float     AS avg_days_to_instruction,
    ROUND(AVG(EXTRACT(EPOCH FROM (processed_at  - received_at)) / 86400)::numeric, 1)::float     AS avg_days_to_processed,
    COUNT(*)::bigint                                                                              AS courier_count
  FROM transitions
  WHERE assigned_service IS NOT NULL
  GROUP BY assigned_service
  ORDER BY avg_days_to_processed DESC NULLS LAST;
$$;
