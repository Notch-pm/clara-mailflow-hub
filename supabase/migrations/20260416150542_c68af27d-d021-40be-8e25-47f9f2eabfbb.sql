-- Create the clara-documents storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('clara-documents', 'clara-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service_role full access (used by the edge function)
CREATE POLICY "Service role full access to clara-documents"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'clara-documents')
  WITH CHECK (bucket_id = 'clara-documents');

-- Authenticated users policies (fallback, main access is via edge function with service_role)
CREATE POLICY "Authenticated users can upload to clara-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clara-documents');

CREATE POLICY "Authenticated users can read from clara-documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'clara-documents');

CREATE POLICY "Authenticated users can delete from clara-documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'clara-documents');