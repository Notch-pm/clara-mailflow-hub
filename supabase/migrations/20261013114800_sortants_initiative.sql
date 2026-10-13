-- Courriers sortants à l'initiative de la collectivité (2026-10-13, lot 1).
--
-- Un sortant SANS parent (`direction = 'outbound' AND parent_courier_id IS
-- NULL`) n'est la réponse à rien : c'est l'organisation émettrice qui écrit la
-- première. Il suit le workflow de RÉPONSE de cette organisation — visa,
-- signature, envoi — comme une réponse. Voir docs/specs/courriers-sortants.md.
--
-- 1. `outbound_initiative_block_reason` — pourquoi un tel sortant ne peut pas
--    naître ainsi (organisation absente, d'un autre tenant, obsolète, sans
--    workflow de réponse ; état qui n'est pas l'état initial de ce workflow ;
--    canal autre que courriel ou courrier).
-- 2. Trigger `trg_couriers_enforce_outbound_initiative` — tient la règle pour
--    TOUT appelant authentifié : la RLS laisse un éditeur insérer directement
--    dans `couriers`, seule une garde sur la table tient. Service_role et GUC
--    `clara.bypass_transition_guard` dispensés (`is_transition_guard_bypassed`),
--    comme la garde des transitions.
--    En UPDATE : l'organisation émettrice ne change qu'à l'état initial, et
--    l'organisation comme le canal se figent dès qu'un visa, une signature ou
--    un envoi est posé. Les coquilles d'avant ce lot (ni organisation ni état)
--    peuvent recevoir une organisation sans état (« Affecter une organisation »).
-- 3. RPC `create_outbound_courier` — crée en UNE transaction le courrier à
--    l'état initial, son destinataire (fiche du référentiel obligatoire) et
--    l'événement `outbound_created`. SECURITY INVOKER : la RLS et tous les
--    triggers de l'appelant s'appliquent (un consultant est refusé). Un échec
--    annule tout, numéro `S` compris.
--
-- Messages IDENTIQUES à `supabase/functions/_shared/outboundInitiativeGuard.ts`.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.outbound_initiative_block_reason(
  p_organization_id uuid,
  p_socle_organization_id uuid,
  p_workflow_state_id uuid,
  p_channel public.courier_channel
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org public.socle_organizations%ROWTYPE;
  v_initial uuid;
BEGIN
  IF p_socle_organization_id IS NULL THEN
    RETURN 'Choisissez l''organisation qui émet ce courrier.';
  END IF;

  SELECT * INTO v_org FROM public.socle_organizations WHERE id = p_socle_organization_id;
  IF v_org.id IS NULL OR v_org.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN 'Cette organisation n''appartient pas à votre collectivité.';
  END IF;
  IF v_org.status = 'obsolete' OR v_org.obsoleted_at IS NOT NULL THEN
    RETURN format('L''organisation « %s » n''est plus active : choisissez-en une autre.', v_org.name);
  END IF;
  IF v_org.reply_workflow_id IS NULL THEN
    RETURN format('Aucun workflow de réponse n''est configuré pour l''organisation « %s ». Un administrateur doit le rattacher.', v_org.name);
  END IF;

  SELECT ws.id INTO v_initial
  FROM public.workflow_states ws
  WHERE ws.workflow_id = v_org.reply_workflow_id AND ws.is_initial IS TRUE
  ORDER BY ws.created_at
  LIMIT 1;
  IF v_initial IS NULL THEN
    RETURN format('Le workflow de réponse de l''organisation « %s » n''a pas d''état initial. Un administrateur doit le compléter.', v_org.name);
  END IF;
  IF p_workflow_state_id IS DISTINCT FROM v_initial THEN
    RETURN 'Un courrier sortant naît à l''état initial du workflow de réponse de son organisation.';
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('email', 'paper') THEN
    RETURN 'Un courrier sortant part par courriel ou par courrier postal.';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.outbound_initiative_block_reason(uuid, uuid, uuid, public.courier_channel)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_initiative_block_reason(uuid, uuid, uuid, public.courier_channel)
  TO service_role;

CREATE OR REPLACE FUNCTION public.couriers_enforce_outbound_initiative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_reason text;
  v_locked boolean;
  v_old_initial boolean;
  v_org public.socle_organizations%ROWTYPE;
BEGIN
  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;
  IF NEW.direction IS DISTINCT FROM 'outbound' OR NEW.parent_courier_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_reason := public.outbound_initiative_block_reason(
      NEW.organization_id, NEW.socle_organization_id, NEW.workflow_state_id, NEW.channel);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : seuls l'organisation émettrice et le canal sont gardés ici ; les
  -- changements d'état relèvent de `couriers_enforce_transition`.
  IF NEW.socle_organization_id IS NOT DISTINCT FROM OLD.socle_organization_id
     AND NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
    RETURN NEW;
  END IF;

  -- Visé, signé ou parti : ce qui a été validé ne change plus d'émetteur ni de canal.
  v_locked :=
    (OLD.metadata ->> 'signed_at') IS NOT NULL
    OR (OLD.metadata ->> 'sent_email_at') IS NOT NULL
    OR (OLD.metadata ->> 'posted_at') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.courier_visas v
      WHERE v.courier_id = OLD.id AND v.superseded_at IS NULL
    );
  IF v_locked THEN
    RAISE EXCEPTION 'Courrier déjà visé, signé ou envoyé : son organisation émettrice et son mode d''envoi ne changent plus.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.channel IS DISTINCT FROM OLD.channel AND NEW.channel NOT IN ('email', 'paper') THEN
    RAISE EXCEPTION 'Un courrier sortant part par courriel ou par courrier postal.' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.socle_organization_id IS DISTINCT FROM OLD.socle_organization_id THEN
    -- Coquille d'avant le lot 1 (aucun état) : on lui affecte une organisation,
    -- sans encore la faire entrer dans un workflow.
    IF OLD.workflow_state_id IS NULL AND NEW.workflow_state_id IS NULL THEN
      IF NEW.socle_organization_id IS NULL THEN
        RAISE EXCEPTION 'Choisissez l''organisation qui émet ce courrier.' USING ERRCODE = 'P0001';
      END IF;
      SELECT * INTO v_org FROM public.socle_organizations WHERE id = NEW.socle_organization_id;
      IF v_org.id IS NULL OR v_org.organization_id IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'Cette organisation n''appartient pas à votre collectivité.' USING ERRCODE = 'P0001';
      END IF;
      IF v_org.status = 'obsolete' OR v_org.obsoleted_at IS NOT NULL THEN
        RAISE EXCEPTION '%', format('L''organisation « %s » n''est plus active : choisissez-en une autre.', v_org.name)
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;

    IF OLD.workflow_state_id IS NOT NULL THEN
      SELECT COALESCE(ws.is_initial, false) INTO v_old_initial
      FROM public.workflow_states ws WHERE ws.id = OLD.workflow_state_id;
      IF NOT COALESCE(v_old_initial, false) THEN
        RAISE EXCEPTION 'On ne change d''organisation émettrice qu''à l''état initial du workflow.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- La nouvelle organisation : mêmes exigences qu'à la création, l'état devant
    -- être l'état initial de SON workflow de réponse.
    v_reason := public.outbound_initiative_block_reason(
      NEW.organization_id, NEW.socle_organization_id, NEW.workflow_state_id, NEW.channel);
    IF v_reason IS NOT NULL THEN
      RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.couriers_enforce_outbound_initiative() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_enforce_outbound_initiative ON public.couriers;
CREATE TRIGGER trg_couriers_enforce_outbound_initiative
  BEFORE INSERT OR UPDATE OF socle_organization_id, channel ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_outbound_initiative();

-- ─── Création ──────────────────────────────────────────────────────────────
-- `p_recipient` : { socle_contact_id (obligatoire), name, first_name,
-- last_name, organization, email, phone, address, address_line1,
-- address_line2, postal_code, city } — instantané de la fiche du référentiel
-- (aucune identité n'est stockée ailleurs que dans le participant).

CREATE OR REPLACE FUNCTION public.create_outbound_courier(
  p_organization_id uuid,
  p_socle_organization_id uuid,
  p_channel public.courier_channel,
  p_subject text,
  p_recipient jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

  -- Le trigger rend le motif précis (organisation, workflow, état, canal).
  INSERT INTO public.couriers (
    organization_id, direction, channel, subject, socle_organization_id,
    assigned_service, workflow_state_id, created_by, metadata
  ) VALUES (
    p_organization_id, 'outbound', p_channel, left(v_subject, 500), p_socle_organization_id,
    v_org.name, v_state, auth.uid(), jsonb_build_object('body_html', '', 'body_text', '', 'is_draft', true)
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

REVOKE EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, public.courier_channel, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, public.courier_channel, text, jsonb)
  TO authenticated, service_role;
