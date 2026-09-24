-- Ni action liée ni réponse sur un courrier non orienté ou encore dans la boîte
-- aux lettres (2026-09-24).
--
-- Règle : un courrier n'accepte une action (`action_tickets`) ou une réponse
-- (`couriers` sortant avec `parent_courier_id`) que s'il a une organisation
-- gestionnaire (`socle_organization_id`) ET un état de workflow qui n'est pas
-- initial. L'écran grise les boutons ; ce trigger tient la règle pour TOUT
-- appelant — appel PostgREST direct, et edge functions en service_role
-- (`create-arpege-demande` crée ses actions ainsi) : contrairement à
-- `couriers_enforce_transition`, le service_role n'est PAS dispensé.
--
-- Seul échappatoire : le GUC de session `clara.bypass_transition_guard` (reprise
-- de données, démo), le même que celui des autres garde-fous des courriers.
--
-- Messages IDENTIQUES à `supabase/functions/_shared/courierCreationGuard.ts`.
-- INSERT seulement : les actions et réponses déjà créées restent intactes
-- (4 actions et 3 réponses de production sont sur un courrier qui serait refusé
-- aujourd'hui) et demeurent modifiables.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.courier_creation_block_reason(p_courier_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT CASE
    WHEN c.id IS NULL THEN NULL  -- la clé étrangère refusera d'elle-même
    WHEN c.socle_organization_id IS NULL THEN
      'Ce courrier n''a pas d''organisation gestionnaire : désignez-la avant de créer une action ou une réponse.'
    -- `is_initial` NULL compte comme « pas initial », comme la boîte aux
    -- lettres (filtre `is_initial = true`) ; un état introuvable, comme aucun.
    WHEN c.workflow_state_id IS NULL OR ws.id IS NULL OR ws.is_initial IS TRUE THEN
      'Ce courrier est encore dans la boîte aux lettres : faites-le avancer dans son workflow avant de créer une action ou une réponse.'
  END
  FROM (SELECT p_courier_id AS id) k
  LEFT JOIN public.couriers c ON c.id = k.id
  LEFT JOIN public.workflow_states ws ON ws.id = c.workflow_state_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.courier_creation_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_creation_block_reason(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_courier_creation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_parent uuid;
  v_reason text;
BEGIN
  IF COALESCE(current_setting('clara.bypass_transition_guard', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'action_tickets' THEN
    v_parent := NEW.courier_id;
  ELSIF NEW.parent_courier_id IS NOT NULL AND NEW.direction = 'outbound' THEN
    v_parent := NEW.parent_courier_id;
  ELSE
    RETURN NEW;
  END IF;

  v_reason := public.courier_creation_block_reason(v_parent);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_courier_creation_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_action_tickets_creation_guard ON public.action_tickets;
CREATE TRIGGER trg_action_tickets_creation_guard
  BEFORE INSERT ON public.action_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_courier_creation_guard();

DROP TRIGGER IF EXISTS trg_couriers_reply_creation_guard ON public.couriers;
CREATE TRIGGER trg_couriers_reply_creation_guard
  BEFORE INSERT ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_courier_creation_guard();
