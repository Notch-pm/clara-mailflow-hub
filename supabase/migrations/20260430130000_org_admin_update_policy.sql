CREATE POLICY "org_admin_update_own_org"
ON public.organizations FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_users
    WHERE user_id = auth.uid()
      AND organization_id = organizations.id
      AND role IN ('admin', 'administrateur')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM organization_users
    WHERE user_id = auth.uid()
      AND organization_id = organizations.id
      AND role IN ('admin', 'administrateur')
  )
);
