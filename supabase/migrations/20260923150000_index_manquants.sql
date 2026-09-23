-- Index manquants — audit purge / performance de la gamme du 2026-09-23.
--
-- 1. notifications(resource_id, type) WHERE read = false
--    fn_mark_courier_notifications_read() exécute, DANS la transaction de
--    changement d'état d'un courrier :
--      UPDATE notifications SET read = true
--       WHERE resource_id = NEW.id AND type = 'new_courier' AND read = false;
--    Sans index, balayage complet de notifications à chaque sortie de l'état
--    « pending » — sur le chemin critique de l'agent, pas en tâche de fond.
--
-- 2. organization_id sur les tables satellites du courrier (advisor
--    unindexed_foreign_keys). Les DELETE … WHERE organization_id = ANY (…)
--    sur courier_participants / courier_events / couriers coûtent 125 à 219 ms
--    en moyenne dans pg_stat_statements pour quelques milliers de lignes ; la
--    cascade depuis organizations en dépend aussi.
--
-- 3. couriers(socle_organization_id) et couriers(parent_courier_id) : FK sans
--    index sur la table centrale (filtre par organisation Socle, cascade des
--    courriers enfants).
--
-- Pas de CONCURRENTLY : les migrations passent dans une transaction, et les
-- tables font au plus ~11 000 lignes — le verrou dure quelques millisecondes.
-- Rejouable : IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_notifications_resource_unread
  ON public.notifications (resource_id, type)
  WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_courier_participants_organization
  ON public.courier_participants (organization_id);
CREATE INDEX IF NOT EXISTS idx_courier_events_organization
  ON public.courier_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_courier_documents_organization
  ON public.courier_documents (organization_id);
CREATE INDEX IF NOT EXISTS idx_courier_links_organization
  ON public.courier_links (organization_id);
CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_organization
  ON public.courier_analysis_jobs (organization_id);

CREATE INDEX IF NOT EXISTS idx_couriers_socle_organization
  ON public.couriers (socle_organization_id);
CREATE INDEX IF NOT EXISTS idx_couriers_parent_courier
  ON public.couriers (parent_courier_id)
  WHERE parent_courier_id IS NOT NULL;
