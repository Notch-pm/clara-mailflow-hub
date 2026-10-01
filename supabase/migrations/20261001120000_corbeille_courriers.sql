-- Corbeille et spam : « Supprimer » un courrier le place dans une corbeille
-- au lieu de l'effacer. Il y reste 30 jours, restaurable, puis la purge
-- nocturne l'efface pour de bon (cascade et outbox `storage_deletions`
-- inchangées : la suppression définitive reste un DELETE).
--
-- 1. `couriers.deleted_at` / `deleted_by` : NULL = courrier vivant. Les
--    réponses suivent leur courrier parent avec le MÊME `deleted_at`, ce qui
--    permet de restaurer exactement ce qui est parti ensemble.
-- 2. RLS : la policy de lecture masque les courriers en corbeille. Couvre d'un
--    coup les lectures directes du client et les RPC SECURITY INVOKER (stats).
--    Les RPC SECURITY DEFINER qui lisent `couriers` filtrent explicitement
--    (search_couriers, mailroom_couriers, enqueue_courier_analysis,
--    courier_creation_block_reason).
--    Le service role continue de tout voir : la déduplication de l'import IMAP
--    (`fetch-inbound-emails`, `email_message_id`) doit voir la corbeille, sinon
--    un mail supprimé serait réimporté au prochain relevé.
-- 3. `can_access_mailroom(org)` : équivalent SQL de `canAccessMailroom`
--    (src/lib/permissions.ts) — superadmin, administrateur, gestionnaire courrier.
-- 4. RPC : trash_courier, restore_courier, purge_trashed_courier, empty_trash,
--    trashed_couriers. Écritures : `is_editor_of` ET accès à l'écran, sauf
--    trash_courier (geste « Supprimer » ouvert à tout éditeur, comme avant).
-- 5. purge_expired_data() : purge les courriers en corbeille depuis 30 jours.
--
-- Rejouable : IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.

-- ─── Colonnes ──────────────────────────────────────────────────────────────────
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.couriers.deleted_at IS
  'Mise à la corbeille. NULL : courrier vivant. Purge définitive 30 jours après (purge_expired_data).';
COMMENT ON COLUMN public.couriers.deleted_by IS
  'Utilisateur qui a placé le courrier dans la corbeille.';

CREATE INDEX IF NOT EXISTS idx_couriers_trash
  ON public.couriers (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ─── RLS : la corbeille n'est pas lisible directement ──────────────────────────
DROP POLICY IF EXISTS auth_select ON public.couriers;
CREATE POLICY auth_select ON public.couriers
  FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id) AND deleted_at IS NULL);

-- ─── Accès à l'écran (miroir de canAccessMailroom) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.can_access_mailroom(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_admin_of(_org)  -- inclut le superadmin
    OR EXISTS (
      SELECT 1 FROM public.organization_users
      WHERE user_id = auth.uid()
        AND organization_id = _org
        AND COALESCE(is_active, true) = true
        AND is_service_courrier = true
    );
$function$;

REVOKE ALL ON FUNCTION public.can_access_mailroom(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_mailroom(uuid) TO authenticated, service_role;

-- ─── Mettre à la corbeille ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trash_courier(p_organization_id uuid, p_courier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_editor_of(p_organization_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT c.parent_courier_id INTO v_parent
  FROM couriers c
  WHERE c.id = p_courier_id
    AND c.organization_id = p_organization_id
    AND c.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Courrier introuvable';
  END IF;
  IF v_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Une réponse ne passe pas par la corbeille : supprimez-la depuis le courrier.';
  END IF;

  -- Le courrier et ses réponses, avec le même horodatage (restauration groupée).
  UPDATE couriers
  SET deleted_at = v_now, deleted_by = auth.uid()
  WHERE organization_id = p_organization_id
    AND deleted_at IS NULL
    AND (id = p_courier_id OR parent_courier_id = p_courier_id);

  INSERT INTO courier_events (organization_id, courier_id, event_type, created_by)
  VALUES (p_organization_id, p_courier_id, 'courier_trashed', auth.uid());
END;
$function$;

-- ─── Restaurer ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_courier(p_organization_id uuid, p_courier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  IF NOT (public.is_editor_of(p_organization_id) AND public.can_access_mailroom(p_organization_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT c.deleted_at INTO v_deleted_at
  FROM couriers c
  WHERE c.id = p_courier_id
    AND c.organization_id = p_organization_id
    AND c.deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce courrier n''est pas dans la corbeille';
  END IF;

  UPDATE couriers
  SET deleted_at = NULL, deleted_by = NULL
  WHERE organization_id = p_organization_id
    AND deleted_at = v_deleted_at
    AND (id = p_courier_id OR parent_courier_id = p_courier_id);

  INSERT INTO courier_events (organization_id, courier_id, event_type, created_by)
  VALUES (p_organization_id, p_courier_id, 'courier_restored', auth.uid());
END;
$function$;

-- ─── Supprimer définitivement un courrier de la corbeille ──────────────────────
CREATE OR REPLACE FUNCTION public.purge_trashed_courier(p_organization_id uuid, p_courier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_editor_of(p_organization_id) AND public.can_access_mailroom(p_organization_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Les réponses partent par la cascade de parent_courier_id.
  DELETE FROM couriers
  WHERE id = p_courier_id
    AND organization_id = p_organization_id
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce courrier n''est pas dans la corbeille';
  END IF;
END;
$function$;

-- ─── Vider la corbeille ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.empty_trash(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (public.is_editor_of(p_organization_id) AND public.can_access_mailroom(p_organization_id)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  WITH del AS (
    DELETE FROM couriers
    WHERE organization_id = p_organization_id
      AND deleted_at IS NOT NULL
      AND parent_courier_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;

  RETURN v_count;
END;
$function$;

-- ─── Lister la corbeille ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.trashed_couriers(uuid);
CREATE FUNCTION public.trashed_couriers(p_organization_id uuid)
RETURNS TABLE(
  id uuid, chrono text, subject text, direction text, channel text,
  received_at timestamptz, created_at timestamptz,
  deleted_at timestamptz, deleted_by_name text, purge_at timestamptz,
  sender_name text, reply_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.chrono, c.subject, c.direction::text, c.channel::text,
    c.received_at, c.created_at,
    c.deleted_at,
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS deleted_by_name,
    c.deleted_at + interval '30 days' AS purge_at,
    COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) AS sender_name,
    (SELECT count(*)::integer FROM couriers r WHERE r.parent_courier_id = c.id) AS reply_count
  FROM couriers c
  LEFT JOIN users u ON u.id = c.deleted_by
  LEFT JOIN LATERAL (
    SELECT cp.first_name, cp.last_name, cp.name, cp.email
    FROM courier_participants cp
    WHERE cp.courier_id = c.id AND cp.role = 'sender'
    ORDER BY cp.id LIMIT 1
  ) s ON true
  WHERE c.organization_id = p_organization_id
    AND public.can_access_mailroom(p_organization_id)
    AND c.deleted_at IS NOT NULL
    AND c.parent_courier_id IS NULL
  ORDER BY c.deleted_at DESC, c.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.trash_courier(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_courier(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_trashed_courier(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.empty_trash(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trashed_couriers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_courier(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_courier(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_trashed_courier(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.empty_trash(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trashed_couriers(uuid) TO authenticated;

-- ─── RPC SECURITY DEFINER : masquer la corbeille ───────────────────────────────
CREATE OR REPLACE FUNCTION public.courier_creation_block_reason(p_courier_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN c.id IS NULL THEN NULL  -- la clé étrangère refusera d'elle-même
    WHEN c.deleted_at IS NOT NULL THEN
      'Ce courrier est dans la corbeille : restaurez-le avant de créer une action ou une réponse.'
    WHEN c.socle_organization_id IS NULL THEN
      'Ce courrier n''a pas d''organisation gestionnaire : désignez-la avant de créer une action ou une réponse.'
    -- `is_initial` NULL compte comme « pas initial », comme la boîte aux
    -- lettres (filtre `is_initial = true`) ; un état introuvable, comme aucun.
    WHEN c.workflow_state_id IS NULL OR ws.id IS NULL OR ws.is_initial IS TRUE THEN
      'Ce courrier est encore dans la boîte aux lettres : faites-le avancer dans son workflow avant de créer une action ou une réponse.'
  END
  FROM (SELECT p_courier_id AS id) k
  LEFT JOIN public.couriers c ON c.id = k.id
  LEFT JOIN public.workflow_states ws ON ws.id = c.workflow_state_id;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_courier_analysis(p_courier_id uuid, p_kind text DEFAULT 'full'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_job_id uuid;
BEGIN
  SELECT c.organization_id INTO v_org_id
  FROM couriers c
  WHERE c.id = p_courier_id
    AND c.deleted_at IS NULL;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Courrier introuvable';
  END IF;

  IF NOT public.is_editor_of(v_org_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  INSERT INTO courier_analysis_jobs (organization_id, courier_id, kind, requested_by)
  VALUES (v_org_id, p_courier_id, p_kind, auth.uid())
  ON CONFLICT (courier_id) WHERE status IN ('pending', 'running')
  DO NOTHING
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mailroom_couriers(p_organization_id uuid, p_since timestamp with time zone DEFAULT (now() - '30 days'::interval))
 RETURNS TABLE(id uuid, chrono text, subject text, channel text, received_at timestamp with time zone, created_at timestamp with time zone, socle_organization_id uuid, assigned_service text, workflow_state_id uuid, state_is_initial boolean, state_category text, acknowledged_at timestamp with time zone, resolved_at timestamp with time zone, sender_name text, analysis_status text, has_analysis boolean, suggested_socle_organization_id uuid, suggested_service_reason text, suggested_service_confidence smallint, suggested_service_alternatives uuid[], first_intent text, routed_at timestamp with time zone, taken_at timestamp with time zone, reminder_count integer, last_reminder_at timestamp with time zone, returned_from text, returned_at timestamp with time zone, returned_done text, returned_todo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.chrono, c.subject, c.channel::text, c.received_at, c.created_at,
    c.socle_organization_id, c.assigned_service, c.workflow_state_id,
    COALESCE(ws.is_initial, false) AS state_is_initial,
    ws.category::text AS state_category,
    c.acknowledged_at, c.resolved_at,
    COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) AS sender_name,
    j.status AS analysis_status,
    (ca.id IS NOT NULL) AS has_analysis,
    ca.suggested_socle_organization_id,
    ca.suggested_service_reason,
    ca.suggested_service_confidence,
    COALESCE(ca.suggested_service_alternatives, '{}'::uuid[]) AS suggested_service_alternatives,
    CASE WHEN jsonb_typeof(ca.intents) = 'array' THEN ca.intents->>0 END AS first_intent,
    CASE WHEN lr.event_type <> 'service_returned' THEN lr.at END AS routed_at,
    tk.at AS taken_at,
    COALESCE(rm.n, 0)::integer AS reminder_count,
    rm.last_at AS last_reminder_at,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'from' END AS returned_from,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.at END AS returned_at,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'done' END AS returned_done,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'todo' END AS returned_todo
  FROM couriers c
  LEFT JOIN workflow_states ws ON ws.id = c.workflow_state_id
  LEFT JOIN courier_analyses ca ON ca.courier_id = c.id
  LEFT JOIN LATERAL (
    SELECT cp.first_name, cp.last_name, cp.name, cp.email
    FROM courier_participants cp
    WHERE cp.courier_id = c.id AND cp.role = 'sender'
    ORDER BY cp.id LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT aj.status FROM courier_analysis_jobs aj
    WHERE aj.courier_id = c.id ORDER BY aj.created_at DESC LIMIT 1
  ) j ON true
  LEFT JOIN LATERAL (
    SELECT ce.event_type::text AS event_type, ce.payload, ce.created_at::timestamptz AS at
    FROM courier_events ce
    WHERE ce.courier_id = c.id
      AND ce.event_type IN ('service_changed', 'service_transferred', 'courier_routed', 'service_returned')
    ORDER BY ce.created_at DESC LIMIT 1
  ) lr ON true
  LEFT JOIN LATERAL (
    SELECT min(ce.created_at)::timestamptz AS at FROM courier_events ce
    WHERE ce.courier_id = c.id AND ce.event_type = 'instruction_started'
      AND (lr.at IS NULL OR ce.created_at::timestamptz >= lr.at)
  ) tk ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, max(ce.created_at)::timestamptz AS last_at FROM courier_events ce
    WHERE ce.courier_id = c.id AND ce.event_type = 'service_reminded'
      AND (lr.at IS NULL OR ce.created_at::timestamptz >= lr.at)
  ) rm ON true
  WHERE c.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND c.direction = 'inbound'
    AND c.deleted_at IS NULL
    AND (c.resolved_at IS NULL OR c.resolved_at >= p_since)
  ORDER BY COALESCE(c.received_at, c.created_at) DESC, c.id DESC
  LIMIT 8000;
$function$;

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
      AND c.deleted_at IS NULL
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

-- ─── Purge nocturne : + corbeille de plus de 30 jours ──────────────────────────
CREATE OR REPLACE FUNCTION public.purge_expired_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  org RECORD;
  v_courier_cutoff timestamptz;
  v_deleted_couriers int := 0;
  v_total_couriers int := 0;
  v_trashed_couriers int := 0;
  v_deleted_notifications int := 0;
  v_deleted_analysis_jobs int := 0;
  v_deleted_sync_runs int := 0;
BEGIN
  -- Corbeille : 30 jours après la mise à la corbeille, quel que soit le
  -- réglage de rétention de l'organisation. Les réponses partent par cascade.
  WITH del AS (
    DELETE FROM public.couriers
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
      AND parent_courier_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_trashed_couriers FROM del;

  FOR org IN
    SELECT id, courier_retention_days
    FROM public.organizations
    WHERE courier_retention_days IS NOT NULL
  LOOP
    IF org.courier_retention_days IS NOT NULL AND org.courier_retention_days > 0 THEN
      v_courier_cutoff := now() - make_interval(days => org.courier_retention_days);

      WITH activity AS (
        SELECT c.id,
          GREATEST(
            c.updated_at,
            COALESCE((SELECT max(created_at) FROM public.courier_events e WHERE e.courier_id = c.id), c.updated_at),
            COALESCE((SELECT max(updated_at) FROM public.courier_notes n WHERE n.courier_id = c.id), c.updated_at)
          ) AS last_activity_at
        FROM public.couriers c
        WHERE c.organization_id = org.id
      ),
      del AS (
        DELETE FROM public.couriers c
        USING activity a
        WHERE c.id = a.id
          AND a.last_activity_at < v_courier_cutoff
        RETURNING 1
      )
      SELECT count(*) INTO v_deleted_couriers FROM del;

      v_total_couriers := v_total_couriers + v_deleted_couriers;
    END IF;
  END LOOP;

  -- Notifications : rétention fixe, toutes organisations confondues. Pas de
  -- réglage par organisation comme pour les courriers — une notification n'est
  -- pas une donnée d'usager mais un signal de travail, et sa durée de vie utile
  -- ne dépend pas du tenant.
  WITH del AS (
    DELETE FROM public.notifications
    WHERE created_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_notifications FROM del;

  -- Jobs d'analyse terminés : trace technique, sans valeur au-delà du
  -- diagnostic d'un échec récurrent.
  WITH del AS (
    DELETE FROM public.courier_analysis_jobs
    WHERE status IN ('done', 'failed')
      AND finished_at < now() - interval '90 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_analysis_jobs FROM del;

  -- Historique des synchros Socle : on garde la dernière synchro réelle de
  -- chaque organisation, quel que soit son âge.
  WITH last_run AS (
    SELECT DISTINCT ON (organization_id) id
    FROM public.socle_sync_runs
    WHERE dry_run = false
    ORDER BY organization_id, started_at DESC
  ),
  del AS (
    DELETE FROM public.socle_sync_runs r
    WHERE r.started_at < now() - interval '90 days'
      AND r.id NOT IN (SELECT id FROM last_run)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_sync_runs FROM del;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'deleted_couriers', v_total_couriers,
    'trashed_couriers_purged', v_trashed_couriers,
    'deleted_notifications', v_deleted_notifications,
    'deleted_analysis_jobs', v_deleted_analysis_jobs,
    'deleted_sync_runs', v_deleted_sync_runs
  );
END;
$function$;
