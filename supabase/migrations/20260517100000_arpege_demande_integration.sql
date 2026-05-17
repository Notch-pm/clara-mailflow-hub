-- Stockage de la config formulaire Arpège par procédure
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS arpege_config_fields jsonb;

-- Référence de la demande créée dans Arpège sur le ticket d'action
ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS arpege_demande_ref text,
  ADD COLUMN IF NOT EXISTS arpege_demande_status text;
