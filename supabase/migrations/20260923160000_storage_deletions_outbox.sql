-- ============================================================================
-- Outbox de suppression des fichiers du bucket `clara-documents`
-- (audit purge / performance de la gamme, 2026-09-23).
--
-- LE PROBLÈME. Un fichier du bucket ne partait JAMAIS :
--   • removeDocument() (src/services/courierDocumentService.ts) supprime la
--     ligne `courier_documents`, pas l'objet ;
--   • la purge de rétention (purge_expired_data) et la suppression d'une
--     organisation suppriment les courriers, donc leurs documents par CASCADE —
--     mais Postgres ne peut pas appeler l'API Storage.
-- Constat du 2026-09-23 : 18 objets sur 89 (6,4 Mo sur 24 Mo) sans aucune ligne,
-- tous rattachés à des courriers qui n'existent plus — dont des pièces
-- d'identité. Une donnée qu'on croit effacée pour rétention persiste en fichier.
--
-- LA RÉPONSE (motif Iris `storage_deletions`, 20260913100000) : la base décide,
-- l'edge function `storage-maintenance` exécute. Un trigger AFTER DELETE sur
-- `courier_documents` enfile l'objet — quel que soit le chemin de suppression
-- (écran, cascade depuis le courrier ou l'organisation, purge de rétention).
-- L'edge retire l'objet par l'API Storage et solde la ligne. Jamais de DELETE
-- SQL sur storage.objects.
--
-- Pas de FK vers organizations : la ligne doit survivre à la suppression de
-- l'organisation dont elle efface les fichiers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.storage_deletions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket          text NOT NULL DEFAULT 'clara-documents',
  storage_path    text NOT NULL,
  organization_id uuid,
  reason          text NOT NULL CHECK (reason IN ('document_deleted', 'orphan')),
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz,
  last_error      text
);
COMMENT ON TABLE public.storage_deletions IS
  'Outbox de suppression des objets du bucket clara-documents : la base enfile (trigger sur courier_documents), l''edge function storage-maintenance retire par l''API Storage. Jamais de DELETE SQL sur storage.objects.';

-- Un objet n'est enfilé qu'une fois tant qu'il n'est pas retiré.
CREATE UNIQUE INDEX IF NOT EXISTS storage_deletions_pending_key
  ON public.storage_deletions (bucket, storage_path)
  WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS storage_deletions_due_idx
  ON public.storage_deletions (next_attempt_at)
  WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS storage_deletions_done_idx
  ON public.storage_deletions (done_at)
  WHERE done_at IS NOT NULL;

ALTER TABLE public.storage_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_deletions_service ON public.storage_deletions;
CREATE POLICY storage_deletions_service ON public.storage_deletions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Le trigger — un document supprimé emporte son objet, s'il était le dernier
-- à le référencer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.courier_documents_enqueue_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF old.storage_key IS NULL OR EXISTS (
    SELECT 1 FROM public.courier_documents d
     WHERE d.storage_key = old.storage_key AND d.id <> old.id
  ) THEN
    RETURN old;
  END IF;
  INSERT INTO public.storage_deletions (bucket, storage_path, organization_id, reason)
  VALUES ('clara-documents', old.storage_key, old.organization_id, 'document_deleted')
  ON CONFLICT (bucket, storage_path) WHERE done_at IS NULL DO NOTHING;
  RETURN old;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.courier_documents_enqueue_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_courier_documents_enqueue_deletion ON public.courier_documents;
CREATE TRIGGER trg_courier_documents_enqueue_deletion
  AFTER DELETE ON public.courier_documents
  FOR EACH ROW EXECUTE FUNCTION public.courier_documents_enqueue_deletion();

-- ----------------------------------------------------------------------------
-- RPC de service (service_role seul, aucune EXECUTE cliente)
-- ----------------------------------------------------------------------------

-- Réclame un lot et avance le prochain essai DANS LA MÊME instruction (for
-- update skip locked) : deux passages concurrents ne retirent jamais deux fois.
-- Recul : 1, 2, 4… minutes, abandon à 8 essais (l'erreur reste lisible).
CREATE OR REPLACE FUNCTION public.claim_storage_deletions(p_limit int DEFAULT 100)
RETURNS SETOF public.storage_deletions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.storage_deletions d
     WHERE d.done_at IS NULL AND d.next_attempt_at <= now() AND d.attempts < 8
     ORDER BY d.enqueued_at
     LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.storage_deletions d
     SET attempts = d.attempts + 1,
         next_attempt_at = now() + (interval '1 minute' * power(2, least(d.attempts, 7)))
   WHERE d.id IN (SELECT id FROM due)
  RETURNING d.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_storage_deletions(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_deletions(int) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_storage_deletion(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.storage_deletions
     SET done_at = CASE WHEN p_ok THEN now() ELSE done_at END,
         last_error = CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_error, ''), 500) END
   WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.settle_storage_deletion(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_storage_deletion(uuid, boolean, text) TO service_role;

-- Les lignes soldées ne sont plus qu'une trace : 30 jours.
CREATE OR REPLACE FUNCTION public.purge_settled_storage_deletions()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM public.storage_deletions WHERE done_at < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_settled_storage_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_settled_storage_deletions() TO service_role;
