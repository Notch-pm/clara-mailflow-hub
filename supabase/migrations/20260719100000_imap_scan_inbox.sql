-- Boîte de numérisation : une boîte IMAP alimentée par un copieur, pas par des correspondants.
--
-- POURQUOI. Les collectivités numérisent leur courrier papier sur un copieur
-- réseau à chargeur. Ces copieurs savent tous « scanner vers une adresse mail ».
-- En marquant une boîte IMAP comme boîte de numérisation, les documents scannés
-- deviennent des courriers Clara sans logiciel à installer sur les postes, sans
-- pilote, et avec n'importe quel scanner déjà en place.
--
-- CE QUI CHANGE À L'INGESTION (cf. fetch-inbound-emails) : le canal devient
-- « paper », aucun participant expéditeur n'est créé (le copieur n'est pas
-- l'expéditeur du courrier), le sujet du copieur — « Scan from RICOH... » — est
-- remplacé par un libellé neutre, et l'analyse IA est enfilée automatiquement.

ALTER TABLE public.imap_settings
  ADD COLUMN IF NOT EXISTS is_scan_inbox boolean NOT NULL DEFAULT false;

-- Sans cette liste, toute personne connaissant l'adresse de la boîte peut créer
-- des courriers dans le tenant. Exigence de sécurité, pas confort d'usage.
-- NULL = pas de restriction (à réserver aux boîtes non exposées).
ALTER TABLE public.imap_settings
  ADD COLUMN IF NOT EXISTS scan_allowed_senders text[];

-- Dépassement ponctuel du plafond global (15 Mo) pour un copieur configuré en
-- haute résolution. NULL = plafond global.
ALTER TABLE public.imap_settings
  ADD COLUMN IF NOT EXISTS max_email_bytes integer;

COMMENT ON COLUMN public.imap_settings.is_scan_inbox IS
  'Boîte alimentée par un copieur : ingestion en mode numérisation (canal paper, pas de participant expéditeur, analyse IA automatique).';
COMMENT ON COLUMN public.imap_settings.scan_allowed_senders IS
  'Adresses autorisées à déposer dans cette boîte de numérisation. NULL = aucune restriction.';
COMMENT ON COLUMN public.imap_settings.max_email_bytes IS
  'Plafond de taille par email pour cette boîte. NULL = plafond global de l''edge function.';
