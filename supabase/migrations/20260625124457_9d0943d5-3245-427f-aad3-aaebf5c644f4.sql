ALTER TABLE public.workflow_transitions
  ADD COLUMN IF NOT EXISTS kind text;

ALTER TABLE public.workflow_transitions
  DROP CONSTRAINT IF EXISTS workflow_transitions_kind_check;

ALTER TABLE public.workflow_transitions
  ADD CONSTRAINT workflow_transitions_kind_check
  CHECK (kind IS NULL OR kind IN ('next', 'previous'));

CREATE UNIQUE INDEX IF NOT EXISTS workflow_transitions_from_kind_unique
  ON public.workflow_transitions (from_state_id, kind)
  WHERE kind IS NOT NULL;

COMMENT ON COLUMN public.workflow_transitions.kind IS
  'Rôle nominal de la transition pour cet état source : next (étape suivante automatique), previous (retour en arrière nominal), ou NULL (transition secondaire).';