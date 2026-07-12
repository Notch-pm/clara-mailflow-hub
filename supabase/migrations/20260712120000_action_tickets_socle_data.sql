-- Demandes sur démarches Socle : valeurs saisies à la création du ticket
-- (demandeur selon requester_config + formulaire selon form_schema + ids des
-- documents du courrier sélectionnés comme pièces jointes).
-- Structure du JSON : voir src/lib/socle-form.ts (SocleDemandeData).
ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS socle_data jsonb;
