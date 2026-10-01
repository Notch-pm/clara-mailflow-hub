-- Réveil immédiat du worker d'analyse IA.
--
-- La file `courier_analysis_jobs` n'était traitée que par le cron
-- `process-analysis-queue-every-2min` : un clic sur « Lancer l'analyse IA »
-- attendait jusqu'à deux minutes avant que l'analyse (7 à 8 s) ne commence.
--
-- Désormais, toute entrée en file réveille aussitôt le worker, via la fonction
-- qu'utilise déjà le cron (`trigger_process_analysis_queue`, pg_net +
-- `x-cron-secret`). Le cron reste le filet (jobs reportés, réessais, réveil
-- perdu).
--
-- Anti-rebond : au plus un réveil toutes les 5 secondes. Un import en masse
-- enfile 30 jobs en rafale — un seul worker est réveillé, et il enchaîne les
-- lots tant que la file en a (boucle bornée dans l'edge function). Sans cela,
-- 30 workers concurrents appelleraient le guichet IA en même temps et se
-- feraient refuser pour cadence.
--
-- Rejouable : IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

CREATE TABLE IF NOT EXISTS public.analysis_queue_wakeups (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_wake_at timestamptz NOT NULL DEFAULT '-infinity'
);

COMMENT ON TABLE public.analysis_queue_wakeups IS
  'Horodatage du dernier réveil du worker d''analyse (anti-rebond du trigger courier_analysis_jobs_wake_worker). Une seule ligne.';

ALTER TABLE public.analysis_queue_wakeups ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seule la fonction SECURITY DEFINER ci-dessous y touche.

INSERT INTO public.analysis_queue_wakeups (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.courier_analysis_jobs_wake_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_woken boolean;
BEGIN
  UPDATE analysis_queue_wakeups
     SET last_wake_at = now()
   WHERE id = 1
     AND last_wake_at < now() - interval '5 seconds'
  RETURNING true INTO v_woken;

  IF v_woken THEN
    -- Requête asynchrone (pg_net) : l'insertion n'attend pas le worker. Un
    -- échec d'envoi ne doit jamais empêcher la mise en file.
    BEGIN
      PERFORM public.trigger_process_analysis_queue();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Réveil du worker d''analyse impossible : %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.courier_analysis_jobs_wake_worker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS courier_analysis_jobs_wake_worker ON public.courier_analysis_jobs;
CREATE TRIGGER courier_analysis_jobs_wake_worker
  AFTER INSERT ON public.courier_analysis_jobs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.courier_analysis_jobs_wake_worker();
