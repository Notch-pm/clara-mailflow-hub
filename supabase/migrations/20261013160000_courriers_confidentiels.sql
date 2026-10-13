-- Courriers confidentiels (2026-10-13).
--
-- Un courrier (entrant ou sortant) marqué `is_confidential` n'est LISIBLE que
-- par :
--   • les membres habilités (`organization_users.can_read_confidential`) —
--     l'attribut seul compte, administrateurs et superadmin compris ;
--   • les viseurs et signataires DÉSIGNÉS sur lui ; à l'étape de visa sans
--     viseur désigné, les viseurs de son organisation (comme la file du
--     parapheur) ;
--   • pour un entrant : les désignés de l'une de ses réponses.
-- Les autres membres voient la ligne dans les listes, masquée (objet
-- « [courrier confidentiel] », ni expéditeur ni destinataire), sans pouvoir
-- en lire le détail, les pièces, l'historique ni l'analyse : la règle vit dans
-- les politiques de lecture et dans les RPC de liste, pas à l'écran.
--
-- Le drapeau : le poser, un habilité ou le service courrier ; le retirer, un
-- habilité. Une réponse suit son courrier reçu. Chaque changement est tracé.

-- ─── 1. Colonnes ────────────────────────────────────────────────────────────

ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_couriers_confidential
  ON public.couriers (organization_id) WHERE is_confidential;

ALTER TABLE public.organization_users
  ADD COLUMN IF NOT EXISTS can_read_confidential boolean NOT NULL DEFAULT false;

-- ─── 2. Trace des habilitations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.confidential_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  granted boolean NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_confidential_access_log_org ON public.confidential_access_log (organization_id, changed_at DESC);
ALTER TABLE public.confidential_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_select ON public.confidential_access_log;
CREATE POLICY admins_select ON public.confidential_access_log
  FOR SELECT TO authenticated USING (public.is_admin_of(organization_id));
DROP POLICY IF EXISTS service_role_full ON public.confidential_access_log;
CREATE POLICY service_role_full ON public.confidential_access_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.organization_users_log_confidential_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT NEW.can_read_confidential THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.can_read_confidential IS NOT DISTINCT FROM OLD.can_read_confidential THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.confidential_access_log (organization_id, user_id, granted, changed_by)
  VALUES (NEW.organization_id, NEW.user_id, NEW.can_read_confidential, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_users_confidential_log ON public.organization_users;
CREATE TRIGGER trg_organization_users_confidential_log
  AFTER INSERT OR UPDATE OF can_read_confidential ON public.organization_users
  FOR EACH ROW EXECUTE FUNCTION public.organization_users_log_confidential_access();

-- ─── 3. Règle d'accès ──────────────────────────────────────────────────────

-- L'attribut : membre actif habilité de l'organisation.
CREATE OR REPLACE FUNCTION public.has_confidential_access(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_users
    WHERE user_id = auth.uid()
      AND organization_id = _org
      AND COALESCE(is_active, true) = true
      AND can_read_confidential = true
  );
$$;

-- Désigné sur UN courrier : viseur désigné à l'une de ses étapes, signataire
-- désigné, ou viseur de son organisation à l'étape de visa courante quand
-- personne n'y est désigné.
CREATE OR REPLACE FUNCTION public.is_designated_on_courier(_socle_org uuid, _state uuid, _metadata jsonb)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (
      jsonb_typeof(_metadata -> 'visa_viseurs') = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(_metadata -> 'visa_viseurs') v
        WHERE v.value = auth.uid()::text
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.signatories s
      WHERE s.id = NULLIF(_metadata ->> 'signatory_id', '')::uuid
        AND s.user_id = auth.uid()
    )
    OR (
      _state IS NOT NULL
      AND _socle_org IS NOT NULL
      AND NULLIF(_metadata -> 'visa_viseurs' ->> _state::text, '') IS NULL
      AND EXISTS (SELECT 1 FROM public.workflow_states ws WHERE ws.id = _state AND ws.requires_visa)
      AND EXISTS (
        SELECT 1 FROM public.socle_organization_viseurs v
        WHERE v.socle_organization_id = _socle_org AND v.user_id = auth.uid()
      )
    )
  );
$$;

-- Un courrier CONFIDENTIEL est-il lisible par moi ? (L'appartenance à
-- l'organisation se vérifie à côté.) Ligne passée en paramètres : la
-- politique de `couriers` n'a pas à relire la table.
CREATE OR REPLACE FUNCTION public.can_read_confidential_courier(
  _org uuid, _id uuid, _socle_org uuid, _state uuid, _metadata jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_confidential_access(_org)
    OR public.is_designated_on_courier(_socle_org, _state, _metadata)
    -- Un entrant : les désignés de ses réponses lisent la demande.
    OR EXISTS (
      SELECT 1 FROM public.couriers r
      WHERE r.parent_courier_id = _id
        AND r.deleted_at IS NULL
        AND public.is_designated_on_courier(r.socle_organization_id, r.workflow_state_id, r.metadata)
    );
$$;

-- Lisible par moi, tout compris (appartenance + confidentialité), par id.
-- Sert aux politiques des tables filles, aux edge functions et à l'écran.
CREATE OR REPLACE FUNCTION public.can_read_courier(p_courier_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT public.is_member_of(c.organization_id)
       AND (
         NOT c.is_confidential
         OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)
       )
    FROM public.couriers c
    WHERE c.id = p_courier_id
  ), false);
$$;

-- Pour la page de détail : 'ok', 'confidential' (il existe, je n'y ai pas
-- accès) ou 'missing' (n'existe pas, supprimé, ou hors de mes organisations).
CREATE OR REPLACE FUNCTION public.courier_access(p_courier_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN c.deleted_at IS NOT NULL OR NOT public.is_member_of(c.organization_id) THEN 'missing'
      WHEN public.can_read_courier(c.id) THEN 'ok'
      ELSE 'confidential'
    END
    FROM public.couriers c
    WHERE c.id = p_courier_id
  ), 'missing');
$$;

REVOKE EXECUTE ON FUNCTION public.has_confidential_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_designated_on_courier(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_confidential_courier(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_courier(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.courier_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_confidential_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_designated_on_courier(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_confidential_courier(uuid, uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_courier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_access(uuid) TO authenticated, service_role;

-- ─── 4. Politiques de lecture ──────────────────────────────────────────────

DROP POLICY IF EXISTS auth_select ON public.couriers;
CREATE POLICY auth_select ON public.couriers
  FOR SELECT TO authenticated
  USING (
    public.is_member_of(organization_id)
    AND deleted_at IS NULL
    AND (
      NOT is_confidential
      OR public.can_read_confidential_courier(organization_id, id, socle_organization_id, workflow_state_id, metadata)
    )
  );

-- (`courier_tags` est le catalogue d'étiquettes de l'organisation, sans courrier : inchangé.)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'courier_participants', 'courier_documents', 'courier_document_extracts', 'courier_analyses',
    'courier_events', 'courier_notes', 'courier_links', 'action_tickets', 'courier_visas'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_select ON public.%I FOR SELECT TO authenticated
         USING (public.is_member_of(organization_id) AND public.can_read_courier(courier_id))',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Members read analysis jobs" ON public.courier_analysis_jobs;
CREATE POLICY "Members read analysis jobs" ON public.courier_analysis_jobs
  FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id) AND public.can_read_courier(courier_id));

-- Un lien se lit si ses DEUX bouts se lisent : sinon il révélerait l'objet de l'autre.
DROP POLICY IF EXISTS auth_select ON public.courier_relations;
CREATE POLICY auth_select ON public.courier_relations
  FOR SELECT TO authenticated
  USING (
    public.is_member_of(organization_id)
    AND public.can_read_courier(source_courier_id)
    AND public.can_read_courier(target_courier_id)
  );

-- ─── 5. Le drapeau : garde, héritage, trace ────────────────────────────────

CREATE OR REPLACE FUNCTION public.couriers_guard_confidential()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parent_confidential boolean;
BEGIN
  -- Une réponse suit son courrier reçu.
  IF NEW.parent_courier_id IS NOT NULL THEN
    SELECT p.is_confidential INTO v_parent_confidential
    FROM public.couriers p WHERE p.id = NEW.parent_courier_id;
    IF COALESCE(v_parent_confidential, false) THEN
      NEW.is_confidential := true;
      RETURN NEW;
    END IF;
  END IF;

  -- Serveur (service role) ou propagation depuis le parent : pas de garde.
  IF auth.uid() IS NULL OR current_setting('clara.confidential_propagating', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_confidential
       AND NOT (public.has_confidential_access(NEW.organization_id) OR public.can_access_mailroom(NEW.organization_id)) THEN
      RAISE EXCEPTION 'Seuls les membres habilités ou le service courrier peuvent marquer un courrier confidentiel.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_confidential IS DISTINCT FROM OLD.is_confidential THEN
    IF NEW.is_confidential
       AND NOT (public.has_confidential_access(NEW.organization_id) OR public.can_access_mailroom(NEW.organization_id)) THEN
      RAISE EXCEPTION 'Seuls les membres habilités ou le service courrier peuvent marquer un courrier confidentiel.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT NEW.is_confidential AND NOT public.has_confidential_access(NEW.organization_id) THEN
      RAISE EXCEPTION 'Seuls les membres habilités peuvent lever la confidentialité d''un courrier.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_couriers_guard_confidential ON public.couriers;
CREATE TRIGGER trg_couriers_guard_confidential
  BEFORE INSERT OR UPDATE OF is_confidential ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_guard_confidential();

-- Après un changement : réponses alignées, notifications masquées, trace.
CREATE OR REPLACE FUNCTION public.couriers_after_confidential_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_confidential IS NOT DISTINCT FROM OLD.is_confidential THEN
    RETURN NEW;
  END IF;

  IF current_setting('clara.confidential_propagating', true) IS DISTINCT FROM 'on' THEN
    INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
    VALUES (
      NEW.organization_id, NEW.id,
      CASE WHEN NEW.is_confidential THEN 'confidentiality_set' ELSE 'confidentiality_cleared' END,
      '{}'::jsonb, auth.uid()
    );

    -- Les réponses suivent leur courrier reçu.
    PERFORM set_config('clara.confidential_propagating', 'on', true);
    UPDATE public.couriers SET is_confidential = NEW.is_confidential
    WHERE parent_courier_id = NEW.id AND is_confidential IS DISTINCT FROM NEW.is_confidential;
    PERFORM set_config('clara.confidential_propagating', 'off', true);
  END IF;

  -- Le titre des notifications déjà parties porte l'objet : on le réécrit
  -- (le trigger de `notifications` masque).
  IF NEW.is_confidential THEN
    UPDATE public.notifications SET title = title WHERE resource_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_couriers_after_confidential_change ON public.couriers;
CREATE TRIGGER trg_couriers_after_confidential_change
  AFTER UPDATE OF is_confidential ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_after_confidential_change();

-- Toute notification sur un courrier confidentiel : l'objet n'y figure pas
-- (cloche, push sur écran verrouillé). Le préfixe court (« Transféré : »,
-- « Relance : ») est gardé, il ne dit rien du contenu.
CREATE OR REPLACE FUNCTION public.notifications_mask_confidential()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.resource_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.couriers c WHERE c.id = NEW.resource_id AND c.is_confidential
  ) THEN
    NEW.title := CASE
      WHEN NEW.title ~ '^[^:]{1,40} : ' THEN regexp_replace(NEW.title, '^([^:]{1,40}) : .*$', '\1 : Courrier confidentiel')
      ELSE 'Courrier confidentiel'
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Nommé pour passer AVANT `trg_notifications_push_queue` (ordre alphabétique).
DROP TRIGGER IF EXISTS trg_notifications_mask_confidential ON public.notifications;
CREATE TRIGGER trg_notifications_mask_confidential
  BEFORE INSERT OR UPDATE OF title ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_mask_confidential();

-- Poser / lever le drapeau. Une écriture directe ne suffit pas : pour le
-- service courrier non habilité, la ligne devenue confidentielle échoue au
-- contrôle de lecture de la nouvelle ligne (« new row violates row-level
-- security »). Les droits restent ceux de `couriers_guard_confidential`.
CREATE OR REPLACE FUNCTION public.set_courier_confidential(p_courier_id uuid, p_confidential boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.couriers WHERE id = p_courier_id AND deleted_at IS NULL;
  IF v_org IS NULL OR NOT public.is_editor_of(v_org) THEN
    RAISE EXCEPTION 'Courrier introuvable.' USING ERRCODE = '42501';
  END IF;
  -- Une réponse suit son courrier reçu : c'est sur lui que se pose le drapeau.
  IF EXISTS (SELECT 1 FROM public.couriers r JOIN public.couriers p ON p.id = r.parent_courier_id
             WHERE r.id = p_courier_id AND p.is_confidential AND NOT p_confidential) THEN
    RAISE EXCEPTION 'Cette réponse suit la confidentialité du courrier reçu : levez-la sur lui.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.couriers SET is_confidential = p_confidential WHERE id = p_courier_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_courier_confidential(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_confidential(uuid, boolean) TO authenticated;

-- ─── 6. Routage sans lecture (service courrier non habilité) ───────────────
--
-- La politique de lecture cache au service courrier la ligne d'un entrant
-- confidentiel : l'UPDATE direct de `assignOrganization` n'y trouverait rien.
-- Même effet, côté serveur : organisation, état initial de son workflow,
-- événement (`service_changed`, ou `service_transferred` pour un transfert).
CREATE OR REPLACE FUNCTION public.route_courier_blind(
  p_courier_id uuid,
  p_socle_organization_id uuid,
  p_transfer boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_courier public.couriers%ROWTYPE;
  v_org public.socle_organizations%ROWTYPE;
  v_state public.workflow_states%ROWTYPE;
BEGIN
  SELECT * INTO v_courier FROM public.couriers WHERE id = p_courier_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.can_access_mailroom(v_courier.organization_id) THEN
    RAISE EXCEPTION 'Courrier introuvable.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_org FROM public.socle_organizations
  WHERE id = p_socle_organization_id AND organization_id = v_courier.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation inconnue.' USING ERRCODE = 'P0001';
  END IF;

  IF v_org.workflow_id IS NOT NULL THEN
    SELECT * INTO v_state FROM public.workflow_states
    WHERE workflow_id = v_org.workflow_id AND is_initial IS TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  UPDATE public.couriers SET
    assigned_service = v_org.name,
    socle_organization_id = v_org.id,
    workflow_state_id = v_state.id,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('socle_organization_id', v_org.id)
  WHERE id = p_courier_id;

  INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
  VALUES (
    v_courier.organization_id, p_courier_id,
    CASE WHEN p_transfer THEN 'service_transferred' ELSE 'service_changed' END,
    jsonb_build_object('from', v_courier.assigned_service, 'to', v_org.name),
    auth.uid()
  );
  IF NOT p_transfer AND v_state.category::text = 'processing' THEN
    INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
    VALUES (v_courier.organization_id, p_courier_id, 'instruction_started',
            jsonb_build_object('state_name', v_state.name), auth.uid());
  END IF;

  RETURN jsonb_build_object('name', v_org.name, 'initial_state_id', v_state.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.route_courier_blind(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.route_courier_blind(uuid, uuid, boolean) TO authenticated;

-- ─── 7. Listes masquées ────────────────────────────────────────────────────
--
-- Une ligne confidentielle illisible reste dans la liste (elle existe, on la
-- route, on la compte) mais sans rien de son contenu : objet remplacé, noms,
-- étiquettes, intentions et notes à NULL. Deux colonnes en plus,
-- `is_confidential` et `can_read`, pour que l'écran l'affiche et n'ouvre pas
-- le détail. Le type de retour change : DROP puis CREATE.

DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text);
CREATE FUNCTION public.search_couriers(
  p_organization_id uuid, p_direction text DEFAULT NULL::text, p_workflow_state_id uuid DEFAULT NULL::uuid,
  p_socle_organization_id uuid DEFAULT NULL::uuid, p_keywords text DEFAULT NULL::text, p_tag_names text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0,
  p_workflow_state_ids uuid[] DEFAULT NULL::uuid[], p_include_null_state boolean DEFAULT false,
  p_visible_socle_organization_ids uuid[] DEFAULT NULL::uuid[], p_sort_by text DEFAULT 'received_at'::text,
  p_prefix_match boolean DEFAULT false, p_transferred_only boolean DEFAULT NULL::boolean, p_sort_dir text DEFAULT 'desc'::text
)
RETURNS TABLE(
  id uuid, subject text, direction text, channel text, chrono text, received_at timestamp with time zone,
  sent_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone,
  workflow_state_id uuid, assigned_service text, socle_organization_id uuid, organization_id uuid,
  sender_name text, sender_first_name text, sender_last_name text, recipient_name text, tags text[],
  is_transferred boolean, is_large_email boolean, acknowledged_at timestamp with time zone,
  resolved_at timestamp with time zone, match_in text[], total_count bigint,
  is_confidential boolean, can_read boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tsq AS (
    SELECT public.clara_search_tsquery(p_keywords, p_prefix_match) AS q
  ),
  base AS (
    SELECT
      c.*,
      (NOT c.is_confidential
        OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)
      ) AS readable
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
      AND (
        p_transferred_only IS NULL
        OR p_transferred_only = EXISTS (
             SELECT 1 FROM courier_events ce
             WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
           )
      )
  ),
  filtered AS (
    SELECT
      b.id,
      b.readable,
      CASE
        WHEN p_sort_by = 'updated_at' THEN b.updated_at
        WHEN p_sort_by = 'created_at' THEN b.created_at
        WHEN p_sort_by = 'sent_at'    THEN b.sent_at
        WHEN p_sort_by IN ('chrono', 'subject', 'assigned_service') THEN NULL
        ELSE COALESCE(b.received_at, b.created_at)
      END AS sort_ts,
      lower(CASE p_sort_by
        WHEN 'chrono'           THEN b.chrono
        WHEN 'subject'          THEN CASE WHEN b.readable THEN b.subject END
        WHEN 'assigned_service' THEN b.assigned_service
      END) AS sort_txt
    FROM base b
    -- Une étiquette ne filtre que ce qu'on peut lire : sinon elle trahirait le contenu.
    WHERE (p_tag_names IS NULL OR (b.readable AND (b.metadata->'tags') ?| p_tag_names))
      AND (
            (SELECT q FROM tsq) IS NULL
         -- Illisible : seule la référence se cherche (pas d'oracle sur le corps, les noms, l'OCR).
         OR (NOT b.readable AND b.chrono ILIKE '%' || btrim(p_keywords) || '%')
         OR (b.readable AND (
               b.fts_subject @@ (SELECT q FROM tsq)
            OR b.fts_body    @@ (SELECT q FROM tsq)
            OR EXISTS (
                 SELECT 1 FROM courier_participants cp
                 WHERE cp.courier_id = b.id AND cp.fts_participant @@ (SELECT q FROM tsq)
               )
            OR EXISTS (
                 SELECT 1 FROM courier_document_extracts de
                 WHERE de.courier_id = b.id AND de.fts_extract @@ (SELECT q FROM tsq)
               )
         ))
      )
  ),
  paged AS (
    SELECT f.id, f.readable, f.sort_ts, f.sort_txt, COUNT(*) OVER() AS total_count
    FROM filtered f
    ORDER BY
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_ts  END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_ts  END) DESC NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_txt END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_txt END) DESC NULLS LAST,
      f.id DESC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    c.id,
    CASE WHEN p.readable THEN c.subject ELSE '[courrier confidentiel]' END,
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
    CASE WHEN p.readable THEN COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) END,
    CASE WHEN p.readable THEN s.first_name END,
    CASE WHEN p.readable THEN s.last_name END,
    CASE WHEN p.readable THEN COALESCE(NULLIF(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), r.name, r.email) END,
    CASE WHEN p.readable AND jsonb_typeof(c.metadata->'tags') = 'array'
      THEN COALESCE((SELECT array_agg(t) FROM jsonb_array_elements_text(c.metadata->'tags') AS t), '{}'::text[])
      ELSE '{}'::text[]
    END,
    EXISTS (
      SELECT 1 FROM courier_events ce
      WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
    ),
    CASE WHEN jsonb_typeof(c.metadata->'is_large_email') = 'boolean'
      THEN (c.metadata->>'is_large_email')::boolean
      ELSE false
    END,
    c.acknowledged_at,
    c.resolved_at,
    CASE WHEN p.readable THEN array_remove(ARRAY[
      CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_subject @@ (SELECT q FROM tsq) THEN 'subject' END,
      CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_body @@ (SELECT q FROM tsq) THEN 'body' END,
      CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
             SELECT 1 FROM courier_participants cp
             WHERE cp.courier_id = c.id AND cp.fts_participant @@ (SELECT q FROM tsq))
           THEN 'participants' END,
      CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
             SELECT 1 FROM courier_document_extracts de
             WHERE de.courier_id = c.id AND de.fts_extract @@ (SELECT q FROM tsq))
           THEN 'documents' END
    ], NULL) END,
    p.total_count,
    c.is_confidential,
    p.readable
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
    c.id DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.mailroom_couriers(uuid, timestamptz);
CREATE FUNCTION public.mailroom_couriers(p_organization_id uuid, p_since timestamp with time zone DEFAULT (now() - '30 days'::interval))
RETURNS TABLE(
  id uuid, chrono text, subject text, channel text, received_at timestamp with time zone, created_at timestamp with time zone,
  socle_organization_id uuid, assigned_service text, workflow_state_id uuid, state_is_initial boolean, state_category text,
  acknowledged_at timestamp with time zone, resolved_at timestamp with time zone, sender_name text, analysis_status text,
  has_analysis boolean, suggested_socle_organization_id uuid, suggested_service_reason text, suggested_service_confidence smallint,
  suggested_service_alternatives uuid[], first_intent text, routed_at timestamp with time zone, taken_at timestamp with time zone,
  reminder_count integer, last_reminder_at timestamp with time zone, returned_from text, returned_at timestamp with time zone,
  returned_done text, returned_todo text, is_confidential boolean, can_read boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.chrono,
    CASE WHEN rd.ok THEN c.subject ELSE '[courrier confidentiel]' END,
    c.channel::text, c.received_at, c.created_at,
    c.socle_organization_id, c.assigned_service, c.workflow_state_id,
    COALESCE(ws.is_initial, false) AS state_is_initial,
    ws.category::text AS state_category,
    c.acknowledged_at, c.resolved_at,
    CASE WHEN rd.ok THEN COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) END,
    j.status AS analysis_status,
    (ca.id IS NOT NULL) AS has_analysis,
    -- Le service proposé se garde : c'est ce qu'il faut pour router sans lire.
    ca.suggested_socle_organization_id,
    CASE WHEN rd.ok THEN ca.suggested_service_reason END,
    ca.suggested_service_confidence,
    COALESCE(ca.suggested_service_alternatives, '{}'::uuid[]) AS suggested_service_alternatives,
    CASE WHEN rd.ok AND jsonb_typeof(ca.intents) = 'array' THEN ca.intents->>0 END,
    CASE WHEN lr.event_type <> 'service_returned' THEN lr.at END AS routed_at,
    tk.at AS taken_at,
    COALESCE(rm.n, 0)::integer AS reminder_count,
    rm.last_at AS last_reminder_at,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'from' END AS returned_from,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.at END AS returned_at,
    CASE WHEN rd.ok AND lr.event_type = 'service_returned' THEN lr.payload->>'done' END,
    CASE WHEN rd.ok AND lr.event_type = 'service_returned' THEN lr.payload->>'todo' END,
    c.is_confidential,
    rd.ok
  FROM couriers c
  CROSS JOIN LATERAL (
    SELECT (NOT c.is_confidential
      OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)) AS ok
  ) rd
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
REVOKE EXECUTE ON FUNCTION public.mailroom_couriers(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mailroom_couriers(uuid, timestamptz) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.outbound_couriers(uuid, timestamptz);
CREATE FUNCTION public.outbound_couriers(
  p_organization_id uuid,
  p_since timestamptz DEFAULT (now() - interval '30 days')
)
RETURNS TABLE (
  id uuid, chrono text, subject text, channel text, parent_courier_id uuid, parent_chrono text, parent_subject text,
  socle_organization_id uuid, created_at timestamptz, sent_at timestamptz, state_id uuid, state_name text,
  state_is_initial boolean, state_is_final boolean, state_is_send boolean, state_requires_visa boolean,
  state_requires_signature boolean, signed_at timestamptz, sent_email_at timestamptz, posted_at timestamptz,
  recipient_name text, recipient_contact_id uuid, state_since timestamptz, is_confidential boolean, can_read boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    c.chrono::text,
    CASE WHEN rd.ok THEN c.subject ELSE '[courrier confidentiel]' END,
    c.channel::text,
    c.parent_courier_id,
    p.chrono::text AS parent_chrono,
    CASE WHEN rd.ok THEN p.subject END AS parent_subject,
    c.socle_organization_id,
    c.created_at::timestamptz,
    c.sent_at::timestamptz,
    c.workflow_state_id AS state_id,
    ws.name::text AS state_name,
    COALESCE(ws.is_initial, false),
    COALESCE(ws.is_final, false),
    COALESCE(ws.is_send, false),
    COALESCE(ws.requires_visa, false),
    COALESCE(ws.requires_signature, false),
    NULLIF(c.metadata->>'signed_at', '')::timestamptz,
    NULLIF(c.metadata->>'sent_email_at', '')::timestamptz,
    NULLIF(c.metadata->>'posted_at', '')::timestamptz,
    CASE WHEN rd.ok THEN COALESCE(NULLIF(btrim(r.name), ''), NULLIF(btrim(concat_ws(' ', r.first_name, r.last_name)), '')) END,
    CASE WHEN rd.ok THEN r.socle_contact_id END,
    COALESCE(ev.at, c.created_at::timestamptz),
    c.is_confidential,
    rd.ok
  FROM couriers c
  CROSS JOIN LATERAL (
    SELECT (NOT c.is_confidential
      OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)) AS ok
  ) rd
  LEFT JOIN workflow_states ws ON ws.id = c.workflow_state_id
  LEFT JOIN couriers p ON p.id = c.parent_courier_id AND p.organization_id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT x.name, x.first_name, x.last_name, x.socle_contact_id
    FROM (
      SELECT cp.name, cp.first_name, cp.last_name, cp.socle_contact_id, 0 AS rank, cp.id
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'recipient'
      UNION ALL
      SELECT cp.name, cp.first_name, cp.last_name, cp.socle_contact_id, 1 AS rank, cp.id
      FROM courier_participants cp
      WHERE cp.courier_id = c.parent_courier_id AND cp.role = 'sender'
    ) x
    ORDER BY x.rank, x.id
    LIMIT 1
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT max(ce.created_at)::timestamptz AS at
    FROM courier_events ce
    WHERE ce.courier_id = COALESCE(c.parent_courier_id, c.id)
      AND ce.event_type = 'reply_state_changed'
      AND ce.payload->>'reply_id' = c.id::text
      AND ce.payload->>'to_state_id' = c.workflow_state_id::text
  ) ev ON true
  WHERE c.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND c.direction = 'outbound'
    AND c.deleted_at IS NULL
    AND (
      NOT (COALESCE(ws.is_final, false) OR c.metadata ? 'sent_email_at' OR c.metadata ? 'posted_at')
      OR COALESCE(
        NULLIF(c.metadata->>'sent_email_at', '')::timestamptz,
        NULLIF(c.metadata->>'posted_at', '')::timestamptz,
        c.sent_at::timestamptz,
        c.updated_at::timestamptz
      ) >= p_since
    )
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 8000;
$function$;
REVOKE EXECUTE ON FUNCTION public.outbound_couriers(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outbound_couriers(uuid, timestamptz) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.trashed_couriers(uuid);
CREATE FUNCTION public.trashed_couriers(p_organization_id uuid)
RETURNS TABLE(
  id uuid, chrono text, subject text, direction text, channel text, received_at timestamp with time zone,
  created_at timestamp with time zone, deleted_at timestamp with time zone, deleted_by_name text,
  purge_at timestamp with time zone, sender_name text, reply_count integer, is_confidential boolean, can_read boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.chrono,
    CASE WHEN rd.ok THEN c.subject ELSE '[courrier confidentiel]' END,
    c.direction::text, c.channel::text,
    c.received_at, c.created_at,
    c.deleted_at,
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS deleted_by_name,
    c.deleted_at + interval '30 days' AS purge_at,
    CASE WHEN rd.ok THEN COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) END,
    (SELECT count(*)::integer FROM couriers r WHERE r.parent_courier_id = c.id) AS reply_count,
    c.is_confidential,
    rd.ok
  FROM couriers c
  CROSS JOIN LATERAL (
    SELECT (NOT c.is_confidential
      OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)) AS ok
  ) rd
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
REVOKE EXECUTE ON FUNCTION public.trashed_couriers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trashed_couriers(uuid) TO authenticated, service_role;

-- Historique d'un contact : la lecture directe des participants ferait
-- DISPARAÎTRE un courrier confidentiel ; ici il reste, masqué.
CREATE OR REPLACE FUNCTION public.contact_couriers(p_organization_id uuid, p_socle_contact_id uuid)
RETURNS TABLE(
  id uuid, subject text, received_at timestamptz, sent_at timestamptz, direction text, parent_courier_id uuid,
  channel text, chrono text, created_at timestamptz, workflow_state_name text, workflow_state_category text,
  is_confidential boolean, can_read boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    CASE WHEN rd.ok THEN c.subject ELSE '[courrier confidentiel]' END,
    c.received_at::timestamptz, c.sent_at::timestamptz, c.direction::text, c.parent_courier_id,
    c.channel::text, c.chrono::text, c.created_at::timestamptz,
    ws.name::text, ws.category::text,
    c.is_confidential,
    rd.ok
  FROM couriers c
  CROSS JOIN LATERAL (
    SELECT (NOT c.is_confidential
      OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)) AS ok
  ) rd
  LEFT JOIN workflow_states ws ON ws.id = c.workflow_state_id
  WHERE c.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND c.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.socle_contact_id = p_socle_contact_id
    )
  ORDER BY COALESCE(c.received_at, c.sent_at, c.created_at) DESC, c.id DESC;
$function$;
REVOKE EXECUTE ON FUNCTION public.contact_couriers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_couriers(uuid, uuid) TO authenticated, service_role;

-- ─── 8. Création d'un sortant à l'initiative : le drapeau dès la création ──

DROP FUNCTION IF EXISTS public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb);
CREATE FUNCTION public.create_outbound_courier(
  p_organization_id uuid, p_socle_organization_id uuid, p_channel courier_channel, p_subject text, p_recipient jsonb,
  p_is_confidential boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject text := NULLIF(btrim(p_subject), '');
  v_contact uuid := NULLIF(p_recipient ->> 'socle_contact_id', '')::uuid;
  v_org public.socle_organizations%ROWTYPE;
  v_state uuid;
  v_id uuid;
BEGIN
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'L''objet du courrier est obligatoire.' USING ERRCODE = 'P0001';
  END IF;
  IF v_contact IS NULL THEN
    RAISE EXCEPTION 'Choisissez le destinataire dans le référentiel des contacts.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_org FROM public.socle_organizations
  WHERE id = p_socle_organization_id AND organization_id = p_organization_id;

  IF v_org.reply_workflow_id IS NOT NULL THEN
    SELECT ws.id INTO v_state
    FROM public.workflow_states ws
    WHERE ws.workflow_id = v_org.reply_workflow_id AND ws.is_initial IS TRUE
    ORDER BY ws.created_at
    LIMIT 1;
  END IF;

  INSERT INTO public.couriers (
    organization_id, direction, channel, subject, socle_organization_id,
    assigned_service, workflow_state_id, created_by, metadata, is_confidential
  ) VALUES (
    p_organization_id, 'outbound', p_channel, left(v_subject, 500), p_socle_organization_id,
    v_org.name, v_state, auth.uid(), jsonb_build_object('body_html', '', 'body_text', '', 'is_draft', true),
    COALESCE(p_is_confidential, false)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.courier_participants (
    organization_id, courier_id, role, socle_contact_id,
    name, first_name, last_name, organization, email, phone, address, metadata
  ) VALUES (
    p_organization_id, v_id, 'recipient', v_contact,
    NULLIF(p_recipient ->> 'name', ''),
    NULLIF(p_recipient ->> 'first_name', ''),
    NULLIF(p_recipient ->> 'last_name', ''),
    NULLIF(p_recipient ->> 'organization', ''),
    NULLIF(p_recipient ->> 'email', ''),
    NULLIF(p_recipient ->> 'phone', ''),
    NULLIF(p_recipient ->> 'address', ''),
    jsonb_strip_nulls(jsonb_build_object(
      'address_line1', NULLIF(p_recipient ->> 'address_line1', ''),
      'address_line2', NULLIF(p_recipient ->> 'address_line2', ''),
      'postal_code', NULLIF(p_recipient ->> 'postal_code', ''),
      'city', NULLIF(p_recipient ->> 'city', '')
    ))
  );

  INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
  VALUES (
    p_organization_id, v_id, 'outbound_created',
    jsonb_build_object(
      'reply_id', v_id,
      'channel', p_channel,
      'socle_organization_id', p_socle_organization_id,
      'organization_name', v_org.name,
      'recipient_name', NULLIF(p_recipient ->> 'name', '')
    ),
    auth.uid()
  );

  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean) TO authenticated;

-- Fonctions de trigger : jamais appelées par l'API.
REVOKE EXECUTE ON FUNCTION public.couriers_guard_confidential() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.couriers_after_confidential_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notifications_mask_confidential() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organization_users_log_confidential_access() FROM PUBLIC, anon, authenticated;
