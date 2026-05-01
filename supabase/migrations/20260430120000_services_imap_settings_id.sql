ALTER TABLE public.services
  ADD COLUMN imap_settings_id uuid REFERENCES public.imap_settings(id) ON DELETE SET NULL;
