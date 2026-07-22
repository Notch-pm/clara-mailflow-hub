-- Purge RGPD — rattachement de courier_analyses et courier_document_extracts.
--
-- Bug : ces deux tables portent un `courier_id` mais AUCUNE clé étrangère vers
-- `couriers`. Résultat : la suppression d'un courrier (purge nocturne
-- `purge_expired_data()` ou tout DELETE) ne les nettoie pas — le résumé/intentions
-- IA (`courier_analyses`) et surtout le TEXTE OCR des pièces jointes
-- (`courier_document_extracts`), qui sont des données personnelles, survivent
-- orphelins → fuite RGPD directe.
--
-- Correctif : FK `courier_id` → `couriers(id)` ON DELETE CASCADE sur les deux tables,
-- alignées sur les 10 autres tables enfants de `couriers` (toutes déjà en CASCADE).
-- Vérifié en base au moment du rattachement : 0 ligne orpheline, aucun `courier_id`
-- NULL → l'ajout de contrainte est propre. Les colonnes `courier_id` sont déjà
-- indexées (`courier_analyses_courier_id_key` unique, `idx_courier_document_extracts_courier`)
-- → cascade performante. Idempotent (DROP IF EXISTS avant ADD).

ALTER TABLE public.courier_analyses
  DROP CONSTRAINT IF EXISTS courier_analyses_courier_id_fkey;
ALTER TABLE public.courier_analyses
  ADD CONSTRAINT courier_analyses_courier_id_fkey
  FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE CASCADE;

ALTER TABLE public.courier_document_extracts
  DROP CONSTRAINT IF EXISTS courier_document_extracts_courier_id_fkey;
ALTER TABLE public.courier_document_extracts
  ADD CONSTRAINT courier_document_extracts_courier_id_fkey
  FOREIGN KEY (courier_id) REFERENCES public.couriers(id) ON DELETE CASCADE;
