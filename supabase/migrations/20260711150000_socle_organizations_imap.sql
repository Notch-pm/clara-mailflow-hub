-- Phase 2 Socle : import de la hiérarchie d'organisations (org principale +
-- sous-organisations) et rattachement des boîtes IMAP / courriers à une
-- (sous-)organisation. Miroir lecture seule, sync nocturne (sync-socle-referentiel).

-- ─── Table socle_organizations (miroir hiérarchique, dupliqué par tenant Clara) ──
-- Chaque tenant Clara ne mirrore que le sous-arbre de son socle_org_id (racine incluse).
CREATE TABLE public.socle_organizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_id         uuid NOT NULL,
  -- Référence logique socle→socle (comme procedures.socle_category_id) : pas de FK,
  -- le parent est résolu via (organization_id, socle_parent_id = socle_id).
  socle_parent_id  uuid,
  name             varchar NOT NULL,
  slug             varchar,
  type             varchar,
  status           varchar NOT NULL DEFAULT 'active', -- statut Socle : active | obsolete
  phone            text,
  email            text,
  address          text,
  logo_url         text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  obsoleted_at     timestamptz, -- disparue du périmètre Socle (distinct du status)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, socle_id)
);

CREATE INDEX idx_socle_organizations_org ON public.socle_organizations(organization_id);

ALTER TABLE public.socle_organizations ENABLE ROW LEVEL SECURITY;

-- Lecture seule côté client : seule l'edge function (service_role) écrit.
CREATE POLICY auth_select ON public.socle_organizations FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

CREATE POLICY service_role_full ON public.socle_organizations FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER socle_organizations_set_updated_at
  BEFORE UPDATE ON public.socle_organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Boîte IMAP rattachée à une (sous-)organisation ─────────────────────────────
ALTER TABLE public.imap_settings
  ADD COLUMN IF NOT EXISTS socle_organization_id uuid REFERENCES public.socle_organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.imap_settings.socle_organization_id IS
  'Organisation (miroir Socle) à laquelle appartient cette boîte. Reportée sur les courriers entrants.';

-- ─── Courrier rattaché à une (sous-)organisation ─────────────────────────────────
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS socle_organization_id uuid REFERENCES public.socle_organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_couriers_socle_organization
  ON public.couriers (organization_id, socle_organization_id)
  WHERE socle_organization_id IS NOT NULL;

COMMENT ON COLUMN public.couriers.socle_organization_id IS
  'Organisation (miroir Socle) d''origine du courrier — renseignée à la réception via la boîte IMAP.';
