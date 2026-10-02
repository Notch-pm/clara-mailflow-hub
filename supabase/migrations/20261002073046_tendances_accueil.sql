-- Accueil : tendances des douze derniers mois complets.
--
-- Une ligne par mois (heure de Paris), du plus ancien au plus récent, sur les
-- courriers reçus de l'organisation — tous, ou ceux d'un ensemble
-- d'organisations du Socle (« Mon service »). Le périmètre suit
-- l'organisation ACTUELLE du courrier : l'historique des routages n'est pas
-- rejoué.
--
--   received            reçus dans le mois
--   open_at_end         en cours à la fin du mois (reçus avant, pas encore clos)
--   answered            ayant reçu leur première réponse dans le mois (acknowledged_at)
--   avg_days_to_answer  délai moyen réception → première réponse, en jours calendaires
--   resolved            clos dans le mois (resolved_at)
--   avg_days_to_resolve délai moyen réception → clôture, en jours calendaires
--
-- Agrégats seulement : SECURITY DEFINER borné par is_member_of, comme
-- mailroom_couriers dont le tableau de bord lit déjà les lignes.

DROP FUNCTION IF EXISTS public.dashboard_trends(uuid, uuid[], integer);

CREATE OR REPLACE FUNCTION public.dashboard_trends(
  p_organization_id uuid,
  p_socle_organization_ids uuid[] DEFAULT NULL,
  p_months integer DEFAULT 12
)
RETURNS TABLE(
  month text,
  received bigint,
  open_at_end bigint,
  answered bigint,
  avg_days_to_answer double precision,
  resolved bigint,
  avg_days_to_resolve double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT
      gs AS local_start,
      gs AT TIME ZONE 'Europe/Paris' AS m_start,
      (gs + interval '1 month') AT TIME ZONE 'Europe/Paris' AS m_end
    FROM generate_series(
      date_trunc('month', now() AT TIME ZONE 'Europe/Paris')
        - make_interval(months => LEAST(GREATEST(COALESCE(p_months, 12), 1), 24)),
      date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '1 month',
      interval '1 month'
    ) AS gs
  ),
  c AS (
    SELECT
      COALESCE(c.received_at, c.created_at) AS rec,
      c.acknowledged_at,
      c.resolved_at
    FROM couriers c
    WHERE c.organization_id = p_organization_id
      AND public.is_member_of(p_organization_id)
      AND c.direction = 'inbound'
      AND c.deleted_at IS NULL
      AND (p_socle_organization_ids IS NULL OR c.socle_organization_id = ANY(p_socle_organization_ids))
      -- Clos avant la fenêtre : ni reçu, ni en cours, ni répondu, ni clos dedans.
      AND (c.resolved_at IS NULL OR c.resolved_at >= (SELECT min(m_start) FROM bounds))
  )
  SELECT
    to_char(b.local_start, 'YYYY-MM') AS month,
    count(*) FILTER (WHERE c.rec >= b.m_start AND c.rec < b.m_end) AS received,
    count(*) FILTER (WHERE c.rec < b.m_end AND (c.resolved_at IS NULL OR c.resolved_at >= b.m_end)) AS open_at_end,
    count(*) FILTER (WHERE c.acknowledged_at >= b.m_start AND c.acknowledged_at < b.m_end) AS answered,
    round(avg(GREATEST(extract(epoch FROM c.acknowledged_at - c.rec), 0) / 86400)
      FILTER (WHERE c.acknowledged_at >= b.m_start AND c.acknowledged_at < b.m_end)::numeric, 1)::float8 AS avg_days_to_answer,
    count(*) FILTER (WHERE c.resolved_at >= b.m_start AND c.resolved_at < b.m_end) AS resolved,
    round(avg(GREATEST(extract(epoch FROM c.resolved_at - c.rec), 0) / 86400)
      FILTER (WHERE c.resolved_at >= b.m_start AND c.resolved_at < b.m_end)::numeric, 1)::float8 AS avg_days_to_resolve
  FROM bounds b
  LEFT JOIN c ON true
  GROUP BY b.local_start
  ORDER BY b.local_start;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_trends(uuid, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_trends(uuid, uuid[], integer) TO authenticated;
