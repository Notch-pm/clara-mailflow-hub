-- Canal « Relayé élu » : un élu saisit lui-même, depuis l'espace mobile, une
-- demande qu'un usager lui a confiée (permanence, marché, rencontre). Le
-- courrier arrive dans la boîte aux lettres comme les autres, sans organisation
-- gestionnaire : le service courrier l'oriente.
--
-- Valeur seulement ajoutée : `stats_by_channel` et `search_couriers` lisent le
-- canal en texte, rien d'autre en base ne l'énumère. Rejouable (IF NOT EXISTS).
ALTER TYPE public.courier_channel ADD VALUE IF NOT EXISTS 'relaye_elu';
