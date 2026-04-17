-- 1. Enum catégorie usager
DO $$ BEGIN
  CREATE TYPE public.usager_category AS ENUM ('citoyen', 'entreprise', 'association');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.usager_civilite AS ENUM ('madame', 'monsieur');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Table usagers
CREATE TABLE IF NOT EXISTS public.usagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  category public.usager_category NOT NULL DEFAULT 'citoyen',
  civilite public.usager_civilite,
  first_name varchar(200),
  last_name varchar(200),
  email varchar(255),
  phone varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- Indexes pour matching
CREATE INDEX IF NOT EXISTS idx_usagers_org_email ON public.usagers (organization_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usagers_org_phone ON public.usagers (organization_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usagers_org ON public.usagers (organization_id);

-- 3. RLS multi-tenant (même pattern que les autres tables)
ALTER TABLE public.usagers ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.usagers FOR SELECT TO authenticated
  USING (organization_id = (((current_setting('request.headers'::text, true))::json ->> 'x-org-id'::text))::uuid);

CREATE POLICY auth_insert ON public.usagers FOR INSERT TO authenticated
  WITH CHECK (organization_id = (((current_setting('request.headers'::text, true))::json ->> 'x-org-id'::text))::uuid);

CREATE POLICY auth_update ON public.usagers FOR UPDATE TO authenticated
  USING (organization_id = (((current_setting('request.headers'::text, true))::json ->> 'x-org-id'::text))::uuid)
  WITH CHECK (organization_id = (((current_setting('request.headers'::text, true))::json ->> 'x-org-id'::text))::uuid);

CREATE POLICY auth_delete ON public.usagers FOR DELETE TO authenticated
  USING (organization_id = (((current_setting('request.headers'::text, true))::json ->> 'x-org-id'::text))::uuid);

CREATE POLICY service_role_full ON public.usagers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Trigger updated_at
CREATE TRIGGER usagers_set_updated_at
  BEFORE UPDATE ON public.usagers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Ajouter colonnes manquantes à courier_participants
ALTER TABLE public.courier_participants
  ADD COLUMN IF NOT EXISTS usager_id uuid,
  ADD COLUMN IF NOT EXISTS first_name varchar(200),
  ADD COLUMN IF NOT EXISTS last_name varchar(200),
  ADD COLUMN IF NOT EXISTS phone varchar(50);

CREATE INDEX IF NOT EXISTS idx_courier_participants_usager ON public.courier_participants (usager_id);

-- 6. Migration : dédoublonner les participants existants en usagers
-- Stratégie : un usager par (org, email lower) si email présent, sinon un usager par (org, phone, name) si phone présent, sinon un par participant.
WITH participants_normalized AS (
  SELECT
    cp.id,
    cp.organization_id,
    cp.name,
    cp.email,
    NULL::text AS phone, -- pas de téléphone existant en base
    lower(NULLIF(trim(cp.email), '')) AS email_norm
  FROM public.courier_participants cp
),
-- Un usager unique par (org, email_norm)
distinct_usagers AS (
  SELECT DISTINCT ON (organization_id, COALESCE(email_norm, 'no-email::' || id::text))
    organization_id,
    email_norm,
    name,
    email,
    id AS first_participant_id
  FROM participants_normalized
  ORDER BY organization_id, COALESCE(email_norm, 'no-email::' || id::text), id
),
inserted AS (
  INSERT INTO public.usagers (organization_id, category, last_name, first_name, email)
  SELECT
    organization_id,
    'citoyen'::public.usager_category,
    -- on stocke le nom complet dans last_name par défaut, l'utilisateur scindera ensuite
    NULLIF(trim(name), ''),
    NULL,
    NULLIF(trim(email), '')
  FROM distinct_usagers
  RETURNING id, organization_id, lower(NULLIF(trim(email), '')) AS email_norm, last_name
)
-- Lier chaque participant à l'usager correspondant (par org + email_norm, ou par org + last_name si pas d'email)
UPDATE public.courier_participants cp
SET usager_id = u.id,
    last_name = COALESCE(cp.last_name, NULLIF(trim(cp.name), ''))
FROM public.usagers u
WHERE cp.organization_id = u.organization_id
  AND (
    (cp.email IS NOT NULL AND u.email IS NOT NULL AND lower(trim(cp.email)) = lower(trim(u.email)))
    OR (
      (cp.email IS NULL OR trim(cp.email) = '')
      AND (u.email IS NULL OR trim(u.email) = '')
      AND NULLIF(trim(cp.name), '') = u.last_name
    )
  )
  AND cp.usager_id IS NULL;