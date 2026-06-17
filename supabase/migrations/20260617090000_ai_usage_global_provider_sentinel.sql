-- Corrige un bug d'upsert sur ai_usage_quotas/ai_usage_counters : la convention
-- provider = NULL pour "plafond global tous fournisseurs confondus" empêchait
-- ON CONFLICT (organization_id, provider) de fonctionner, car deux valeurs NULL
-- ne sont jamais égales pour une contrainte UNIQUE en SQL. Chaque mise à jour du
-- plafond global créait donc une nouvelle ligne au lieu d'écraser l'existante, et
-- la lecture (LIMIT 1 sans tri stable entre plusieurs NULL) devenait non
-- déterministe. Remplacement de la convention par une sentinelle non-NULL
-- '__global__'.

-- 1) Dédoublonnage des plafonds globaux existants : ne garder que la ligne la
--    plus récente par organisation (cas réel observé : mairie de Laurentville,
--    3 lignes accumulées par appels successifs du même upsert cassé).
DELETE FROM ai_usage_quotas q
WHERE q.provider IS NULL
  AND q.id NOT IN (
    SELECT id FROM (
      SELECT id, row_number() OVER (
        PARTITION BY organization_id ORDER BY updated_at DESC, created_at DESC
      ) AS rn
      FROM ai_usage_quotas
      WHERE provider IS NULL
    ) ranked
    WHERE rn = 1
  );

-- Même précaution côté compteurs (aucun cas réel constaté à ce jour, mais le
-- même bug aurait pu produire des doublons ailleurs) : fusionne en sommant
-- used_tokens/reserved_tokens avant de supprimer les doublons, pour ne perdre
-- aucune consommation déjà enregistrée.
WITH ranked AS (
  SELECT id, organization_id, period,
         row_number() OVER (PARTITION BY organization_id, period ORDER BY updated_at DESC) AS rn
  FROM ai_usage_counters
  WHERE provider IS NULL
),
merged AS (
  SELECT c.organization_id, c.period,
         sum(c.used_tokens) AS total_used,
         sum(c.reserved_tokens) AS total_reserved
  FROM ai_usage_counters c
  JOIN ranked r ON r.id = c.id
  GROUP BY c.organization_id, c.period
)
UPDATE ai_usage_counters c
SET used_tokens = m.total_used,
    reserved_tokens = m.total_reserved,
    updated_at = now()
FROM merged m
JOIN ranked r ON r.organization_id = m.organization_id AND r.period = m.period AND r.rn = 1
WHERE c.id = r.id;

DELETE FROM ai_usage_counters c
USING (
  SELECT id, row_number() OVER (PARTITION BY organization_id, period ORDER BY updated_at DESC) AS rn
  FROM ai_usage_counters
  WHERE provider IS NULL
) ranked
WHERE c.id = ranked.id AND ranked.rn > 1;

-- 2) Bascule de la convention NULL vers la sentinelle '__global__'.
UPDATE ai_usage_quotas SET provider = '__global__' WHERE provider IS NULL;
UPDATE ai_usage_counters SET provider = '__global__' WHERE provider IS NULL;

ALTER TABLE ai_usage_quotas ALTER COLUMN provider SET NOT NULL;
ALTER TABLE ai_usage_quotas ALTER COLUMN provider SET DEFAULT '__global__';
ALTER TABLE ai_usage_counters ALTER COLUMN provider SET NOT NULL;
ALTER TABLE ai_usage_counters ALTER COLUMN provider SET DEFAULT '__global__';

COMMENT ON COLUMN ai_usage_quotas.provider IS
  '''__global__'' = plafond appliqué tous fournisseurs confondus ; sinon nom du fournisseur concret (ex. ''mistral'').';
COMMENT ON COLUMN ai_usage_counters.provider IS
  'Même convention que ai_usage_quotas.provider (''__global__'' = compteur global).';
COMMENT ON COLUMN ai_usage_events.counter_provider IS
  'Clé provider du compteur réservé (''__global__'' ou fournisseur concret) ; NULL si aucun quota n''était configuré au moment de la réservation (aucun compteur maintenu, illimité).';

-- 3) reserve_ai_usage : résolution déterministe (quota spécifique au
--    fournisseur prioritaire sur le quota global), via la sentinelle.
CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_org_id           uuid,
  p_provider         text,
  p_resource_type    text,
  p_estimated_tokens bigint,
  p_user_id          uuid
)
RETURNS TABLE (event_id uuid, allowed boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_period         text := to_char(now(), 'YYYY-MM');
  v_quota_provider text;
  v_limit          bigint;
  v_active         boolean;
  v_updated_rows   int;
  v_event_id       uuid;
BEGIN
  -- Résout le plafond effectif : une ligne spécifique au fournisseur gagne
  -- sur la ligne '__global__' (plafond global tous fournisseurs confondus).
  SELECT provider, monthly_limit_tokens, is_active
    INTO v_quota_provider, v_limit, v_active
  FROM ai_usage_quotas
  WHERE organization_id = p_org_id
    AND provider IN (p_provider, '__global__')
  ORDER BY (provider = p_provider) DESC
  LIMIT 1;

  IF v_limit IS NULL OR v_active IS FALSE THEN
    -- Pas de quota configuré (ou désactivé) pour cette organisation : illimité.
    -- counter_provider reste NULL : aucun compteur n'est maintenu dans ce cas
    -- (l'historique reste néanmoins tracé dans le ledger via cet événement).
    INSERT INTO ai_usage_events (organization_id, provider, counter_provider, resource_type, status, estimated_tokens, period, created_by)
    VALUES (p_org_id, p_provider, NULL, p_resource_type, 'reserved', p_estimated_tokens, v_period, p_user_id)
    RETURNING id INTO v_event_id;
    RETURN QUERY SELECT v_event_id, true, 'no_quota_configured'::text;
    RETURN;
  END IF;

  INSERT INTO ai_usage_counters (organization_id, provider, period)
  VALUES (p_org_id, v_quota_provider, v_period)
  ON CONFLICT (organization_id, provider, period) DO NOTHING;

  UPDATE ai_usage_counters
  SET reserved_tokens = reserved_tokens + p_estimated_tokens,
      updated_at = now()
  WHERE organization_id = p_org_id
    AND provider = v_quota_provider
    AND period = v_period
    AND (used_tokens + reserved_tokens + p_estimated_tokens) <= v_limit;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN QUERY SELECT NULL::uuid, false, 'quota_exceeded'::text;
    RETURN;
  END IF;

  INSERT INTO ai_usage_events (organization_id, provider, counter_provider, resource_type, status, estimated_tokens, period, created_by)
  VALUES (p_org_id, p_provider, v_quota_provider, p_resource_type, 'reserved', p_estimated_tokens, v_period, p_user_id)
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT v_event_id, true, 'ok'::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_ai_usage(uuid, text, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(uuid, text, text, bigint, uuid) TO service_role;

-- settle_ai_usage : conserve IS NOT DISTINCT FROM par robustesse (couvre le
-- cas counter_provider NULL = aucun quota configuré, où aucune ligne de
-- compteur ne doit jamais matcher — c'est le comportement voulu).
CREATE OR REPLACE FUNCTION public.settle_ai_usage(
  p_event_id      uuid,
  p_actual_tokens bigint,
  p_status        text -- 'completed' | 'failed' | 'timeout'
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event ai_usage_events;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'timeout') THEN
    RAISE EXCEPTION 'Invalid settle status: %', p_status;
  END IF;

  UPDATE ai_usage_events
  SET status = p_status,
      actual_tokens = p_actual_tokens,
      settled_at = now()
  WHERE id = p_event_id AND status = 'reserved'
  RETURNING * INTO v_event;

  IF v_event.id IS NULL THEN
    RETURN; -- déjà réglé ou événement inconnu : no-op, pas une erreur
  END IF;

  IF p_status = 'completed' THEN
    UPDATE ai_usage_counters
    SET reserved_tokens = GREATEST(reserved_tokens - v_event.estimated_tokens, 0),
        used_tokens = used_tokens + COALESCE(p_actual_tokens, v_event.estimated_tokens),
        updated_at = now()
    WHERE organization_id = v_event.organization_id
      AND provider IS NOT DISTINCT FROM v_event.counter_provider
      AND period = v_event.period;
  ELSE
    UPDATE ai_usage_counters
    SET reserved_tokens = GREATEST(reserved_tokens - v_event.estimated_tokens, 0),
        updated_at = now()
    WHERE organization_id = v_event.organization_id
      AND provider IS NOT DISTINCT FROM v_event.counter_provider
      AND period = v_event.period;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_ai_usage(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_ai_usage(uuid, bigint, text) TO service_role;
