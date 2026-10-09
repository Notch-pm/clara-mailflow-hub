-- Courrier libre du site Nora (edge function `nora-courrier`) : idempotence.
--
-- Nora relaie chaque dépôt avec un `submission_id` (UUID tiré par le navigateur).
-- Un rejeu — coupure réseau, double clic, nouvelle tentative du relais — doit
-- rendre le MÊME courrier, jamais en créer un second. La fonction cherche
-- d'abord l'existant ; cet index tranche la course entre deux rejeux
-- simultanés (le perdant reçoit 23505 et relit le gagnant).
--
-- Partiel : seuls les courriers venus de Nora portent la clé, l'index ne pèse
-- rien sur les autres portes.

create unique index if not exists couriers_nora_submission_uniq
  on public.couriers (organization_id, (metadata->>'nora_submission_id'))
  where metadata ? 'nora_submission_id';
