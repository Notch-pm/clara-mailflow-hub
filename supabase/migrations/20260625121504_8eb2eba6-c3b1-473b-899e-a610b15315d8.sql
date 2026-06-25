ALTER TABLE public.courier_notes
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_courier_notes_mentioned_user_ids
  ON public.courier_notes USING GIN (mentioned_user_ids);