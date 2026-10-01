-- Délais de traitement des courriers reçus (SLA) : accusé de réception et résolution.
--
-- 1. Les OBJECTIFS sont portés par les organisations (`socle_organizations`), en jours
--    ouvrés, à côté de leur workflow : NULL = hérite de l'organisation parente. Le nœud
--    racine porte donc les délais de la collectivité, une sous-organisation ne renseigne
--    que ce qui diffère. La synchronisation du Socle n'écrit jamais ces colonnes
--    (`mapSocleOrganization` ne connaît que les champs du référentiel).
-- 2. Les FAITS sont datés sur le courrier, par trigger — tous les chemins d'écriture
--    (écran, edge functions) passent par là :
--    - `acknowledged_at` : première réponse passée dans un état `processed` (envoyée).
--      `sent_at` ne convient pas : il est posé dès la création du brouillon (contrainte
--      `check_dates`).
--    - `resolved_at` : entrée dans un état `processed` ou `archived` ; effacé si le
--      courrier en ressort (réouverture, transfert qui le remet à l'état initial).
-- 3. Les ÉCHÉANCES ne sont pas stockées : elles se calculent (jours ouvrés, fériés
--    français) dans `src/lib/courier-sla.ts`, si bien qu'un objectif modifié vaut
--    aussitôt pour les courriers en cours.
--
-- Rejouable : IF NOT EXISTS, CREATE OR REPLACE, DROP … IF EXISTS.

-- ─── 1. Objectifs ──────────────────────────────────────────────────────────────
ALTER TABLE public.socle_organizations
  ADD COLUMN IF NOT EXISTS sla_ack_business_days integer,
  ADD COLUMN IF NOT EXISTS sla_resolution_business_days integer;

ALTER TABLE public.socle_organizations
  DROP CONSTRAINT IF EXISTS socle_organizations_sla_ack_check,
  DROP CONSTRAINT IF EXISTS socle_organizations_sla_resolution_check;
ALTER TABLE public.socle_organizations
  ADD CONSTRAINT socle_organizations_sla_ack_check
    CHECK (sla_ack_business_days IS NULL OR sla_ack_business_days BETWEEN 1 AND 365),
  ADD CONSTRAINT socle_organizations_sla_resolution_check
    CHECK (sla_resolution_business_days IS NULL OR sla_resolution_business_days BETWEEN 1 AND 3650);

COMMENT ON COLUMN public.socle_organizations.sla_ack_business_days IS
  'Délai souhaité avant accusé de réception (première réponse envoyée), en jours ouvrés. NULL = hérite du parent.';
COMMENT ON COLUMN public.socle_organizations.sla_resolution_business_days IS
  'Délai souhaité avant résolution (état processed/archived), en jours ouvrés. NULL = hérite du parent.';

-- ─── 2. Faits ──────────────────────────────────────────────────────────────────
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

COMMENT ON COLUMN public.couriers.acknowledged_at IS
  'Courrier reçu : date de la première réponse envoyée (réponse entrée dans un état processed). Posée par trigger.';
COMMENT ON COLUMN public.couriers.resolved_at IS
  'Courrier reçu : date d''entrée dans un état processed/archived, NULL s''il en ressort. Posée par trigger.';

-- Résolution : BEFORE, sur le courrier reçu lui-même. SECURITY DEFINER pour lire la
-- catégorie de l'état quel que soit l'appelant (edge function, cron, agent).
CREATE OR REPLACE FUNCTION public.couriers_track_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_closed boolean;
  v_old_closed boolean := false;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT ws.category IN ('processed', 'archived') INTO v_new_closed
  FROM workflow_states ws WHERE ws.id = NEW.workflow_state_id;
  v_new_closed := COALESCE(v_new_closed, false);

  IF TG_OP = 'UPDATE' AND OLD.workflow_state_id IS NOT NULL THEN
    SELECT ws.category IN ('processed', 'archived') INTO v_old_closed
    FROM workflow_states ws WHERE ws.id = OLD.workflow_state_id;
    v_old_closed := COALESCE(v_old_closed, false);
  END IF;

  IF NOT v_new_closed THEN
    NEW.resolved_at := NULL;
  ELSIF NOT v_old_closed OR NEW.resolved_at IS NULL THEN
    -- Passer de « traité » à « archivé » ne déplace pas la date de résolution.
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_couriers_track_resolution ON public.couriers;
CREATE TRIGGER trg_couriers_track_resolution
  BEFORE INSERT OR UPDATE OF workflow_state_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_track_resolution();

-- Accusé de réception : AFTER, depuis la réponse vers le courrier parent.
-- SECURITY DEFINER : n'écrit que `acknowledged_at` du parent d'une réponse que
-- l'appelant vient légitimement de faire avancer. N'active aucun trigger de
-- garde du parent (ceux-ci ne portent que sur workflow_state_id / metadata…).
CREATE OR REPLACE FUNCTION public.couriers_track_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.parent_courier_id IS NULL OR NEW.workflow_state_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.workflow_state_id IS NOT DISTINCT FROM NEW.workflow_state_id THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_states ws
    WHERE ws.id = NEW.workflow_state_id AND ws.category = 'processed'
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE couriers
     SET acknowledged_at = now()
   WHERE id = NEW.parent_courier_id
     AND organization_id = NEW.organization_id
     AND direction = 'inbound'
     AND acknowledged_at IS NULL;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.couriers_track_acknowledgement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.couriers_track_resolution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_track_acknowledgement ON public.couriers;
CREATE TRIGGER trg_couriers_track_acknowledgement
  AFTER INSERT OR UPDATE OF workflow_state_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_track_acknowledgement();

-- ─── Reprise de l'historique ───────────────────────────────────────────────────
-- `updated_at` ne doit pas bouger : la liste « en instruction » est triée dessus.
ALTER TABLE public.couriers DISABLE TRIGGER trigger_set_updated_at;

-- Résolution : dernière entrée dans un état clos, à défaut la dernière modification.
UPDATE public.couriers c
   SET resolved_at = COALESCE(
         (SELECT max(ce.created_at)
            FROM courier_events ce
            JOIN workflow_states ws2
              ON ws2.id::text = ce.payload ->> 'to_id'
           WHERE ce.courier_id = c.id
             AND ce.event_type = 'state_changed'
             AND ws2.category IN ('processed', 'archived')),
         c.updated_at)
  FROM workflow_states ws
 WHERE ws.id = c.workflow_state_id
   AND ws.category IN ('processed', 'archived')
   AND c.direction = 'inbound'
   AND c.resolved_at IS NULL;

-- Accusé : première réponse envoyée — journal `reply_sent`, ou réponse déjà dans
-- un état `processed` (date d'envoi du courriel, à défaut dernière modification).
WITH acks AS (
  SELECT ce.courier_id AS parent_id, min(ce.created_at) AS at
    FROM courier_events ce
   WHERE ce.event_type = 'reply_sent'
   GROUP BY ce.courier_id
  UNION ALL
  SELECT r.parent_courier_id,
         min(COALESCE(
           CASE WHEN r.metadata ->> 'sent_email_at' ~ '^\d{4}-\d{2}-\d{2}'
                THEN (r.metadata ->> 'sent_email_at')::timestamptz END,
           r.updated_at))
    FROM couriers r
    JOIN workflow_states ws ON ws.id = r.workflow_state_id AND ws.category = 'processed'
   WHERE r.direction = 'outbound' AND r.parent_courier_id IS NOT NULL
   GROUP BY r.parent_courier_id
),
first_ack AS (
  SELECT parent_id, min(at) AS at FROM acks GROUP BY parent_id
)
UPDATE public.couriers c
   SET acknowledged_at = f.at
  FROM first_ack f
 WHERE c.id = f.parent_id
   AND c.direction = 'inbound'
   AND c.acknowledged_at IS NULL;

ALTER TABLE public.couriers ENABLE TRIGGER trigger_set_updated_at;

-- ─── 3. Listes : search_couriers expose les deux faits ─────────────────────────
-- Le type de retour change : DROP puis CREATE, et les droits sont reposés.
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text);
CREATE OR REPLACE FUNCTION public.search_couriers(p_organization_id uuid, p_direction text DEFAULT NULL::text, p_workflow_state_id uuid DEFAULT NULL::uuid, p_socle_organization_id uuid DEFAULT NULL::uuid, p_keywords text DEFAULT NULL::text, p_tag_names text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_workflow_state_ids uuid[] DEFAULT NULL::uuid[], p_include_null_state boolean DEFAULT false, p_visible_socle_organization_ids uuid[] DEFAULT NULL::uuid[], p_sort_by text DEFAULT 'received_at'::text, p_prefix_match boolean DEFAULT false, p_transferred_only boolean DEFAULT NULL::boolean, p_sort_dir text DEFAULT 'desc'::text)
 RETURNS TABLE(id uuid, subject text, direction text, channel text, chrono text, received_at timestamp with time zone, sent_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, workflow_state_id uuid, assigned_service text, socle_organization_id uuid, organization_id uuid, sender_name text, sender_first_name text, sender_last_name text, recipient_name text, tags text[], is_transferred boolean, is_large_email boolean, acknowledged_at timestamp with time zone, resolved_at timestamp with time zone, match_in text[], total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tsq AS (
    SELECT public.clara_search_tsquery(p_keywords, p_prefix_match) AS q
  ),
  filtered AS (
    SELECT
      c.id,
      CASE
        WHEN p_sort_by = 'updated_at' THEN c.updated_at
        WHEN p_sort_by = 'created_at' THEN c.created_at
        WHEN p_sort_by = 'sent_at'    THEN c.sent_at
        WHEN p_sort_by IN ('chrono', 'subject', 'assigned_service') THEN NULL
        ELSE COALESCE(c.received_at, c.created_at)
      END AS sort_ts,
      lower(CASE p_sort_by
        WHEN 'chrono'           THEN c.chrono
        WHEN 'subject'          THEN c.subject
        WHEN 'assigned_service' THEN c.assigned_service
      END) AS sort_txt
    FROM couriers c
    WHERE c.organization_id = p_organization_id
      AND public.is_member_of(p_organization_id)
      AND (p_direction IS NULL OR c.direction = p_direction::courier_direction)
      AND (p_workflow_state_id IS NULL OR c.workflow_state_id = p_workflow_state_id)
      AND (
            (p_workflow_state_ids IS NULL AND NOT COALESCE(p_include_null_state, false))
         OR (p_workflow_state_ids IS NOT NULL AND c.workflow_state_id = ANY(p_workflow_state_ids))
         OR (COALESCE(p_include_null_state, false) AND c.workflow_state_id IS NULL)
      )
      AND (p_socle_organization_id IS NULL OR c.socle_organization_id = p_socle_organization_id)
      AND (
            p_visible_socle_organization_ids IS NULL
         OR c.socle_organization_id IS NULL
         OR c.socle_organization_id = ANY(p_visible_socle_organization_ids)
      )
      AND (p_date_from IS NULL OR c.received_at::date >= p_date_from)
      AND (p_date_to   IS NULL OR c.received_at::date <= p_date_to)
      AND (p_tag_names IS NULL OR (c.metadata->'tags') ?| p_tag_names)
      AND (
        p_transferred_only IS NULL
        OR p_transferred_only = EXISTS (
             SELECT 1 FROM courier_events ce
             WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
           )
      )
      AND (
            (SELECT q FROM tsq) IS NULL
         OR c.fts_subject @@ (SELECT q FROM tsq)
         OR c.fts_body    @@ (SELECT q FROM tsq)
         OR EXISTS (
              SELECT 1 FROM courier_participants cp
              WHERE cp.courier_id = c.id AND cp.fts_participant @@ (SELECT q FROM tsq)
            )
         OR EXISTS (
              SELECT 1 FROM courier_document_extracts de
              WHERE de.courier_id = c.id AND de.fts_extract @@ (SELECT q FROM tsq)
            )
      )
  ),
  paged AS (
    SELECT f.id, f.sort_ts, f.sort_txt, COUNT(*) OVER() AS total_count
    FROM filtered f
    ORDER BY
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_ts  END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_ts  END) DESC NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_txt END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_txt END) DESC NULLS LAST,
      f.id DESC
    LIMIT p_limit
    OFFSET p_offset
  ),
  result_set AS (
    SELECT
      c.id,
      c.subject,
      c.direction::text,
      c.channel::text,
      c.chrono,
      c.received_at,
      c.sent_at,
      c.created_at,
      c.updated_at,
      c.workflow_state_id,
      c.assigned_service,
      c.socle_organization_id,
      c.organization_id,
      COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) AS sender_name,
      s.first_name AS sender_first_name,
      s.last_name  AS sender_last_name,
      COALESCE(NULLIF(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), r.name, r.email) AS recipient_name,
      CASE WHEN jsonb_typeof(c.metadata->'tags') = 'array'
        THEN COALESCE(
               (SELECT array_agg(t) FROM jsonb_array_elements_text(c.metadata->'tags') AS t),
               '{}'::text[])
        ELSE '{}'::text[]
      END AS tags,
      EXISTS (
        SELECT 1 FROM courier_events ce
        WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
      ) AS is_transferred,
      CASE WHEN jsonb_typeof(c.metadata->'is_large_email') = 'boolean'
        THEN (c.metadata->>'is_large_email')::boolean
        ELSE false
      END AS is_large_email,
      c.acknowledged_at,
      c.resolved_at,
      array_remove(ARRAY[
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_subject @@ (SELECT q FROM tsq)
             THEN 'subject' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_body @@ (SELECT q FROM tsq)
             THEN 'body' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
               SELECT 1 FROM courier_participants cp
               WHERE cp.courier_id = c.id AND cp.fts_participant @@ (SELECT q FROM tsq))
             THEN 'participants' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
               SELECT 1 FROM courier_document_extracts de
               WHERE de.courier_id = c.id AND de.fts_extract @@ (SELECT q FROM tsq))
             THEN 'documents' END
      ], NULL) AS match_in,
      p.total_count
    FROM paged p
    JOIN couriers c ON c.id = p.id
    LEFT JOIN LATERAL (
      SELECT cp.first_name, cp.last_name, cp.name, cp.email
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'sender'
      ORDER BY cp.id
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT cp.first_name, cp.last_name, cp.name, cp.email
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'recipient'
      ORDER BY cp.id
      LIMIT 1
    ) r ON true
    ORDER BY
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN p.sort_ts  END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN p.sort_ts  END) DESC NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN p.sort_txt END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN p.sort_txt END) DESC NULLS LAST,
      c.id DESC
  )
  SELECT * FROM result_set;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) TO authenticated, service_role;
