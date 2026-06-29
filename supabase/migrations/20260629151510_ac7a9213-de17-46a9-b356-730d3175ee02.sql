
-- Restrict signatories write access to org admins only (read remains open to members)
DROP POLICY IF EXISTS auth_insert ON public.signatories;
DROP POLICY IF EXISTS auth_update ON public.signatories;
DROP POLICY IF EXISTS auth_delete ON public.signatories;
CREATE POLICY admin_insert ON public.signatories FOR INSERT TO authenticated WITH CHECK (is_admin_of(organization_id));
CREATE POLICY admin_update ON public.signatories FOR UPDATE TO authenticated USING (is_admin_of(organization_id)) WITH CHECK (is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.signatories FOR DELETE TO authenticated USING (is_admin_of(organization_id));

DROP POLICY IF EXISTS auth_insert ON public.service_signatories;
DROP POLICY IF EXISTS auth_update ON public.service_signatories;
DROP POLICY IF EXISTS auth_delete ON public.service_signatories;
CREATE POLICY admin_insert ON public.service_signatories FOR INSERT TO authenticated WITH CHECK (is_admin_of(organization_id));
CREATE POLICY admin_update ON public.service_signatories FOR UPDATE TO authenticated USING (is_admin_of(organization_id)) WITH CHECK (is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.service_signatories FOR DELETE TO authenticated USING (is_admin_of(organization_id));
