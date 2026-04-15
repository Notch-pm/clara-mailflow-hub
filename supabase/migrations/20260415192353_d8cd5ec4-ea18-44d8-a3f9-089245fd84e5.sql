
-- Allow users to read their own record regardless of org
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Set superadmin on the correct user
UPDATE public.users SET is_superadmin = true WHERE email = 'jacquotlaurent@gmail.com';
