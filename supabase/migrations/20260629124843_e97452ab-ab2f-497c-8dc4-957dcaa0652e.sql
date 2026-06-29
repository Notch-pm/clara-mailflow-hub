
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS courier_retention_days integer,
  ADD COLUMN IF NOT EXISTS usager_retention_days integer;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_courier_retention_days_positive
    CHECK (courier_retention_days IS NULL OR courier_retention_days > 0),
  ADD CONSTRAINT organizations_usager_retention_days_positive
    CHECK (usager_retention_days IS NULL OR usager_retention_days > 0);
