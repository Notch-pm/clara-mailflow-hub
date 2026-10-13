-- Courriers sortants à l'initiative : envoi postal (2026-10-13, lot 4).
--
-- « Posté » est une déclaration de l'agent : il imprime la lettre, la met sous
-- pli, puis confirme la date. Elle vit dans `metadata.posted_at` (date ISO),
-- avec `posted_by` et `posted_document_id` (l'exemplaire HTML conservé).
--
-- Le trigger `couriers_enforce_outbound_initiative` regarde désormais aussi
-- `metadata` :
--   • `posted_at` ne se pose que sur un courrier postal, à une date ni future
--     ni antérieure à la création du courrier (jour de Paris), et ne se
--     modifie ni ne se retire ensuite ;
--   • la pose fixe `sent_at` à ce jour-là : la date d'envoi, c'est la date
--     déclarée, pas l'heure du clic ;
--   • un courrier postal ne passe dans un état « traité » qu'une fois posté
--     (l'abandon, `archived`, reste libre) — symétrique de la règle du courriel.
-- Service_role et GUC dispensés, comme le reste de la garde.
--
-- Messages IDENTIQUES à `supabase/functions/_shared/outboundInitiativeGuard.ts`.
-- Idempotent.

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
  v_old_posted text;
  v_new_posted text;
  v_posted_day date;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
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

  -- Déclaration « posté ».
  v_old_posted := OLD.metadata ->> 'posted_at';
  v_new_posted := NEW.metadata ->> 'posted_at';
  IF v_new_posted IS DISTINCT FROM v_old_posted THEN
    IF v_old_posted IS NOT NULL THEN
      RAISE EXCEPTION 'Ce courrier est déjà déclaré posté : cette déclaration ne se modifie plus.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.channel IS DISTINCT FROM 'paper' THEN
      RAISE EXCEPTION 'Seul un courrier postal se déclare « posté ».' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_posted_day := v_new_posted::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'La date d''envoi ne peut être ni dans le futur, ni antérieure à la création du courrier.'
        USING ERRCODE = 'P0001';
    END;
    IF v_posted_day > v_today OR v_posted_day < (NEW.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date THEN
      RAISE EXCEPTION 'La date d''envoi ne peut être ni dans le futur, ni antérieure à la création du courrier.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.sent_at := v_posted_day::timestamp;
  END IF;

  -- Clôture : un courriel une fois parti, un courrier postal une fois posté.
  IF NEW.workflow_state_id IS DISTINCT FROM OLD.workflow_state_id AND NEW.workflow_state_id IS NOT NULL THEN
    SELECT ws.category::text INTO v_category FROM public.workflow_states ws WHERE ws.id = NEW.workflow_state_id;
    IF v_category = 'processed' THEN
      IF NEW.channel = 'email' AND (NEW.metadata ->> 'sent_email_at') IS NULL THEN
        RAISE EXCEPTION 'Ce courriel n''est pas encore parti : envoyez-le avant de le clore (ou abandonnez-le).'
          USING ERRCODE = 'P0001';
      END IF;
      IF NEW.channel = 'paper' AND (NEW.metadata ->> 'posted_at') IS NULL THEN
        RAISE EXCEPTION 'Ce courrier n''a pas encore été posté : déclarez-le « posté » avant de le clore (ou abandonnez-le).'
          USING ERRCODE = 'P0001';
      END IF;
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
  BEFORE INSERT OR UPDATE OF socle_organization_id, channel, workflow_state_id, metadata ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_outbound_initiative();
