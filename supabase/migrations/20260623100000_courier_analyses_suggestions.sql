-- Champs suggérés par l'analyse IA (papier + email) : titre, service
-- gestionnaire, expéditeur enrichi, destinataire. Permettent à l'UI de
-- proposer un pré-remplissage/une application manuelle, sur le même principe
-- que les tags suggérés (intents) déjà en place.
ALTER TABLE public.courier_analyses
  ADD COLUMN suggested_subject text,
  ADD COLUMN suggested_service_name text,
  ADD COLUMN suggested_recipient_name text,
  ADD COLUMN suggested_sender jsonb;
