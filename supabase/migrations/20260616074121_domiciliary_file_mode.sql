-- Mode "fichier domiciliaire" : optionnable par organisation (config admin),
-- ajoute des champs détaillés sur les usagers quand actif.

-- 1. Flag d'activation sur l'organisation
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS domiciliary_file_enabled boolean NOT NULL DEFAULT false;

-- 2. Enum situation familiale
DO $$ BEGIN
  CREATE TYPE public.usager_family_status AS ENUM ('celibataire', 'marie', 'pacse', 'inconnu');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Champs domiciliaires sur usagers (toujours en base, saisie conditionnée
-- côté UI à l'activation de organizations.domiciliary_file_enabled)
ALTER TABLE public.usagers
  ADD COLUMN IF NOT EXISTS usual_name varchar(200),
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS death_date date,
  ADD COLUMN IF NOT EXISTS family_status public.usager_family_status,
  ADD COLUMN IF NOT EXISTS arrival_date date,
  ADD COLUMN IF NOT EXISTS departure_date date,
  ADD COLUMN IF NOT EXISTS nationality varchar(100),
  ADD COLUMN IF NOT EXISTS address_number varchar(20),
  ADD COLUMN IF NOT EXISTS address_btq varchar(10),
  ADD COLUMN IF NOT EXISTS address_street varchar(200),
  ADD COLUMN IF NOT EXISTS address_building varchar(100),
  ADD COLUMN IF NOT EXISTS address_apartment varchar(100),
  ADD COLUMN IF NOT EXISTS address_complement varchar(200),
  ADD COLUMN IF NOT EXISTS address_postal_code varchar(20),
  ADD COLUMN IF NOT EXISTS address_city varchar(100),
  ADD COLUMN IF NOT EXISTS phone_2 varchar(50);
