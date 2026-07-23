-- Garde serveur de validation des transitions de workflow.
--
-- Aujourd'hui la transition d'état est un simple UPDATE de couriers.workflow_state_id,
-- gardé par la seule RLS is_editor_of (« peut écrire »), jamais par la topologie du
-- workflow. Un éditeur en appel Supabase direct peut donc sauter à n'importe quel état
-- (autre workflow, autre tenant, franchir des étapes). Ce trigger BEFORE valide la
-- transition côté serveur, sous la RLS, pour TOUT writer.
--
-- Spec complète : docs/garde-transitions-workflow.md.
-- Idempotent (CREATE OR REPLACE / DROP … IF EXISTS). DB live = source de vérité.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Bypass : service_role (edge functions / cron via claim JWT) et migrations
--    (via GUC de session). Un JWT authentifié — même superadmin — ne peut usurper
--    ni le claim (posé par PostgREST depuis le JWT vérifié) ni le GUC (aucune
--    surface SET exposée par l'API).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_transition_guard_bypassed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT
    COALESCE(
      (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'role',
      ''
    ) = 'service_role'
    OR COALESCE(current_setting('clara.bypass_transition_guard', true), '') = 'on';
$function$;

REVOKE EXECUTE ON FUNCTION public.is_transition_guard_bypassed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_transition_guard_bypassed() TO authenticated, service_role;

-- Index couvrant le test d'existence d'une transition légale (O(1) par ligne).
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_to
  ON public.workflow_transitions (workflow_id, from_state_id, to_state_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fonction trigger — matrice de validation (cf. docs/garde-transitions-workflow.md §3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.couriers_enforce_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_state uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.workflow_state_id ELSE NULL END;
  v_old_socle uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.socle_organization_id ELSE NULL END;
  v_new_state uuid := NEW.workflow_state_id;
  v_wstar uuid;             -- workflow de référence
  v_new_wf uuid;
  v_new_org uuid;
  v_new_is_initial boolean;
  v_new_is_final boolean;
  v_old_wf uuid;
  v_old_in_wstar boolean;
  v_org_changed boolean := NEW.socle_organization_id IS DISTINCT FROM v_old_socle;
BEGIN
  -- 0. Bypass service_role / migrations
  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;

  -- 1. Désassignation : retirer l'état est toujours sûr (couvre NULL -> NULL)
  IF v_new_state IS NULL THEN
    RETURN NEW;
  END IF;

  -- Métadonnées de l'état cible
  SELECT ws.workflow_id, ws.organization_id, COALESCE(ws.is_initial, false), COALESCE(ws.is_final, false)
    INTO v_new_wf, v_new_org, v_new_is_initial, v_new_is_final
  FROM public.workflow_states ws
  WHERE ws.id = v_new_state;

  -- État inexistant : laisser la FK couriers_workflow_state_id_fkey trancher
  IF v_new_wf IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Garde tenant : l'état cible doit appartenir à l'organisation du courrier
  IF v_new_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Transition interdite : état hors du tenant du courrier'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Résolution du workflow de référence W*
  IF NEW.socle_organization_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.direction = 'outbound' THEN so.reply_workflow_id ELSE so.workflow_id END
      INTO v_wstar
    FROM public.socle_organizations so
    WHERE so.id = NEW.socle_organization_id;
  END IF;
  IF v_wstar IS NULL THEN
    IF v_old_state IS NOT NULL THEN
      SELECT ws.workflow_id INTO v_wstar FROM public.workflow_states ws WHERE ws.id = v_old_state;
    END IF;
    IF v_wstar IS NULL THEN
      v_wstar := v_new_wf;  -- amorçage d'un courrier sans organisation gestionnaire
    END IF;
  END IF;

  -- 3. Cœur : l'état cible doit appartenir au workflow de référence
  IF v_new_wf IS DISTINCT FROM v_wstar THEN
    RAISE EXCEPTION 'Transition interdite : état hors du workflow du courrier'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 4. No-op (même état) — placé après le contrôle W* pour bloquer un état devenu
  --    étranger via un simple changement d'organisation.
  IF v_old_state = v_new_state THEN
    RETURN NEW;
  END IF;

  -- 5. Clôture : tout état final est un puits terminal légitime (clôture / cascade).
  IF v_new_is_final THEN
    RETURN NEW;
  END IF;

  -- Appartenance de l'ancien état à W*
  IF v_old_state IS NOT NULL THEN
    SELECT ws.workflow_id INTO v_old_wf FROM public.workflow_states ws WHERE ws.id = v_old_state;
  END IF;
  v_old_in_wstar := (v_old_wf IS NOT NULL AND v_old_wf = v_wstar);

  -- 6. Reset / amorçage à l'état initial :
  --    - lors d'une réassignation d'organisation (org changée), OU
  --    - quand l'ancien état n'appartient pas à W* (création, état obsolète).
  IF v_new_is_initial AND (v_org_changed OR NOT v_old_in_wstar) THEN
    RETURN NEW;
  END IF;

  -- 7. Successeur légal : une transition (OLD -> NEW) configurée dans W* (kind-agnostique,
  --    donc les retours arrière kind='previous' sont autorisés).
  IF v_old_in_wstar AND EXISTS (
    SELECT 1 FROM public.workflow_transitions wt
    WHERE wt.workflow_id = v_wstar
      AND wt.from_state_id = v_old_state
      AND wt.to_state_id = v_new_state
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transition interdite : aucune transition définie de l''état courant vers l''état cible'
    USING ERRCODE = 'check_violation';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.couriers_enforce_transition() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger : ne fire que sur changement d'état ou d'organisation gestionnaire.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_couriers_enforce_transition ON public.couriers;
CREATE TRIGGER trg_couriers_enforce_transition
  BEFORE INSERT OR UPDATE OF workflow_state_id, socle_organization_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_transition();
