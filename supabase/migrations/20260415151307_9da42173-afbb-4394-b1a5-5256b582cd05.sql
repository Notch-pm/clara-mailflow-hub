
DROP POLICY "allow_insert" ON public.users;

-- Only allow insert when an org context is set
CREATE POLICY "org_insert" ON public.users
  FOR INSERT
  WITH CHECK (current_setting('request.header.x-org-id', true) IS NOT NULL);
