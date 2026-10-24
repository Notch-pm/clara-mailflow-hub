-- Parapheur : quand une réponse (ou un sortant) entre dans une étape de
-- signature sans signataire désigné, et que son organisation n'a qu'UN
-- signataire, celui-ci est désigné d'office (décision PO du 2026-10-24).
--
-- Avant : le brouillon d'un non-signataire naissait sans `signatory_id` ; avec
-- un seul signataire dans l'organisation, aucun choix n'était proposé et la
-- réponse n'entrait jamais dans « À signer » (file filtrée sur
-- `metadata.signatory_id`). Posé côté serveur, à l'entrée dans l'étape : cela
-- couvre réponses et sortants, et les brouillons déjà en cours. Une désignation
-- existante n'est jamais remplacée ; à plusieurs signataires, on laisse le
-- choix à l'agent.

CREATE OR REPLACE FUNCTION public.couriers_default_signatory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NEW.direction <> 'outbound'
     OR NEW.workflow_state_id IS NULL
     OR NEW.socle_organization_id IS NULL
     OR COALESCE(NEW.metadata ->> 'signatory_id', '') <> ''
     OR NOT EXISTS (SELECT 1 FROM public.workflow_states ws
                    WHERE ws.id = NEW.workflow_state_id AND ws.requires_signature) THEN
    RETURN NEW;
  END IF;

  -- Signataires rattachés à l'organisation, dont le compte est encore un
  -- signataire actif du tenant.
  SELECT array_agg(DISTINCT sos.signatory_id) INTO v_ids
  FROM public.socle_organization_signatories sos
  JOIN public.signatories s ON s.id = sos.signatory_id
  JOIN public.organization_users ou
    ON ou.user_id = s.user_id AND ou.organization_id = NEW.organization_id
  WHERE sos.socle_organization_id = NEW.socle_organization_id
    AND sos.organization_id = NEW.organization_id
    AND ou.is_active AND ou.is_signataire;

  IF array_length(v_ids, 1) = 1 THEN
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('signatory_id', v_ids[1]);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.couriers_default_signatory() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_default_signatory ON public.couriers;
CREATE TRIGGER trg_couriers_default_signatory
  BEFORE INSERT OR UPDATE OF workflow_state_id, socle_organization_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_default_signatory();
