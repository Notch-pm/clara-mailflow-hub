-- Permet plusieurs configurations IMAP par organisation.
-- Supprime la contrainte UNIQUE sur organization_id et ajoute un libellé.

ALTER TABLE public.imap_settings
  DROP CONSTRAINT imap_settings_organization_id_key;

ALTER TABLE public.imap_settings
  ADD COLUMN label text NOT NULL DEFAULT 'Principal';
