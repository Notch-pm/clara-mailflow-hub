-- Create enum for workflow type
CREATE TYPE public.workflow_type AS ENUM ('inbound', 'reply');

-- Add column (nullable first, backfill, then NOT NULL)
ALTER TABLE public.workflows ADD COLUMN type public.workflow_type;

UPDATE public.workflows SET type = 'inbound' WHERE type IS NULL;

ALTER TABLE public.workflows ALTER COLUMN type SET NOT NULL;