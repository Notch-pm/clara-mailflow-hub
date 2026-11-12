-- ============================================================================
-- Courrier de réponse déposé par IRIS (2026-11-12).
--
-- Une démarche du Socle peut exiger que ses courriers de réponse passent par le
-- circuit du courrier sortant de Clara (Socle
-- `communication_config.replyLetters.claraOutbound`, contrat 1.46.0). L'agent
-- d'Iris rédige le courrier ; Iris le dépose par la porte `iris-reply-courier`
-- (clé `IRIS_INTAKE_KEY`, de serveur à serveur). Clara le range en COURRIER
-- SORTANT à l'initiative, à l'état initial du workflow de réponse de
-- l'organisation émettrice, lié à la demande Iris (`couriers.iris_*`).
--
-- Quand le courrier PART (courriel envoyé, courrier déclaré posté — à la main ou
-- par Merci Facteur —, état « traité ») ou qu'il est ABANDONNÉ (état
-- « archivé », suppression), un trigger met un avis en file
-- (`iris_reply_notifications`) ; `notify-iris-reply` le livre à Iris
-- (`POST /v1/requests/{id}/reply-letter/events`, contrat Iris 2.12.0), qui clôt
-- la demande avec l'issue choisie par son agent. Clara ne décide jamais du
-- statut de la demande : elle transmet un FAIT.
--
-- Le trigger couvre les quatre chemins d'envoi existants SANS les modifier.
-- Le cron qui draine la file est dans la migration suivante, à appliquer APRÈS
-- le déploiement de `notify-iris-reply` (docs/deployment.md).
-- Rejouable : IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS.
-- ============================================================================

-- 1. Le lien courrier → demande Iris ---------------------------------------------
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS iris_request_id uuid,
  ADD COLUMN IF NOT EXISTS iris_reference  text,
  ADD COLUMN IF NOT EXISTS iris_url        text,
  ADD COLUMN IF NOT EXISTS iris_reply_key  uuid;

ALTER TABLE public.couriers DROP CONSTRAINT IF EXISTS couriers_iris_url_https;
ALTER TABLE public.couriers ADD CONSTRAINT couriers_iris_url_https
  CHECK (iris_url IS NULL OR (iris_url ~ '^https://' AND length(iris_url) <= 500));

-- Idempotence du dépôt : un rejeu d'Iris (même soumission) rend le même courrier.
CREATE UNIQUE INDEX IF NOT EXISTS couriers_iris_reply_key_uniq
  ON public.couriers (organization_id, iris_reply_key) WHERE iris_reply_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS couriers_iris_request_idx
  ON public.couriers (iris_request_id) WHERE iris_request_id IS NOT NULL;

COMMENT ON COLUMN public.couriers.iris_request_id IS
  'Demande Iris dont ce courrier sortant est le courrier de réponse (dépôt par iris-reply-courier). UUID nu : aucune FK ne franchit la frontière Clara / Iris.';
COMMENT ON COLUMN public.couriers.iris_reply_key IS
  'Identifiant de soumission d''Iris (idempotence du dépôt).';

-- 2. Création par Iris (service seulement) ----------------------------------------
-- Reprend `create_outbound_courier` sans `auth.uid()` : le dépôt vient d'un
-- serveur. ⚠️ Appelée en service_role, la garde `couriers_enforce_outbound_initiative`
-- est contournée (`is_transition_guard_bypassed`) : la règle de naissance
-- (organisation de la collectivité, active, workflow de réponse, état initial,
-- canal) est donc vérifiée ICI, par la même fonction.
CREATE OR REPLACE FUNCTION public.create_outbound_courier_from_iris(
  p_organization_id       uuid,
  p_socle_organization_id uuid,
  p_channel               public.courier_channel,
  p_subject               text,
  p_body_html             text,
  p_body_text             text,
  p_recipient             jsonb,
  p_iris                  jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_subject text := NULLIF(btrim(p_subject), '');
  v_contact uuid := NULLIF(p_recipient ->> 'socle_contact_id', '')::uuid;
  v_key     uuid := NULLIF(p_iris ->> 'reply_key', '')::uuid;
  v_req     uuid := NULLIF(p_iris ->> 'request_id', '')::uuid;
  v_url     text := NULLIF(p_iris ->> 'url', '');
  v_org     public.socle_organizations%ROWTYPE;
  v_state   uuid;
  v_reason  text;
  v_id      uuid;
BEGIN
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'L''objet du courrier est obligatoire.' USING ERRCODE = 'P0001';
  END IF;
  IF v_contact IS NULL THEN
    RAISE EXCEPTION 'Le destinataire doit être une fiche du référentiel des contacts.' USING ERRCODE = 'P0001';
  END IF;
  IF v_key IS NULL OR v_req IS NULL THEN
    RAISE EXCEPTION 'Demande Iris et identifiant de dépôt obligatoires.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_org FROM public.socle_organizations
   WHERE id = p_socle_organization_id AND organization_id = p_organization_id;
  IF v_org.reply_workflow_id IS NOT NULL THEN
    SELECT ws.id INTO v_state FROM public.workflow_states ws
     WHERE ws.workflow_id = v_org.reply_workflow_id AND ws.is_initial IS TRUE
     ORDER BY ws.created_at LIMIT 1;
  END IF;

  v_reason := public.outbound_initiative_block_reason(
    p_organization_id, p_socle_organization_id, v_state, p_channel);
  IF v_reason IS NOT NULL THEN
    -- Code dédié : la porte le traduit en `no_reply_workflow` pour Iris.
    RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0010';
  END IF;

  INSERT INTO public.couriers (
    organization_id, direction, channel, subject, socle_organization_id,
    assigned_service, workflow_state_id, created_by, metadata, is_confidential,
    iris_request_id, iris_reference, iris_url, iris_reply_key
  ) VALUES (
    p_organization_id, 'outbound', p_channel, left(v_subject, 500), p_socle_organization_id,
    v_org.name, v_state, NULL,
    jsonb_build_object(
      'body_html', COALESCE(p_body_html, ''),
      'body_text', COALESCE(p_body_text, ''),
      'is_draft', true,
      'source', 'iris',
      'iris_submitted_by', NULLIF(p_iris ->> 'submitted_by_name', '')
    ),
    false,
    v_req, left(NULLIF(p_iris ->> 'reference', ''), 64),
    CASE WHEN v_url ~ '^https://' THEN left(v_url, 500) END,
    v_key
  )
  RETURNING id INTO v_id;

  INSERT INTO public.courier_participants (
    organization_id, courier_id, role, socle_contact_id, name, first_name, last_name, email
  ) VALUES (
    p_organization_id, v_id, 'recipient', v_contact,
    NULLIF(p_recipient ->> 'name', ''),
    NULLIF(p_recipient ->> 'first_name', ''),
    NULLIF(p_recipient ->> 'last_name', ''),
    NULLIF(p_recipient ->> 'email', '')
  );

  INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
  VALUES (
    p_organization_id, v_id, 'iris_reply_received',
    jsonb_build_object(
      'reply_id', v_id,
      'channel', p_channel,
      'socle_organization_id', p_socle_organization_id,
      'organization_name', v_org.name,
      'iris_request_id', v_req,
      'iris_reference', NULLIF(p_iris ->> 'reference', ''),
      'submitted_by', NULLIF(p_iris ->> 'submitted_by_name', '')
    ),
    NULL
  );

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_outbound_courier_from_iris(uuid, uuid, public.courier_channel, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_outbound_courier_from_iris(uuid, uuid, public.courier_channel, text, text, text, jsonb, jsonb)
  TO service_role;

-- 3. La file des avis à Iris -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.iris_reply_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id      uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  iris_request_id uuid NOT NULL,
  event           text NOT NULL CHECK (event IN ('sent', 'cancelled')),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'rejected', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_http_status integer,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Un courrier n'a qu'un destin : parti OU abandonné — le premier fait l'emporte.
  CONSTRAINT iris_reply_notifications_courier_uniq UNIQUE (courier_id)
);
CREATE INDEX IF NOT EXISTS iris_reply_notifications_due_idx
  ON public.iris_reply_notifications (next_attempt_at) WHERE status = 'pending';

COMMENT ON TABLE public.iris_reply_notifications IS
  'Avis à Iris sur un courrier de réponse déposé par Iris (parti / abandonné). Alimentée par trigger, drainée par notify-iris-reply. Aucune surface cliente.';

ALTER TABLE public.iris_reply_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.iris_reply_notifications FROM anon, authenticated;
DROP POLICY IF EXISTS iris_reply_notifications_service ON public.iris_reply_notifications;
CREATE POLICY iris_reply_notifications_service ON public.iris_reply_notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Le trigger : un avis dès que le courrier part ou est abandonné ----------------
CREATE OR REPLACE FUNCTION public.couriers_enqueue_iris_reply_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event    text;
  v_at       timestamptz;
  v_category text;
  v_old_cat  text;
BEGIN
  IF NEW.iris_request_id IS NULL OR NEW.direction IS DISTINCT FROM 'outbound' THEN
    RETURN NULL;
  END IF;

  IF NEW.workflow_state_id IS DISTINCT FROM OLD.workflow_state_id THEN
    SELECT ws.category::text INTO v_category FROM public.workflow_states ws WHERE ws.id = NEW.workflow_state_id;
    SELECT ws.category::text INTO v_old_cat  FROM public.workflow_states ws WHERE ws.id = OLD.workflow_state_id;
  END IF;

  IF (OLD.metadata ->> 'sent_email_at') IS NULL AND (NEW.metadata ->> 'sent_email_at') IS NOT NULL THEN
    v_event := 'sent';
    v_at := (NEW.metadata ->> 'sent_email_at')::timestamptz;
  ELSIF (OLD.metadata ->> 'posted_at') IS NULL AND (NEW.metadata ->> 'posted_at') IS NOT NULL THEN
    v_event := 'sent';
    v_at := (NEW.metadata ->> 'posted_at')::timestamptz;
  ELSIF v_category = 'processed' AND v_old_cat IS DISTINCT FROM 'processed' THEN
    -- La garde refuse « traité » à un sortant qui n'est pas parti : on y est
    -- donc arrivé APRÈS l'envoi, dont l'avis est déjà en file (sans effet ici).
    v_event := 'sent';
    v_at := COALESCE((NEW.metadata ->> 'sent_email_at')::timestamptz,
                     (NEW.metadata ->> 'posted_at')::timestamptz, now());
  ELSIF (v_category = 'archived' AND v_old_cat IS DISTINCT FROM 'archived')
        OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    IF (NEW.metadata ->> 'sent_email_at') IS NULL AND (NEW.metadata ->> 'posted_at') IS NULL THEN
      v_event := 'cancelled';
      v_at := now();
    END IF;
  END IF;

  IF v_event IS NOT NULL THEN
    INSERT INTO public.iris_reply_notifications (organization_id, courier_id, iris_request_id, event, occurred_at)
    VALUES (NEW.organization_id, NEW.id, NEW.iris_request_id, v_event, COALESCE(v_at, now()))
    ON CONFLICT (courier_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.couriers_enqueue_iris_reply_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_enqueue_iris_reply ON public.couriers;
CREATE TRIGGER trg_couriers_enqueue_iris_reply
  AFTER UPDATE ON public.couriers
  FOR EACH ROW
  WHEN (NEW.iris_request_id IS NOT NULL)
  EXECUTE FUNCTION public.couriers_enqueue_iris_reply_notification();

-- 5. Réclamer un lot d'avis (bail de 5 min : un worker tombé ne bloque rien) -------
CREATE OR REPLACE FUNCTION public.claim_iris_reply_notifications(p_limit integer DEFAULT 20)
RETURNS SETOF public.iris_reply_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.iris_reply_notifications n
     SET next_attempt_at = now() + interval '5 minutes',
         attempts = n.attempts + 1
   WHERE n.id IN (
     SELECT id FROM public.iris_reply_notifications
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING n.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_iris_reply_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_iris_reply_notifications(integer) TO service_role;
