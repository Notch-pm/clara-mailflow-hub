-- ============================================================
-- notifications : policy INSERT manquante
-- ============================================================
-- La table n'a jamais eu de policy INSERT (voir 20260419130000_notifications.sql
-- puis 20260712090000_rls_consolidation_advisors.sql : select / update / delete
-- « own » uniquement). Les notifications de transfert de courrier sont pourtant
-- insérées côté client depuis MailboxSidePanel : la RLS les rejetait donc en
-- silence, l'erreur n'étant pas vérifiée à l'appel.
--
-- On autorise un membre à créer une notification dans une organisation dont il
-- fait lui-même partie. Le service_role (edge functions) contourne la RLS et
-- n'est pas concerné.

DROP POLICY IF EXISTS notifications_insert_org_member ON public.notifications;
CREATE POLICY notifications_insert_org_member ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_member_of(organization_id));
