-- Courriers sortants à l'initiative : envoi par courriel (2026-10-13, lot 2).
--
-- 1. Pas de clôture sans envoi. Un sortant à l'initiative en mode courriel ne
--    passe pas dans un état « traité » (`category = 'processed'`) tant que
--    `metadata.sent_email_at` est vide : sinon un courriel « traité » ne
--    partirait jamais. Les états d'abandon (`archived`) restent libres. Le
--    trigger `couriers_enforce_outbound_initiative` regarde désormais aussi
--    `workflow_state_id`.
-- 2. Réservation atomique de l'envoi (`claim_outbound_email_send`). La garde de
--    `send-courier-reply` lisait `sent_email_at` puis envoyait : deux clics
--    rapprochés passaient tous deux. La réservation pose
--    `metadata.email_send_claimed_at` en une écriture conditionnelle ; une
--    réservation de plus de 2 minutes (fonction tombée en route) est reprise.
--    `finish_outbound_email_send` pose le marqueur d'envoi et la vraie date
--    d'envoi ; `release_outbound_email_send` libère après un échec. Les trois,
--    pour le service seulement : c'est la fonction d'envoi qui les appelle.
--
-- Messages IDENTIQUES à `supabase/functions/_shared/outboundInitiativeGuard.ts`.
-- Voir docs/specs/courriers-sortants.md. Idempotent.

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
  v_category text;
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

  -- Clôture d'un courriel : seulement une fois parti.
  IF NEW.workflow_state_id IS DISTINCT FROM OLD.workflow_state_id
     AND NEW.workflow_state_id IS NOT NULL
     AND NEW.channel = 'email'
     AND (NEW.metadata ->> 'sent_email_at') IS NULL THEN
    SELECT ws.category::text INTO v_category FROM public.workflow_states ws WHERE ws.id = NEW.workflow_state_id;
    IF v_category = 'processed' THEN
      RAISE EXCEPTION 'Ce courriel n''est pas encore parti : envoyez-le avant de le clore (ou abandonnez-le).'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.socle_organization_id IS NOT DISTINCT FROM OLD.socle_organization_id
     AND NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
    RETURN NEW;
  END IF;

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
  BEFORE INSERT OR UPDATE OF socle_organization_id, channel, workflow_state_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_outbound_initiative();

-- ─── Réservation de l'envoi ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_outbound_email_send(p_courier_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH claimed AS (
    UPDATE public.couriers
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('email_send_claimed_at', now())
     WHERE id = p_courier_id
       AND organization_id = p_organization_id
       AND (metadata ->> 'sent_email_at') IS NULL
       AND (
         (metadata ->> 'email_send_claimed_at') IS NULL
         OR (metadata ->> 'email_send_claimed_at')::timestamptz < now() - interval '2 minutes'
       )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$function$;

CREATE OR REPLACE FUNCTION public.finish_outbound_email_send(p_courier_id uuid, p_message_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE public.couriers
     SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'email_send_claimed_at')
                    || jsonb_build_object('sent_email_at', now(), 'sent_email_message_id', p_message_id),
         sent_at = now()
   WHERE id = p_courier_id;
$function$;

CREATE OR REPLACE FUNCTION public.release_outbound_email_send(p_courier_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  UPDATE public.couriers
     SET metadata = COALESCE(metadata, '{}'::jsonb) - 'email_send_claimed_at'
   WHERE id = p_courier_id AND (metadata ->> 'sent_email_at') IS NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_outbound_email_send(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_outbound_email_send(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_outbound_email_send(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbound_email_send(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_outbound_email_send(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_outbound_email_send(uuid) TO service_role;
