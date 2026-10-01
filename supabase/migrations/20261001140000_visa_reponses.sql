-- VISA des réponses : « j'ai vu, je valide ».
--
-- Une étape de workflow réponse peut être marquée « étape de visa »
-- (workflow_states.requires_visa, exclusif de la signature et de l'envoi ;
-- plusieurs étapes de visa possibles dans un même workflow). Tant qu'un viseur
-- de l'organisation gestionnaire n'a pas visé, la réponse ne quitte pas l'étape
-- vers l'avant. Le viseur DÉSIGNÉ se choisit sur la réponse
-- (metadata.visa_viseurs[state_id]) mais n'a pas l'exclusivité : tout viseur lié
-- à l'organisation gestionnaire peut viser à sa place (tracé).
--
-- Trace immuable : courier_visas (aucune policy UPDATE/DELETE). Au retour dans
-- une étape de visa, les visas antérieurs de cette étape sont périmés
-- (superseded_at) : le visa est à refaire, l'ancien reste visible.
--
-- Bypass : service_role / migrations via is_transition_guard_bypassed(), comme
-- les gardes de transition (20260723101849) et de signature (20260723163536).
-- Idempotent.

-- ─── 1. Attribut viseur (transverse, indépendant du rôle) ────────────────────────
ALTER TABLE public.organization_users
  ADD COLUMN IF NOT EXISTS is_viseur boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_users.is_viseur IS
  'Droit de viser une réponse (indépendant du rôle). Le visa effectif exige en plus le rattachement à l''organisation gestionnaire (socle_organization_viseurs).';

-- ─── 2. Viseurs d'une organisation ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.socle_organization_viseurs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_organization_id  uuid NOT NULL REFERENCES public.socle_organizations(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (socle_organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_socle_org_viseurs_org ON public.socle_organization_viseurs(organization_id);
CREATE INDEX IF NOT EXISTS idx_socle_org_viseurs_user ON public.socle_organization_viseurs(user_id);

ALTER TABLE public.socle_organization_viseurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select ON public.socle_organization_viseurs;
DROP POLICY IF EXISTS admin_insert ON public.socle_organization_viseurs;
DROP POLICY IF EXISTS admin_delete ON public.socle_organization_viseurs;
DROP POLICY IF EXISTS service_role_full ON public.socle_organization_viseurs;
CREATE POLICY auth_select ON public.socle_organization_viseurs FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY admin_insert ON public.socle_organization_viseurs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.socle_organization_viseurs FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY service_role_full ON public.socle_organization_viseurs FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 3. Étape de visa ────────────────────────────────────────────────────────────
ALTER TABLE public.workflow_states
  ADD COLUMN IF NOT EXISTS requires_visa boolean NOT NULL DEFAULT false;

ALTER TABLE public.workflow_states
  DROP CONSTRAINT IF EXISTS workflow_states_visa_exclusive;
ALTER TABLE public.workflow_states
  ADD CONSTRAINT workflow_states_visa_exclusive
  CHECK (NOT (requires_visa AND (COALESCE(requires_signature, false) OR COALESCE(is_send, false))));

-- ─── 4. Trace des visas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.courier_visas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id          uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  workflow_state_id   uuid REFERENCES public.workflow_states(id) ON DELETE SET NULL,
  state_name          text NOT NULL DEFAULT '',
  user_id             uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id),
  designated_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  comment             text,
  visa_at             timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_courier_visas_courier ON public.courier_visas(courier_id);
CREATE INDEX IF NOT EXISTS idx_courier_visas_active
  ON public.courier_visas(courier_id, workflow_state_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courier_visas_org ON public.courier_visas(organization_id);

ALTER TABLE public.courier_visas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select ON public.courier_visas;
DROP POLICY IF EXISTS viseur_insert ON public.courier_visas;
DROP POLICY IF EXISTS service_role_full ON public.courier_visas;
CREATE POLICY auth_select ON public.courier_visas FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
-- Viser fait avancer la réponse : réservé, comme signer, à qui peut y écrire.
CREATE POLICY viseur_insert ON public.courier_visas FOR INSERT TO authenticated
  WITH CHECK (public.is_editor_of(organization_id) AND user_id = (select auth.uid()));
CREATE POLICY service_role_full ON public.courier_visas FOR ALL
  USING (auth.role() = 'service_role');

-- Validation d'un visa : la réponse est ACTUELLEMENT dans l'étape visée, cette
-- étape est une étape de visa, l'acteur est viseur de l'organisation
-- gestionnaire (fail-closed si la réponse n'a pas d'organisation), et l'étape
-- n'est pas déjà visée. Fige le nom de l'étape et le viseur désigné.
CREATE OR REPLACE FUNCTION public.courier_visas_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_courier record;
  v_state record;
  v_designated text;
BEGIN
  SELECT c.organization_id, c.workflow_state_id, c.socle_organization_id, c.metadata
    INTO v_courier
  FROM public.couriers c WHERE c.id = NEW.courier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visa interdit : réponse introuvable' USING ERRCODE = 'check_violation';
  END IF;

  NEW.organization_id := v_courier.organization_id;
  NEW.superseded_at := NULL;

  SELECT ws.name, ws.requires_visa INTO v_state
  FROM public.workflow_states ws WHERE ws.id = NEW.workflow_state_id;
  NEW.state_name := COALESCE(v_state.name, NEW.state_name, '');

  v_designated := v_courier.metadata #>> ARRAY['visa_viseurs', NEW.workflow_state_id::text];
  NEW.designated_user_id := CASE
    WHEN v_designated ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN v_designated::uuid
  END;

  IF public.is_transition_guard_bypassed() THEN
    RETURN NEW;
  END IF;

  NEW.visa_at := now();

  IF v_courier.workflow_state_id IS DISTINCT FROM NEW.workflow_state_id THEN
    RAISE EXCEPTION 'Visa interdit : la réponse n''est pas dans cette étape'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT COALESCE(v_state.requires_visa, false) THEN
    RAISE EXCEPTION 'Visa interdit : cette étape n''est pas une étape de visa'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.socle_organization_viseurs v
    JOIN public.organization_users ou
      ON ou.user_id = v.user_id AND ou.organization_id = v.organization_id
    WHERE v.user_id = (select auth.uid())
      AND v.organization_id = v_courier.organization_id
      AND v.socle_organization_id = v_courier.socle_organization_id
      AND ou.is_viseur
      AND COALESCE(ou.is_active, true)
  ) THEN
    RAISE EXCEPTION 'Visa interdit : l''utilisateur n''est pas viseur de l''organisation gestionnaire'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.courier_visas cv
    WHERE cv.courier_id = NEW.courier_id
      AND cv.workflow_state_id = NEW.workflow_state_id
      AND cv.superseded_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Visa interdit : cette étape est déjà visée'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.courier_visas_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_courier_visas_validate ON public.courier_visas;
CREATE TRIGGER trg_courier_visas_validate
  BEFORE INSERT ON public.courier_visas
  FOR EACH ROW EXECUTE FUNCTION public.courier_visas_validate();

-- ─── 5. Garde : on ne quitte pas une étape de visa vers l'avant sans visa ───────
-- Sorties libres : retour (transition kind='previous', ou vers l'état initial),
-- abandon (état final hors catégorie 'processed' — envoyer sans visa reste
-- interdit), réassignation d'organisation, désassignation.
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

DROP TRIGGER IF EXISTS trg_couriers_enforce_visa ON public.couriers;
CREATE TRIGGER trg_couriers_enforce_visa
  BEFORE UPDATE OF workflow_state_id, socle_organization_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_enforce_visa();

-- ─── 6. Péremption : entrer dans une étape de visa exige un visa neuf ───────────
CREATE OR REPLACE FUNCTION public.couriers_supersede_visas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.workflow_state_id IS NOT NULL
     AND NEW.workflow_state_id IS DISTINCT FROM OLD.workflow_state_id THEN
    UPDATE public.courier_visas
       SET superseded_at = now()
     WHERE courier_id = NEW.id
       AND workflow_state_id = NEW.workflow_state_id
       AND superseded_at IS NULL;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.couriers_supersede_visas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_couriers_supersede_visas ON public.couriers;
CREATE TRIGGER trg_couriers_supersede_visas
  AFTER UPDATE OF workflow_state_id ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_supersede_visas();
