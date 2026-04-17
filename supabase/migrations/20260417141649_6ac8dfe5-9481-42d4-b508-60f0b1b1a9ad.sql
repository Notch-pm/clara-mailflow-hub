-- Nettoyage : supprimer les usagers qui ne correspondent à aucun expéditeur de courrier.
-- Les destinataires (membres du personnel ou services internes) n'ont pas vocation à être des usagers.

-- 1) Re-lier d'abord les participants 'sender' à un usager existant (par email) si pas déjà fait
UPDATE public.courier_participants cp
SET usager_id = u.id
FROM public.usagers u
WHERE cp.usager_id IS NULL
  AND cp.role = 'sender'
  AND cp.organization_id = u.organization_id
  AND cp.email IS NOT NULL
  AND u.email IS NOT NULL
  AND lower(cp.email) = lower(u.email);

-- 2) Détacher les usager_id sur les participants non-sender (ils ne doivent pas pointer vers un usager)
UPDATE public.courier_participants
SET usager_id = NULL
WHERE role <> 'sender' AND usager_id IS NOT NULL;

-- 3) Supprimer les usagers qui ne sont liés à aucun participant 'sender'
DELETE FROM public.usagers u
WHERE NOT EXISTS (
  SELECT 1 FROM public.courier_participants cp
  WHERE cp.usager_id = u.id AND cp.role = 'sender'
);