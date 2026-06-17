-- Coordonnées géographiques de l'adresse, renseignées lors de la sélection
-- d'une suggestion BAN (autocomplete). Nullable : usagers existants ou
-- adresse saisie manuellement sans sélection BAN n'auront pas ces valeurs
-- (fallback géocodage à la volée côté client dans ce cas).
ALTER TABLE public.usagers
  ADD COLUMN IF NOT EXISTS address_lat double precision,
  ADD COLUMN IF NOT EXISTS address_lon double precision;
