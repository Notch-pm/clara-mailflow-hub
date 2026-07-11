-- Référentiel Socle : les démarches ne sont plus paramétrées dans Clara mais
-- synchronisées chaque nuit depuis l'API centrale Socle (lecture seule).
-- Cette migration prépare le stockage miroir : mapping des organisations,
-- catégories, types de documents, colonnes Socle sur procedures, journal de sync.

-- ─── Mapping org Clara ↔ org Socle ─────────────────────────────────────────────
-- Renseigné manuellement (superadmin). Une org sans socle_org_id est ignorée par la sync.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS socle_org_id uuid;

COMMENT ON COLUMN public.organizations.socle_org_id IS
  'UUID de l''organisation Socle correspondante. NULL = pas de sync Socle pour cette org.';

-- ─── Table socle_categories (miroir, dupliquée par org Clara) ──────────────────
CREATE TABLE public.socle_categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_id         uuid NOT NULL,
  name             varchar NOT NULL,
  icon             text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  obsoleted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, socle_id)
);

CREATE INDEX idx_socle_categories_org ON public.socle_categories(organization_id);

ALTER TABLE public.socle_categories ENABLE ROW LEVEL SECURITY;

-- Lecture seule côté client : aucune policy d'écriture utilisateur,
-- seule l'edge function (service_role) écrit.
CREATE POLICY auth_select ON public.socle_categories FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

CREATE POLICY service_role_full ON public.socle_categories FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER socle_categories_set_updated_at
  BEFORE UPDATE ON public.socle_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Table socle_document_types (miroir, dupliquée par org Clara) ──────────────
CREATE TABLE public.socle_document_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  socle_id         uuid NOT NULL,
  name             varchar NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  obsoleted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, socle_id)
);

CREATE INDEX idx_socle_document_types_org ON public.socle_document_types(organization_id);

ALTER TABLE public.socle_document_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.socle_document_types FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

CREATE POLICY service_role_full ON public.socle_document_types FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER socle_document_types_set_updated_at
  BEFORE UPDATE ON public.socle_document_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Table socle_sync_runs (journal des synchronisations) ──────────────────────
CREATE TABLE public.socle_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running', -- running | success | error
  dry_run          boolean NOT NULL DEFAULT false,
  counters         jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_socle_sync_runs_org_started
  ON public.socle_sync_runs(organization_id, started_at DESC);

ALTER TABLE public.socle_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.socle_sync_runs FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

CREATE POLICY service_role_full ON public.socle_sync_runs FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Colonnes Socle sur procedures ──────────────────────────────────────────────
-- Les blocs JSON (requester_config, form_schema, knowledge_base, translations)
-- sont stockés TELS QUELS ; ils référencent des UUID Socle (documentTypeId,
-- documents {path,name}) qui ne doivent pas être réécrits.
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS socle_id uuid,
  ADD COLUMN IF NOT EXISTS type varchar,
  ADD COLUMN IF NOT EXISTS keywords jsonb,
  ADD COLUMN IF NOT EXISTS user_description text,
  ADD COLUMN IF NOT EXISTS agent_description text,
  ADD COLUMN IF NOT EXISTS input_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS socle_category_id uuid,
  ADD COLUMN IF NOT EXISTS requester_config jsonb,
  ADD COLUMN IF NOT EXISTS form_schema jsonb,
  ADD COLUMN IF NOT EXISTS knowledge_base jsonb,
  ADD COLUMN IF NOT EXISTS translations jsonb,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS obsoleted_at timestamptz;

COMMENT ON COLUMN public.procedures.socle_id IS
  'UUID de la démarche dans le Socle. Clé d''idempotence de la sync nocturne.';
COMMENT ON COLUMN public.procedures.socle_category_id IS
  'UUID Socle de la catégorie (jointure logique via socle_categories.socle_id, sans FK).';
COMMENT ON COLUMN public.procedures.obsoleted_at IS
  'Soft-delete : renseigné quand la démarche a disparu du Socle ou qu''un embryon local a été remplacé.';

-- Clé d'idempotence de l'upsert Socle
CREATE UNIQUE INDEX procedures_socle_unique
  ON public.procedures (organization_id, socle_id)
  WHERE socle_id IS NOT NULL;

-- ─── RLS procedures : plus de création/suppression côté Clara ──────────────────
-- Le Socle est la source de vérité. Seul le toggle is_displayed reste éditable
-- par les admins (admin_update conservé) ; la sync nocturne réécrase les champs Socle.
DROP POLICY IF EXISTS admin_insert ON public.procedures;
DROP POLICY IF EXISTS admin_delete ON public.procedures;
