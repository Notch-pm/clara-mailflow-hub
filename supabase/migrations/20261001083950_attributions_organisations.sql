-- Attributions internes des organisations (Socle, public-api 1.33.0).
--
-- `GET /v1/organizations/attributions?tenant_id=` rend, pour chaque organisation
-- active du sous-arbre qui en a écrit, un texte INTERNE : ce qu'elle traite et ce
-- qu'elle ne traite pas. Contrairement aux « informations usager »
-- (`public_description`), il couvre aussi les services internes. C'est la source
-- la plus fiable du catalogue envoyé à l'IA pour proposer le service instructeur.
--
-- - Écrit par `sync-socle-referentiel` seule, chaque nuit ; NULL si rien d'écrit.
--   Pas d'héritage : une organisation absente de la réponse n'a rien écrit, on ne
--   lui prête pas le texte de son parent.
-- - INTERNE : jamais exposé à un usager. La RLS SELECT de la table est déjà
--   `is_member_of` (agents seulement) ; le portail ne lit que id, name, workflow_id.
--
-- Rejouable : IF NOT EXISTS.

ALTER TABLE public.socle_organizations
  ADD COLUMN IF NOT EXISTS attributions text;

COMMENT ON COLUMN public.socle_organizations.attributions IS
  'Attributions INTERNES de l''organisation (ce qu''elle traite / ne traite pas), miroir de GET /v1/organizations/attributions du Socle (texte brut, borné). Écrit par la sync seule ; NULL si rien d''écrit (pas d''héritage du parent). Jamais exposé à un usager : sert au catalogue de la proposition du service instructeur.';
