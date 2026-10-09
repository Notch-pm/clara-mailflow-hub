-- Canaux « Guichet » et « Autre » pour les courriers entrants (2026-10-09).
--
-- Guichet : une demande déposée ou exprimée à l'accueil physique de la
-- collectivité, saisie par l'agent. Autre : tout ce qui n'entre dans aucun
-- canal nommé (téléphone, réseaux sociaux, remise en main propre…) — mieux
-- qu'un « Papier » par défaut qui fausserait les statistiques par canal.
--
-- Valeurs seulement ajoutées, comme `relaye_elu` : `stats_by_channel` et
-- `search_couriers` lisent le canal en texte, rien d'autre en base ne
-- l'énumère. Rejouable (IF NOT EXISTS).
ALTER TYPE public.courier_channel ADD VALUE IF NOT EXISTS 'guichet';
ALTER TYPE public.courier_channel ADD VALUE IF NOT EXISTS 'autre';
