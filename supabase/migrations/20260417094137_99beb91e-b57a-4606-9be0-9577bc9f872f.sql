-- Allow superadmins to manage procedures in any organization
DROP POLICY IF EXISTS admin_insert ON public.procedures;
DROP POLICY IF EXISTS admin_update ON public.procedures;
DROP POLICY IF EXISTS admin_delete ON public.procedures;

CREATE POLICY admin_insert ON public.procedures
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  AND (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role = 'administrateur'
    )
  )
);

CREATE POLICY admin_update ON public.procedures
FOR UPDATE TO authenticated
USING (
  organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  AND (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role = 'administrateur'
    )
  )
)
WITH CHECK (
  organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  AND (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role = 'administrateur'
    )
  )
);

CREATE POLICY admin_delete ON public.procedures
FOR DELETE TO authenticated
USING (
  organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  AND (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role = 'administrateur'
    )
  )
);