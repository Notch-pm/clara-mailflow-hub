-- Visa : le renvoi « À corriger » est une sortie libre.
--
-- Constaté chez Seine Normandie Agglomération le 2026-10-01 : l'étape « Visa »
-- a une transition secondaire « A corriger » vers un état « A corriger »,
-- lequel repart vers « Visa » par sa transition nominale « Pour visa ». La
-- garde du 20261001140000 n'en savait rien — ni `previous`, ni état initial, ni
-- abandon — et la refusait comme une avance sans visa.
--
-- Nouvelle sortie libre : vers un état dont la suite NOMINALE (transitions
-- `kind = 'next'`) ramène à l'étape de visa quittée. La réponse repassera par
-- le visa : rien n'est contourné. La suite nominale seule, et non tout le
-- graphe : depuis « Signature », une transition secondaire vers « A corriger »
-- ramène aussi au visa, mais la suite nominale de la signature part vers
-- l'envoi — sortir du visa vers la signature reste une avance, refusée sans
-- visa. Miroir écran : `isFreeExitFromVisa` (src/lib/reply-visa.ts).
--
-- Rejouable : CREATE OR REPLACE, le trigger existant pointe déjà la fonction.
CREATE OR REPLACE FUNCTION public.couriers_enforce_visa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_new record;
BEGIN
  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;

  IF OLD.workflow_state_id IS NULL
     OR NEW.workflow_state_id IS NULL
     OR NEW.workflow_state_id = OLD.workflow_state_id
     OR NEW.socle_organization_id IS DISTINCT FROM OLD.socle_organization_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_states ws
    WHERE ws.id = OLD.workflow_state_id AND ws.requires_visa
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ws.is_initial, false) AS is_initial,
         COALESCE(ws.is_final, false) AS is_final,
         ws.category
    INTO v_new
  FROM public.workflow_states ws WHERE ws.id = NEW.workflow_state_id;

  IF v_new.is_initial
     OR (v_new.is_final AND v_new.category IS DISTINCT FROM 'processed') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workflow_transitions wt
    WHERE wt.from_state_id = OLD.workflow_state_id
      AND wt.to_state_id = NEW.workflow_state_id
      AND wt.kind = 'previous'
  ) THEN
    RETURN NEW;
  END IF;

  -- Renvoi pour correction : la suite nominale de l'état visé ramène au visa.
  -- UNION (et non UNION ALL) : un cycle de transitions `next` s'arrête de
  -- lui-même, chaque état n'étant visité qu'une fois.
  IF EXISTS (
    WITH RECURSIVE nominal(state_id) AS (
      SELECT NEW.workflow_state_id
      UNION
      SELECT wt.to_state_id
      FROM public.workflow_transitions wt
      JOIN nominal n ON wt.from_state_id = n.state_id
      WHERE wt.kind = 'next'
    )
    SELECT 1 FROM nominal WHERE state_id = OLD.workflow_state_id
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.courier_visas cv
    WHERE cv.courier_id = NEW.id
      AND cv.workflow_state_id = OLD.workflow_state_id
      AND cv.superseded_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Transition interdite : la réponse doit être visée avant de quitter cette étape'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.couriers_enforce_visa() FROM PUBLIC, anon, authenticated;
