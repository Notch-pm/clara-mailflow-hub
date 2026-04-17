-- Cache du texte OCR par document
CREATE TABLE public.courier_document_extracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE,
  courier_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  page_count INTEGER,
  model TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_courier_document_extracts_courier ON public.courier_document_extracts(courier_id);
CREATE INDEX idx_courier_document_extracts_org ON public.courier_document_extracts(organization_id);

ALTER TABLE public.courier_document_extracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.courier_document_extracts FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_insert ON public.courier_document_extracts FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_update ON public.courier_document_extracts FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_delete ON public.courier_document_extracts FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

CREATE TRIGGER set_updated_at_courier_document_extracts
  BEFORE UPDATE ON public.courier_document_extracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Analyse IA par courrier
CREATE TABLE public.courier_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id UUID NOT NULL UNIQUE,
  organization_id UUID NOT NULL,
  summary TEXT,
  intents JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment TEXT,
  suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_courier_analyses_org ON public.courier_analyses(organization_id);

ALTER TABLE public.courier_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.courier_analyses FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_insert ON public.courier_analyses FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_update ON public.courier_analyses FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY auth_delete ON public.courier_analyses FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

CREATE TRIGGER set_updated_at_courier_analyses
  BEFORE UPDATE ON public.courier_analyses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();