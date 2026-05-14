-- RLS policies for clara-documents bucket: scope by org membership via first folder segment
CREATE POLICY "clara_documents_select_org_member"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'clara-documents'
  AND public.is_member_of(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "clara_documents_insert_org_member"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'clara-documents'
  AND public.is_member_of(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "clara_documents_update_org_member"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'clara-documents'
  AND public.is_member_of(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'clara-documents'
  AND public.is_member_of(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "clara_documents_delete_org_member"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'clara-documents'
  AND public.is_member_of(((storage.foldername(name))[1])::uuid)
);