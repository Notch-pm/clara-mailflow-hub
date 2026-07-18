-- File d'attente d'analyse des courriers (OCR + LLM).
--
-- POURQUOI. L'OCR n'était jamais déclenché sur les chemins d'INGESTION : ni
-- l'import en masse, ni la réception IMAP n'appelaient analyze-courier. Seuls
-- les courriers créés à la main via NewCourierDialog avaient des extraits. La
-- boîte de numérisation (courriers arrivant seuls depuis un copieur) rend ce
-- manque bloquant : personne n'est devant l'écran pour cliquer « Analyser ».
--
-- POURQUOI UNE FILE, ET NON UN APPEL DIRECT. L'OCR d'un lot de 30 courriers
-- dure plusieurs minutes et consomme du quota IA. Le déclencher en ligne depuis
-- fetch-inbound-emails ferait dépasser le temps d'exécution de l'edge function
-- et perdrait tout le lot sur une seule erreur. La file rend chaque courrier
-- indépendant, réessayable, et observable.

CREATE TABLE IF NOT EXISTS public.courier_analysis_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id      uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'full'    CHECK (kind   IN ('ocr', 'analyze', 'full')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  -- NULL quand le job est produit par un ingesteur serveur (cron IMAP).
  requested_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Un seul job vivant par courrier : réimporter ou recliquer « Analyser » ne doit
-- pas empiler des OCR concurrents sur les mêmes documents (double facturation
-- IA et écritures concurrentes sur courier_document_extracts).
CREATE UNIQUE INDEX IF NOT EXISTS courier_analysis_jobs_active_uq
  ON public.courier_analysis_jobs (courier_id)
  WHERE status IN ('pending', 'running');

-- Index de service du worker : il ne lit que la tête de file.
CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_claimable
  ON public.courier_analysis_jobs (scheduled_at)
  WHERE status = 'pending';

-- Reprise des jobs bloqués (worker tué en cours de route).
CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_running
  ON public.courier_analysis_jobs (started_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_courier_analysis_jobs_courier
  ON public.courier_analysis_jobs (courier_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────────
-- Lecture seule pour les membres du tenant : l'UI peut afficher « analyse en
-- cours » sur un courrier. Aucune écriture cliente — seuls le service_role
-- (worker, ingesteurs) et le RPC d'enfilement ci-dessous écrivent.
ALTER TABLE public.courier_analysis_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read analysis jobs" ON public.courier_analysis_jobs;
CREATE POLICY "Members read analysis jobs"
  ON public.courier_analysis_jobs
  FOR SELECT
  TO authenticated
  USING (public.is_member_of(organization_id));

-- ─── Enfilement (appelé par le frontend) ────────────────────────────────────────
-- SECURITY DEFINER pour contourner l'absence de policy INSERT, mais la
-- vérification d'appartenance est refaite ici : un membre ne peut enfiler que
-- des courriers de son tenant.
CREATE OR REPLACE FUNCTION public.enqueue_courier_analysis(
  p_courier_id uuid,
  p_kind       text DEFAULT 'full'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_job_id uuid;
BEGIN
  SELECT c.organization_id INTO v_org_id
  FROM couriers c
  WHERE c.id = p_courier_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Courrier introuvable';
  END IF;

  IF NOT public.is_member_of(v_org_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- ON CONFLICT ne sait pas viser un index UNIQUE partiel sans en répéter le
  -- prédicat ; on l'écrit explicitement pour rendre l'appel idempotent.
  INSERT INTO courier_analysis_jobs (organization_id, courier_id, kind, requested_by)
  VALUES (v_org_id, p_courier_id, p_kind, auth.uid())
  ON CONFLICT (courier_id) WHERE status IN ('pending', 'running')
  DO NOTHING
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_courier_analysis(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enqueue_courier_analysis(uuid, text) TO authenticated;

-- ─── Réservation par le worker ──────────────────────────────────────────────────
-- FOR UPDATE SKIP LOCKED : deux exécutions concurrentes du cron ne peuvent pas
-- réserver le même job. Sans SKIP LOCKED, la seconde attendrait la première puis
-- relancerait un OCR déjà fait.
CREATE OR REPLACE FUNCTION public.claim_analysis_jobs(p_limit integer DEFAULT 3)
RETURNS TABLE(
  id              uuid,
  organization_id uuid,
  courier_id      uuid,
  kind            text,
  attempts        integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH claimed AS (
    SELECT j.id
    FROM courier_analysis_jobs j
    WHERE j.status = 'pending'
      AND j.scheduled_at <= now()
    ORDER BY j.scheduled_at, j.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE courier_analysis_jobs j
  SET status     = 'running',
      started_at = now(),
      attempts   = j.attempts + 1
  FROM claimed
  WHERE j.id = claimed.id
  RETURNING j.id, j.organization_id, j.courier_id, j.kind, j.attempts;
$function$;

-- Fonctions de worker : jamais exposées à l'API publique.
REVOKE EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_analysis_jobs(integer) TO service_role;

-- ─── Reprise des jobs orphelins ─────────────────────────────────────────────────
-- Un worker tué (timeout edge function) laisse un job 'running' pour toujours,
-- et l'index unique partiel empêche alors tout nouveau job sur ce courrier.
CREATE OR REPLACE FUNCTION public.requeue_stale_analysis_jobs(p_older_than interval DEFAULT '10 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE courier_analysis_jobs
  SET status     = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
      last_error = 'worker timeout',
      finished_at = CASE WHEN attempts >= 3 THEN now() ELSE NULL END
  WHERE status = 'running'
    AND started_at < now() - p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.requeue_stale_analysis_jobs(interval) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.requeue_stale_analysis_jobs(interval) TO service_role;
