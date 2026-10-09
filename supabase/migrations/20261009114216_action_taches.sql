-- Actions liées : la « tâche », action interne affectée à un agent (2026-10-09).
--
-- Une tâche n'est jamais transmise à Iris ni à un partenaire : intitulé,
-- commentaire facultatif (`description`), agent affecté — utilisateur Clara
-- (`assignee_id`) ou simple adresse (`assignee_email` / `assignee_name`). L'agent
-- reçoit un mail avec un lien à jeton qui lui permet de la marquer terminée sans
-- se connecter (edge functions `action-task-mail` et `action-task-public`).
--
-- `kind` distingue la tâche de la demande (Iris / Arpège, et les anciennes
-- « demandes libres » d'avant le 2026-09-11, qui restent `demande`).
-- Idempotent.

ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'demande',
  ADD COLUMN IF NOT EXISTS assignee_email text,
  ADD COLUMN IF NOT EXISTS assignee_name text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_via text,
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.action_tickets DROP CONSTRAINT IF EXISTS action_tickets_kind_check;
ALTER TABLE public.action_tickets ADD CONSTRAINT action_tickets_kind_check
  CHECK (kind IN ('demande', 'tache'));

ALTER TABLE public.action_tickets DROP CONSTRAINT IF EXISTS action_tickets_completed_via_check;
ALTER TABLE public.action_tickets ADD CONSTRAINT action_tickets_completed_via_check
  CHECK (completed_via IS NULL OR completed_via IN ('app', 'lien'));

-- Une tâche : un intitulé, aucune démarche, un destinataire joignable, et un
-- statut dans la liste fermée. Les demandes gardent leurs valeurs historiques.
ALTER TABLE public.action_tickets DROP CONSTRAINT IF EXISTS action_tickets_tache_check;
ALTER TABLE public.action_tickets ADD CONSTRAINT action_tickets_tache_check
  CHECK (
    kind <> 'tache' OR (
      btrim(coalesce(title, '')) <> ''
      AND procedure_id IS NULL
      AND btrim(coalesce(assignee_email, '')) <> ''
      AND status IN ('open', 'done')
      AND (completion_note IS NULL OR char_length(completion_note) <= 1000)
    )
  );

-- Jetons des liens envoyés par mail. Un jeton par mail (création, puis chaque
-- relance) : tous restent valides tant que la tâche est ouverte. Seul le hash
-- SHA-256 (hex) est stocké. Aucune policy : service role uniquement.
CREATE TABLE IF NOT EXISTS public.action_task_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.action_tickets(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS action_task_tokens_ticket_idx ON public.action_task_tokens(ticket_id);
ALTER TABLE public.action_task_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_task_tokens FROM anon, authenticated;

-- Cohérence du statut d'une tâche, quel que soit l'appelant (écran ou lien) :
--  * le type ne change pas après création ;
--  * passage à `done` : date posée si absente, liens du mail révoqués ;
--  * retour à `open` : les traces de clôture sont effacées.
CREATE OR REPLACE FUNCTION public.action_tickets_task_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Le type d''une action ne peut pas changer.';
  END IF;
  IF NEW.kind <> 'tache' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at := coalesce(NEW.completed_at, now());
    NEW.completed_via := coalesce(NEW.completed_via, 'app');
    UPDATE public.action_task_tokens
       SET revoked_at = now()
     WHERE ticket_id = NEW.id AND revoked_at IS NULL;
  ELSIF NEW.status = 'open' THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
    NEW.completed_via := NULL;
    NEW.completion_note := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_action_tickets_task_status ON public.action_tickets;
CREATE TRIGGER trg_action_tickets_task_status
  BEFORE UPDATE ON public.action_tickets
  FOR EACH ROW EXECUTE FUNCTION public.action_tickets_task_status();
