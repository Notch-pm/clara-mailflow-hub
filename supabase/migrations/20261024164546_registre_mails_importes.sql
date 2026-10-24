-- Registre des courriels déjà importés par la relève IMAP.
--
-- La relève cherche `SINCE <dernière relève − 1 h>` et ne dédoublonnait que par
-- le Message-ID des courriers EXISTANTS : un courrier réellement supprimé
-- (purge de la corbeille, suppression définitive) dont le mail restait dans la
-- boîte était réimporté au passage suivant. Le registre survit au courrier.
-- (Un courrier en corbeille, lui, existe encore : il n'était déjà pas réimporté.)
--
-- Écrit et lu par `fetch-inbound-emails` (service_role) uniquement. Un
-- Message-ID n'a d'utilité que tant qu'il peut revenir dans la fenêtre de
-- relève : la fonction purge les lignes de plus de 90 jours.

CREATE TABLE IF NOT EXISTS public.imported_email_messages (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  imap_settings_id uuid REFERENCES public.imap_settings(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_imported_email_messages_imported_at
  ON public.imported_email_messages (organization_id, imported_at);
CREATE INDEX IF NOT EXISTS idx_imported_email_messages_imap_settings
  ON public.imported_email_messages (imap_settings_id);

ALTER TABLE public.imported_email_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imported_email_messages FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS service_role_full ON public.imported_email_messages;
CREATE POLICY service_role_full ON public.imported_email_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Reprise : les courriers importés encore présents (corbeille comprise), sur
-- la fenêtre de rétention du registre.
INSERT INTO public.imported_email_messages (organization_id, message_id, imap_settings_id, imported_at)
SELECT DISTINCT ON (c.organization_id, c.metadata->>'email_message_id')
  c.organization_id,
  c.metadata->>'email_message_id',
  (SELECT i.id FROM public.imap_settings i WHERE i.id::text = c.metadata->>'imap_settings_id'),
  c.created_at
FROM public.couriers c
WHERE c.metadata->>'email_message_id' IS NOT NULL
  AND c.metadata->>'source' IN ('imap', 'scan')
  AND c.created_at > now() - interval '90 days'
ORDER BY c.organization_id, c.metadata->>'email_message_id', c.created_at
ON CONFLICT DO NOTHING;
