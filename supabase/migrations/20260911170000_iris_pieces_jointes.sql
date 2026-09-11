-- Pièces jointes transmises à Iris (contrat 2.0.0 : dépôt sur POST /v1/uploads,
-- puis référence par upload_id). Les pièces qui PARTENT n'ont pas besoin d'être
-- mémorisées ici — `socle_data.pieces_jointes` dit déjà lesquelles la démarche
-- réclame, et Iris en porte l'empreinte. Ce qui manquait, c'est de pouvoir dire
-- à l'agent qu'une pièce n'est PAS arrivée : un toast passe, la demande reste.

ALTER TABLE public.action_tickets
  ADD COLUMN IF NOT EXISTS iris_attachments_error text;

COMMENT ON COLUMN public.action_tickets.iris_attachments_error IS
  'Pièces réclamées par le formulaire de la démarche qui n''ont pas pu être déposées dans Iris au dernier dépôt (message français, destiné à l''agent). NULL = rien à signaler — jamais une affirmation que tout est arrivé : les demandes déposées avant le 2026-09-11 sont parties sans aucune pièce.';
