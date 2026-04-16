DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.couriers;

CREATE POLICY "couriers_authenticated_select"
  ON public.couriers
  FOR SELECT
  TO authenticated
  USING (
    organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  );

CREATE POLICY "couriers_authenticated_insert"
  ON public.couriers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  );

CREATE POLICY "couriers_authenticated_update"
  ON public.couriers
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  )
  WITH CHECK (
    organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  );

CREATE POLICY "couriers_authenticated_delete"
  ON public.couriers
  FOR DELETE
  TO authenticated
  USING (
    organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)
  );