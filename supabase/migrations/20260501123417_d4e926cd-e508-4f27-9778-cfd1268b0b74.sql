-- Table signatories
CREATE TABLE IF NOT EXISTS public.signatories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NULL, -- null = signataire externe (non-utilisateur)
  first_name varchar NOT NULL,
  last_name varchar NOT NULL,
  title text NULL,
  signature_storage_key text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signatories_org ON public.signatories(organization_id);

ALTER TABLE public.signatories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON public.signatories
  FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_insert" ON public.signatories
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_update" ON public.signatories
  FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid)
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_delete" ON public.signatories
  FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE TRIGGER signatories_set_updated_at
  BEFORE UPDATE ON public.signatories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (path layout: {organization_id}/{signatory_id}.{ext})
CREATE POLICY "signatures_org_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = ((current_setting('request.headers', true)::json ->> 'x-org-id'))
  );

CREATE POLICY "signatures_org_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = ((current_setting('request.headers', true)::json ->> 'x-org-id'))
  );

CREATE POLICY "signatures_org_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = ((current_setting('request.headers', true)::json ->> 'x-org-id'))
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = ((current_setting('request.headers', true)::json ->> 'x-org-id'))
  );

CREATE POLICY "signatures_org_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] = ((current_setting('request.headers', true)::json ->> 'x-org-id'))
  );