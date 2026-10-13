-- Courrier sortant : un expéditeur facultatif, contact Interne ou Élu.
--
-- Un sortant part de son organisation émettrice (`socle_organization_id`),
-- signé par le signataire choisi. On peut désormais nommer en plus la personne
-- au nom de qui il part : un contact du référentiel portant le rôle Interne ou
-- Élu, rangé comme participant `sender` (les sortants n'en avaient pas).
--
-- `create_outbound_courier` gagne un 7e paramètre `p_sender jsonb DEFAULT NULL` ;
-- le corps est repris À L'IDENTIQUE de 20261013160000_courriers_confidentiels.sql
-- (vérifié contre la base le 2026-10-13), seul l'expéditeur s'ajoute. Les appels
-- sans `p_sender` (frontend déjà déployé, tests SQL positionnels) restent valides.
-- Après création, l'écran change l'expéditeur par `courier_participants` (RLS).
-- Rejouable.

DROP FUNCTION IF EXISTS public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean, jsonb);
CREATE FUNCTION public.create_outbound_courier(
  p_organization_id uuid, p_socle_organization_id uuid, p_channel courier_channel, p_subject text, p_recipient jsonb,
  p_is_confidential boolean DEFAULT false,
  p_sender jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject text := NULLIF(btrim(p_subject), '');
  v_contact uuid := NULLIF(p_recipient ->> 'socle_contact_id', '')::uuid;
  v_sender uuid := NULLIF(p_sender ->> 'socle_contact_id', '')::uuid;
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

  -- Expéditeur facultatif : un contact Interne ou Élu du référentiel, au nom
  -- duquel le courrier part. L'organisation émettrice et le signataire ne
  -- changent pas.
  IF v_sender IS NOT NULL THEN
    INSERT INTO public.courier_participants (
      organization_id, courier_id, role, socle_contact_id, name, first_name, last_name, email
    ) VALUES (
      p_organization_id, v_id, 'sender', v_sender,
      NULLIF(p_sender ->> 'name', ''),
      NULLIF(p_sender ->> 'first_name', ''),
      NULLIF(p_sender ->> 'last_name', ''),
      NULLIF(p_sender ->> 'email', '')
    );
  END IF;

  INSERT INTO public.courier_events (organization_id, courier_id, event_type, payload, created_by)
  VALUES (
    p_organization_id, v_id, 'outbound_created',
    jsonb_build_object(
      'reply_id', v_id,
      'channel', p_channel,
      'socle_organization_id', p_socle_organization_id,
      'organization_name', v_org.name,
      'recipient_name', NULLIF(p_recipient ->> 'name', ''),
      'sender_name', CASE WHEN v_sender IS NOT NULL THEN NULLIF(p_sender ->> 'name', '') END
    ),
    auth.uid()
  );

  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_outbound_courier(uuid, uuid, courier_channel, text, jsonb, boolean, jsonb) TO authenticated;
