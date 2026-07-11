-- Phase 3 Socle : les (sous-)organisations remplacent les services comme unités
-- de traitement. Chaque org du miroir porte : workflows (reçu + réponse), membres,
-- signataires ; la boîte IMAP est déjà rattachée (imap_settings.socle_organization_id).
-- Les tables services/service_members/service_signatories sont GELÉES (données
-- conservées, plus utilisées par les nouveaux flux).

-- ─── Config Clara sur le miroir ──────────────────────────────────────────────────
-- Ces colonnes appartiennent à Clara : la sync nocturne ne les touche jamais
-- (mapSocleOrganization écrit une liste fixe de colonnes Socle).
ALTER TABLE public.socle_organizations
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_workflow_id uuid REFERENCES public.workflows(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.socle_organizations.workflow_id IS
  'Workflow des courriers reçus par cette organisation (config Clara, non synchronisée).';
COMMENT ON COLUMN public.socle_organizations.reply_workflow_id IS
  'Workflow des réponses de cette organisation (config Clara, non synchronisée).';

-- Les admins peuvent éditer la config Clara (les champs Socle sont réécrasés chaque nuit).
DROP POLICY IF EXISTS admin_update ON public.socle_organizations;
CREATE POLICY admin_update ON public.socle_organizations FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ─── Membres d'une organisation ──────────────────────────────────────────────────
CREATE TABLE public.socle_organization_members (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_organization_id  uuid NOT NULL REFERENCES public.socle_organizations(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (socle_organization_id, user_id)
);

CREATE INDEX idx_socle_org_members_socle_org ON public.socle_organization_members(socle_organization_id);
CREATE INDEX idx_socle_org_members_user ON public.socle_organization_members(user_id);
CREATE INDEX idx_socle_org_members_org ON public.socle_organization_members(organization_id);

ALTER TABLE public.socle_organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.socle_organization_members FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY admin_insert ON public.socle_organization_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.socle_organization_members FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY service_role_full ON public.socle_organization_members FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Signataires d'une organisation ──────────────────────────────────────────────
CREATE TABLE public.socle_organization_signatories (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_organization_id  uuid NOT NULL REFERENCES public.socle_organizations(id) ON DELETE CASCADE,
  signatory_id           uuid NOT NULL REFERENCES public.signatories(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (socle_organization_id, signatory_id)
);

CREATE INDEX idx_socle_org_signatories_socle_org ON public.socle_organization_signatories(socle_organization_id);
CREATE INDEX idx_socle_org_signatories_org ON public.socle_organization_signatories(organization_id);

ALTER TABLE public.socle_organization_signatories ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.socle_organization_signatories FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY admin_insert ON public.socle_organization_signatories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.socle_organization_signatories FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY service_role_full ON public.socle_organization_signatories FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Formulaires portail : cible organisation (service_id devient legacy) ────────
ALTER TABLE public.portal_forms
  ADD COLUMN IF NOT EXISTS socle_organization_id uuid REFERENCES public.socle_organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.portal_forms.socle_organization_id IS
  'Organisation cible des soumissions (remplace service_id, conservé en legacy).';
