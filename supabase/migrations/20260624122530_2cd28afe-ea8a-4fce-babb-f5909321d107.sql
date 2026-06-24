
-- Enum for relation type
DO $$ BEGIN
  CREATE TYPE public.courier_relation_type AS ENUM ('relance', 'sujet_lie');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.courier_relation_origin AS ENUM ('manual', 'ai_suggestion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table: courier_relations
CREATE TABLE IF NOT EXISTS public.courier_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  target_courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  relation_type public.courier_relation_type NOT NULL,
  note text,
  created_via public.courier_relation_origin NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_relations_distinct CHECK (source_courier_id <> target_courier_id),
  CONSTRAINT courier_relations_unique UNIQUE (source_courier_id, target_courier_id, relation_type)
);

CREATE INDEX IF NOT EXISTS courier_relations_source_idx ON public.courier_relations(source_courier_id);
CREATE INDEX IF NOT EXISTS courier_relations_target_idx ON public.courier_relations(target_courier_id);
CREATE INDEX IF NOT EXISTS courier_relations_org_idx ON public.courier_relations(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_relations TO authenticated;
GRANT ALL ON public.courier_relations TO service_role;

ALTER TABLE public.courier_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read org relations"
  ON public.courier_relations FOR SELECT
  TO authenticated
  USING (
    organization_id = COALESCE(
      NULLIF(current_setting('request.headers', true)::jsonb ->> 'x-org-id', '')::uuid,
      organization_id
    )
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.organization_id = courier_relations.organization_id
        AND ou.user_id = auth.uid()
        AND ou.is_active = true
    )
  );

CREATE POLICY "Members can insert org relations"
  ON public.courier_relations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.organization_id = courier_relations.organization_id
        AND ou.user_id = auth.uid()
        AND ou.is_active = true
    )
  );

CREATE POLICY "Members can delete org relations"
  ON public.courier_relations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.organization_id = courier_relations.organization_id
        AND ou.user_id = auth.uid()
        AND ou.is_active = true
    )
  );

-- Add suggestion storage columns on couriers
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS ai_suggested_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_link_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb;
