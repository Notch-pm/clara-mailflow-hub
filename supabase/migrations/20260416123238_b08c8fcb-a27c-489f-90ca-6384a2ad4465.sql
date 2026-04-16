
-- Superadmin: full access on users table
CREATE POLICY "superadmin_all_users"
ON public.users
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_superadmin = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_superadmin = true));

-- Superadmin: full access on organization_users table
CREATE POLICY "superadmin_all_org_users"
ON public.organization_users
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_superadmin = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_superadmin = true));
