ALTER TABLE public.workflow_states
ADD COLUMN IF NOT EXISTS is_send boolean NOT NULL DEFAULT false;