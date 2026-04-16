
-- Drop the broken org_isolation policy
DROP POLICY IF EXISTS "org_isolation" ON public.organization_integrations;

-- Recreate with the correct header format (matching all other tables)
CREATE POLICY "org_isolation"
ON public.organization_integrations
FOR ALL TO authenticated
USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- Add superadmin full access
DROP POLICY IF EXISTS "superadmin_all_integrations" ON public.organization_integrations;
CREATE POLICY "superadmin_all_integrations"
ON public.organization_integrations
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_superadmin = true))
WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_superadmin = true));
