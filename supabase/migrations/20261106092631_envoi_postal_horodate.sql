-- Envoi postal horodaté, et pour les réponses aussi (2026-11-06).
--
-- Jusqu'ici, « posté » ne valait que pour un courrier à l'initiative et ne
-- retenait que le JOUR (`metadata.posted_at` = AAAA-MM-JJ). Désormais, tout
-- sortant postal — réponse ou courrier à l'initiative — se déclare envoyé avec :
--   • `metadata.posted_at`   : date ET heure d'envoi (horodatage ISO 8601 avec
--     fuseau, ex. 2026-11-06T13:45:00.000Z) ;
--   • `metadata.posted_mode` : 'simple' (courrier simple) ou 'recommande'.
-- Les deux sont exigés ensemble, ni dans le futur (5 min de tolérance d'horloge)
-- ni avant la création du courrier, et ne se modifient plus ensuite. La pose
-- fixe `sent_at` à l'horodatage déclaré.
--
-- Le contrôle de la déclaration s'applique maintenant AUSSI aux réponses
-- (`parent_courier_id` non nul) ; le reste de la garde (organisation émettrice,
-- canal, clôture d'un courrier non posté) reste propre aux courriers à
-- l'initiative, comme avant.
--
-- Les déclarations existantes (date seule) ne sont pas réécrites : elles restent
-- lisibles telles quelles (`posted_at::timestamptz` = minuit).
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
  v_posted timestamptz;
BEGIN
  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;
  IF NEW.direction IS DISTINCT FROM 'outbound' THEN
    RETURN NEW;
  END IF;

  -- Déclaration « envoyé par courrier » : réponses ET courriers à l'initiative.
  IF TG_OP = 'UPDATE' THEN
    v_old_posted := OLD.metadata ->> 'posted_at';
    v_new_posted := NEW.metadata ->> 'posted_at';
    IF v_new_posted IS DISTINCT FROM v_old_posted
       OR (NEW.metadata ->> 'posted_mode') IS DISTINCT FROM (OLD.metadata ->> 'posted_mode') THEN
      IF v_old_posted IS NOT NULL THEN
        RAISE EXCEPTION 'Ce courrier est déjà déclaré posté : cette déclaration ne se modifie plus.'
          USING ERRCODE = 'P0001';
      END IF;
      IF NEW.channel IS DISTINCT FROM 'paper' THEN
        RAISE EXCEPTION 'Seul un courrier postal se déclare « posté ».' USING ERRCODE = 'P0001';
      END IF;
      IF v_new_posted IS NULL OR v_new_posted !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' THEN
        RAISE EXCEPTION 'Indiquez la date et l''heure d''envoi du courrier.' USING ERRCODE = 'P0001';
      END IF;
      BEGIN
        v_posted := v_new_posted::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Indiquez la date et l''heure d''envoi du courrier.' USING ERRCODE = 'P0001';
      END;
      IF v_posted > now() + interval '5 minutes' OR v_posted < date_trunc('minute', NEW.created_at) THEN
        RAISE EXCEPTION 'La date et l''heure d''envoi ne peuvent être ni dans le futur, ni antérieures à la création du courrier.'
          USING ERRCODE = 'P0001';
      END IF;
      IF (NEW.metadata ->> 'posted_mode') IS NULL OR (NEW.metadata ->> 'posted_mode') NOT IN ('simple', 'recommande') THEN
        RAISE EXCEPTION 'Précisez le type d''envoi : courrier simple ou recommandé.' USING ERRCODE = 'P0001';
      END IF;
      NEW.sent_at := v_posted;
    END IF;
  END IF;

  -- Le reste ne garde que les courriers à l'initiative.
  IF NEW.parent_courier_id IS NOT NULL THEN
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
