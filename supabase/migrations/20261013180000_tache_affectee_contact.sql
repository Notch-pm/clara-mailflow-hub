-- Tâche affectée à un contact Interne ou Élu du référentiel.
--
-- Une tâche s'adresse jusqu'ici à un membre de Clara (`assignee_id`) ou à une
-- simple adresse (`assignee_email` + `assignee_name`). Troisième voie : un
-- contact du référentiel portant le rôle Interne ou Élu. Son adresse et son nom
-- restent recopiés dans `assignee_email` / `assignee_name` (le mail part de là,
-- et la tâche garde ce qu'on lui a dit à la création) ; on garde en plus la
-- référence de la fiche, pour l'afficher et la retrouver.
--
-- Pas de clé étrangère : le contact appartient au Socle (même motif que
-- `courier_participants.socle_contact_id`). Rejouable.

ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS assignee_socle_contact_id uuid;

COMMENT ON COLUMN public.action_tickets.assignee_socle_contact_id IS
  'Tâche : fiche du référentiel (contact Interne ou Élu) à qui elle est affectée. Référence Socle, sans clé étrangère ; e-mail et nom restent recopiés dans assignee_email / assignee_name.';

ALTER TABLE public.action_tickets DROP CONSTRAINT IF EXISTS action_tickets_assignee_contact_check;
ALTER TABLE public.action_tickets ADD CONSTRAINT action_tickets_assignee_contact_check
  CHECK (assignee_socle_contact_id IS NULL OR kind = 'tache');

CREATE INDEX IF NOT EXISTS action_tickets_assignee_contact_idx
  ON public.action_tickets (organization_id, assignee_socle_contact_id)
  WHERE assignee_socle_contact_id IS NOT NULL;
