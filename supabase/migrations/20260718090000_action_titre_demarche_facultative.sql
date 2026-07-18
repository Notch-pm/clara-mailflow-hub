-- Action libre : la démarche devient facultative sur les tickets d'action,
-- et chaque ticket peut porter son propre titre.

ALTER TABLE public.action_tickets
  ALTER COLUMN procedure_id DROP NOT NULL;

ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS title text;
