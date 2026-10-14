-- Performance — reliquats P1.4 / P1.11 de docs/technical-debt.md.
--
-- 1. Lecture de `couriers` : l'appartenance calculée UNE fois par requête.
--    `is_member_of(organization_id)` est SECURITY DEFINER avec search_path :
--    Postgres ne peut pas l'intégrer à la requête et l'appelle pour chaque
--    ligne (deux sous-requêtes à chaque fois). Sur ACCM (4 550 courriers),
--    un simple comptage coûtait ~700 ms, `stats_by_service` 1,1 s.
--    Même règle, écrite pour que le planificateur la sorte de la boucle :
--    superadmin en InitPlan, organisations du membre en sous-plan haché.
--    Mesuré en transaction annulée : comptage 700 ms → 3 ms, stats 1,1 s →
--    0,15 s ; ensembles visibles identiques (md5 des id) pour les 26
--    utilisateurs membres et l'anonyme.
--    Les autres tables gardent `is_member_of` : petites, ou lues par courrier.

DROP POLICY IF EXISTS auth_select ON public.couriers;
CREATE POLICY auth_select ON public.couriers
  FOR SELECT TO authenticated
  USING (
    (
      (SELECT public.is_superadmin((SELECT auth.uid())))
      OR organization_id IN (SELECT public.current_user_orgs())
    )
    AND deleted_at IS NULL
    AND (
      NOT is_confidential
      OR public.can_read_confidential_courier(organization_id, id, socle_organization_id, workflow_state_id, metadata)
    )
  );

-- 2. service_role_full déclarées sans TO (= PUBLIC) : évaluées aussi pour
--    authenticated, ligne à ligne, en doublon des policies métier. Même motif
--    que 20260712090000_rls_consolidation_advisors.

DROP POLICY IF EXISTS service_role_full ON public.procedure_organizations;
CREATE POLICY service_role_full ON public.procedure_organizations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.courier_visas;
CREATE POLICY service_role_full ON public.courier_visas FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_organization_viseurs;
CREATE POLICY service_role_full ON public.socle_organization_viseurs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 3. Index en double : celui de la contrainte UNIQUE reste.

DROP INDEX IF EXISTS public.idx_org_integration_provider;

-- 4. Clés étrangères sans index (advisor du 2026-10-14). Laissées de côté :
--    `services.imap_settings_id` et `portal_forms.service_id`, legacy à supprimer.

CREATE INDEX IF NOT EXISTS idx_action_task_tokens_organization_id ON public.action_task_tokens (organization_id);
CREATE INDEX IF NOT EXISTS idx_action_tickets_completed_by ON public.action_tickets (completed_by);
CREATE INDEX IF NOT EXISTS idx_action_tickets_created_by ON public.action_tickets (created_by);
CREATE INDEX IF NOT EXISTS idx_action_tickets_socle_organization_id ON public.action_tickets (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_requested_by ON public.courier_analysis_jobs (requested_by);
CREATE INDEX IF NOT EXISTS idx_courier_visas_designated_user_id ON public.courier_visas (designated_user_id);
CREATE INDEX IF NOT EXISTS idx_courier_visas_user_id ON public.courier_visas (user_id);
CREATE INDEX IF NOT EXISTS idx_courier_visas_workflow_state_id ON public.courier_visas (workflow_state_id);
CREATE INDEX IF NOT EXISTS idx_couriers_deleted_by ON public.couriers (deleted_by);
CREATE INDEX IF NOT EXISTS idx_couriers_socle_organization_id ON public.couriers (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_imap_settings_organization_id ON public.imap_settings (organization_id);
CREATE INDEX IF NOT EXISTS idx_imap_settings_socle_organization_id ON public.imap_settings (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_portal_forms_socle_organization_id ON public.portal_forms (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_procedure_organizations_procedure_id ON public.procedure_organizations (procedure_id);
CREATE INDEX IF NOT EXISTS idx_procedure_organizations_socle_organization_id ON public.procedure_organizations (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_socle_organization_signatories_signatory_id ON public.socle_organization_signatories (signatory_id);
CREATE INDEX IF NOT EXISTS idx_socle_organizations_reply_workflow_id ON public.socle_organizations (reply_workflow_id);
CREATE INDEX IF NOT EXISTS idx_socle_organizations_workflow_id ON public.socle_organizations (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_states_organization_id ON public.workflow_states (organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_organization_id ON public.workflow_transitions (organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_to_state_id ON public.workflow_transitions (to_state_id);
