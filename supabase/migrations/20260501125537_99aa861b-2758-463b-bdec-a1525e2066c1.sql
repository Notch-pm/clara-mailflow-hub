ALTER TABLE public.workflow_states
ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT false;