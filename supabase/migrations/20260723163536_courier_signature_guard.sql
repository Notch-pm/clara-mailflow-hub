-- Garde serveur de la SIGNATURE des réponses (P0 #7 du plan de tests QA).
--
-- Signer une réponse = un UPDATE de couriers qui pose metadata.signed_at /
-- signed_by / signed_state_id (+ le corps HTML avec le bloc signature). Jusqu'ici
-- seul is_editor_of gardait cette écriture : N'IMPORTE QUEL éditeur pouvait
-- signer/dé-signer par appel Supabase direct, alors que l'UI (ReplyComposer)
-- réserve l'acte aux utilisateurs liés comme signataires de l'organisation
-- gestionnaire (socle_organization_signatories → signatories.user_id).
--
-- Ce trigger reflète la règle UI côté serveur :
--   changement d'un marqueur de signature → l'acteur doit être un signataire
--   lié à l'organisation gestionnaire de la réponse (fail-closed si la réponse
--   n'a pas d'organisation). La simple sélection du signataire
--   (metadata.signatory_id) reste libre : le secrétariat prépare, le
--   signataire signe. Dé-signer suit la même règle.
--
-- Bypass : service_role (edge/cron, claim JWT) et migrations (GUC), via le
-- helper is_transition_guard_bypassed() — mêmes signaux que le garde de
-- transitions (20260723101849). Pas de passe-droit superadmin humain (même
-- décision que pour les transitions : agir via l'UI comme tout agent).
-- Idempotent.

CREATE OR REPLACE FUNCTION public.couriers_enforce_signature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_signed_at text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'signed_at' END;
  v_old_signed_by text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'signed_by' END;
  v_old_signed_state text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'signed_state_id' END;
BEGIN
  -- Bypass service_role / migrations (mêmes signaux que le garde de transitions)
  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;

  -- Aucun marqueur de signature ne change → rien à contrôler (corps du brouillon,
  -- tags, transfert d'organisation, sélection du signataire… passent librement).
  IF (NEW.metadata->>'signed_at') IS NOT DISTINCT FROM v_old_signed_at
     AND (NEW.metadata->>'signed_by') IS NOT DISTINCT FROM v_old_signed_by
     AND (NEW.metadata->>'signed_state_id') IS NOT DISTINCT FROM v_old_signed_state THEN
    RETURN NEW;
  END IF;

  -- L'acteur doit être un signataire lié à l'organisation gestionnaire de la
  -- réponse. NEW.socle_organization_id NULL → aucun lien possible → refus
  -- (fail-closed, cohérent avec l'UI qui exige une organisation pour rédiger).
  IF NOT EXISTS (
    SELECT 1
    FROM public.signatories s
    JOIN public.socle_organization_signatories sos ON sos.signatory_id = s.id
    WHERE s.user_id = (select auth.uid())
      AND s.organization_id = NEW.organization_id
      AND sos.socle_organization_id = NEW.socle_organization_id
  ) THEN
    RAISE EXCEPTION 'Signature interdite : l''utilisateur n''est pas signataire de l''organisation gestionnaire'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.couriers_enforce_signature() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_enforce_signature ON public.couriers;
CREATE TRIGGER trg_couriers_enforce_signature
  BEFORE INSERT OR UPDATE OF metadata ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_signature();
