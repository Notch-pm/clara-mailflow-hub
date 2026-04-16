CREATE POLICY "users_read_own_memberships"
  ON public.organization_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());