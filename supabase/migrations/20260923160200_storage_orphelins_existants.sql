-- Rattrapage des fichiers orphelins accumulés avant l'outbox
-- (20260923160000_storage_deletions_outbox.sql).
--
-- Constat du 2026-09-23 : 18 objets du bucket `clara-documents` (6,4 Mo) sans
-- aucune ligne `courier_documents`, rattachés à 11 courriers qui n'existent plus
-- (supprimés entre le 2026-04-16 et le 2026-09-13), dont des pièces d'identité.
-- `courier_documents.storage_key` est la seule colonne qui référence ce bucket
-- (signatures et avatars ont le leur).
--
-- On les ENFILE, on ne les supprime pas ici : c'est `storage-maintenance` qui les
-- retire par l'API Storage à son prochain passage. Délai de grâce d'un jour : un
-- fichier est déposé AVANT que sa ligne existe (fetch-inbound-emails,
-- portal-form, fichier temporaire d'extract-courier-info) — un dépôt en cours ne
-- doit jamais passer pour un orphelin.
--
-- ⚠️ IRRÉVERSIBLE une fois drainé : un fichier retiré du bucket ne revient pas.
-- Rejouable : l'index unique partiel ignore un objet déjà en attente.

INSERT INTO public.storage_deletions (bucket, storage_path, organization_id, reason)
SELECT 'clara-documents', o.name, NULL, 'orphan'
  FROM storage.objects o
 WHERE o.bucket_id = 'clara-documents'
   AND o.created_at < now() - interval '1 day'
   AND NOT EXISTS (SELECT 1 FROM public.courier_documents d WHERE d.storage_key = o.name)
ON CONFLICT (bucket, storage_path) WHERE done_at IS NULL DO NOTHING;
