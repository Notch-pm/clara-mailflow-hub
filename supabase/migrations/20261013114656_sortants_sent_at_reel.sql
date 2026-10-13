-- Courriers sortants : `sent_at` devient la VRAIE date d'envoi (2026-10-13).
--
-- `check_dates` exigeait un `sent_at` sur tout sortant. Les réponses le
-- posaient donc dès la création du brouillon — un leurre, que
-- `draft-reply` et `delais_de_traitement` documentaient comme tel — et « Envoyé
-- le » affichait la date de création d'un courrier jamais parti.
--
-- Désormais un sortant naît sans `sent_at` ; il est posé à l'envoi par courriel
-- (`send-courier-reply`), à la déclaration « posté » (lot 4), ou au passage
-- dans un état `processed` (`transitionReplyState`, filet de sécurité).
-- Les sortants existants gardent la valeur qu'ils ont : pas de reprise.
--
-- Branches `inbound` et `internal` recopiées de la définition live
-- (`pg_get_constraintdef`, 2026-10-13). Voir docs/specs/courriers-sortants.md.
-- Idempotent.

ALTER TABLE public.couriers DROP CONSTRAINT IF EXISTS check_dates;
ALTER TABLE public.couriers
  ADD CONSTRAINT check_dates CHECK (
    (direction = 'inbound'::courier_direction AND received_at IS NOT NULL)
    OR direction = 'outbound'::courier_direction
    OR direction = 'internal'::courier_direction
  );
