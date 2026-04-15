
DROP POLICY "org_isolation" ON public.courier_events;

CREATE POLICY "org_isolation" ON public.courier_events
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);
