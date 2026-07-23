-- Décommissionnement Arpège (lot L0 — docs/partenaires-integration.md §8).
--
-- trigger_arpege_sync() déclenchait la sync nocturne des démarches Arpège via
-- pg_net + x-cron-secret. Le job cron `sync-arpege-procedures-nightly` a été
-- déplanifié par 20260711091000_socle_cron.sql (le Socle est devenu la source
-- des démarches), mais la fonction SQL est restée orpheline en base (EXECUTE
-- déjà révoqué depuis 20260512192526). On la supprime : plus aucun appelant.
-- La récupération des démarches Arpège reste possible en manuel via l'edge
-- function sync-arpege-services (bouton superadmin).

DROP FUNCTION IF EXISTS public.trigger_arpege_sync();
