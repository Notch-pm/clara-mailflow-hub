-- Envois papiers réels, lot 1 (2026-11-06) : types d'envoi, interrupteur, traçabilité.
--
-- • Trois types d'envoi postal (`metadata.posted_mode`) : `simple` (lettre verte),
--   `suivi` (lettre suivie), `recommande` (recommandé avec accusé de réception).
--   La garde `couriers_enforce_outbound_initiative` accepte désormais `suivi`.
-- • `organizations.postal_sending_enabled` : un administrateur active l'envoi
--   réel par le prestataire (Merci Facteur, compte unique Notch). Écriture
--   réservée aux administrateurs par la policy `org_admin_update` (is_admin_of),
--   avec un grant UPDATE sur ces deux colonnes seulement.
--   `postal_daily_cap` plafonne le nombre d'envois prestataire par 24 h glissantes.
-- • `postal_sendings` : un envoi prestataire par ligne (statut, prix, événements
--   du webhook). L'index unique partiel sur les statuts actifs est la RÉSERVATION
--   anti-double envoi. Lecture par les membres ; écriture par le service role seul.
-- • `provider_tokens` : cache du jeton Merci Facteur (24 h), aucun accès client.
--
-- Messages IDENTIQUES à `supabase/functions/_shared/outboundInitiativeGuard.ts`.
-- Idempotent.

-- ─── Organisation : interrupteur et plafond ────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS postal_sending_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS postal_daily_cap integer NOT NULL DEFAULT 50;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_postal_daily_cap_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_postal_daily_cap_check CHECK (postal_daily_cap BETWEEN 0 AND 1000);
  END IF;
END $$;

-- Les droits d'écriture sur `organizations` sont colonne par colonne : sans ce
-- grant, la policy `org_admin_update` laisserait l'administrateur passer… sur
-- aucune colonne. La RLS (is_admin_of) reste la garde du « qui ».
GRANT UPDATE (postal_sending_enabled, postal_daily_cap) ON public.organizations TO authenticated;

COMMENT ON COLUMN public.organizations.postal_sending_enabled IS
  'Envois papiers réels : les agents peuvent faire imprimer et poster un courrier par le prestataire (Merci Facteur), facturé à l''envoi.';
COMMENT ON COLUMN public.organizations.postal_daily_cap IS
  'Nombre maximal d''envois par le prestataire sur 24 h glissantes (garde-fou contre une boucle).';

-- ─── Envois par le prestataire ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.postal_sendings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.courier_documents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'merci_facteur',
  mode text NOT NULL CHECK (mode IN ('simple', 'suivi', 'recommande')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'to_verify', 'failed')),
  provider_envoi_id text,
  price_ht numeric(10, 2),
  price_ttc numeric(10, 2),
  nb_pages integer,
  antidoublon text,
  error text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_event text,
  last_event_at timestamptz,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.postal_sendings IS
  'Envois papiers réels par le prestataire : un envoi par ligne. Écrite par les edge functions (service role) seulement.';

-- Réservation : un seul envoi actif (en cours, parti, ou à vérifier) par courrier.
CREATE UNIQUE INDEX IF NOT EXISTS postal_sendings_one_active_per_courier
  ON public.postal_sendings (courier_id) WHERE status IN ('pending', 'sent', 'to_verify');
CREATE INDEX IF NOT EXISTS postal_sendings_org_requested
  ON public.postal_sendings (organization_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS postal_sendings_provider_envoi
  ON public.postal_sendings (provider, provider_envoi_id) WHERE provider_envoi_id IS NOT NULL;

ALTER TABLE public.postal_sendings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS postal_sendings_select ON public.postal_sendings;
CREATE POLICY postal_sendings_select ON public.postal_sendings FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

REVOKE ALL ON public.postal_sendings FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.postal_sendings FROM authenticated;
GRANT SELECT ON public.postal_sendings TO authenticated;

DROP TRIGGER IF EXISTS trigger_set_updated_at ON public.postal_sendings;
CREATE TRIGGER trigger_set_updated_at BEFORE UPDATE ON public.postal_sendings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Cache des jetons de prestataires ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_tokens (
  provider text PRIMARY KEY,
  token text NOT NULL,
  expire_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_tokens ENABLE ROW LEVEL SECURITY;
-- Aucune policy : ni anon ni authenticated n'y accèdent ; le service role contourne la RLS.
REVOKE ALL ON public.provider_tokens FROM anon, authenticated;

-- ─── Garde : `suivi` devient un type d'envoi valide ────────────────────────
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
      IF (NEW.metadata ->> 'posted_mode') IS NULL
         OR (NEW.metadata ->> 'posted_mode') NOT IN ('simple', 'suivi', 'recommande') THEN
        RAISE EXCEPTION 'Précisez le type d''envoi : simple, suivie ou recommandé avec accusé de réception.'
          USING ERRCODE = 'P0001';
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
