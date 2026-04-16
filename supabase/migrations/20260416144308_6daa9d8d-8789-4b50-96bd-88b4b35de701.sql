CREATE POLICY "users_read_own_org"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users
      WHERE organization_users.organization_id = organizations.id
        AND organization_users.user_id = auth.uid()
    )
  );