-- Fonctions du système de quotas IA : pattern "Reserve -> Call -> Settle".
--
-- reserve_ai_usage : porte de concurrence. Réalise un UPDATE conditionnel
-- unique (reserved_tokens + estimation <= plafond) qui s'appuie sur le verrou
-- ligne pris implicitement par Postgres dès l'évaluation du WHERE — deux
-- transactions concurrentes sur la même ligne se sérialisent automatiquement
-- (comportement MVCC standard, valable dès READ COMMITTED, sans SERIALIZABLE
-- ni advisory lock). Si 0 ligne est affectée, le quota est dépassé : refus
-- sans incrément, sans avoir appelé le fournisseur IA.
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
  -- sur la ligne NULL (plafond global tous fournisseurs confondus).
  SELECT provider, monthly_limit_tokens, is_active
    INTO v_quota_provider, v_limit, v_active
  FROM ai_usage_quotas
  WHERE organization_id = p_org_id
    AND (provider = p_provider OR provider IS NULL)
  ORDER BY provider NULLS LAST
  LIMIT 1;

  IF v_limit IS NULL OR v_active IS FALSE THEN
    -- Pas de quota configuré (ou désactivé) pour cette organisation : illimité.
    -- Permet un déploiement progressif sans casser les organisations existantes.
    -- counter_provider reste NULL : aucun compteur n'est maintenu dans ce cas
    -- (l'historique reste néanmoins tracé dans le ledger via cet événement).
    INSERT INTO ai_usage_events (organization_id, provider, counter_provider, resource_type, status, estimated_tokens, period, created_by)
    VALUES (p_org_id, p_provider, NULL, p_resource_type, 'reserved', p_estimated_tokens, v_period, p_user_id)
    RETURNING id INTO v_event_id;
    RETURN QUERY SELECT v_event_id, true, 'no_quota_configured'::text;
    RETURN;
  END IF;

  -- Le compteur est tenu sous la MÊME clé provider que le plafond effectivement
  -- appliqué (NULL si c'est le plafond global qui s'applique), pour que
  -- l'agrégation reste cohérente avec la limite vérifiée.
  INSERT INTO ai_usage_counters (organization_id, provider, period)
  VALUES (p_org_id, v_quota_provider, v_period)
  ON CONFLICT (organization_id, provider, period) DO NOTHING;

  UPDATE ai_usage_counters
  SET reserved_tokens = reserved_tokens + p_estimated_tokens,
      updated_at = now()
  WHERE organization_id = p_org_id
    AND provider IS NOT DISTINCT FROM v_quota_provider
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

-- settle_ai_usage : règle une réservation. Idempotent — ne transitionne que
-- depuis status='reserved', donc un second appel (ex. retry après un blip
-- réseau sur l'appel de settle lui-même) est un no-op sûr.
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
    -- échec/timeout : libère la réservation sans jamais toucher used_tokens.
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

-- release_stale_ai_reservations : filet de sécurité si un edge function
-- crash après reserve_ai_usage mais avant settle_ai_usage (ex. process tué).
-- FOR UPDATE SKIP LOCKED évite de bloquer sur une ligne en cours de règlement
-- par une requête en vol, et évite que deux exécutions du cron se gênent.
CREATE OR REPLACE FUNCTION public.release_stale_ai_reservations(p_max_age_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_event ai_usage_events;
BEGIN
  FOR v_event IN
    SELECT * FROM ai_usage_events
    WHERE status = 'reserved' AND created_at < now() - (p_max_age_minutes || ' minutes')::interval
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.settle_ai_usage(v_event.id, NULL, 'timeout');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_stale_ai_reservations(int) FROM PUBLIC, anon, authenticated;

-- Planification : balayage toutes les 5 minutes, tâche SQL pure (pas besoin
-- de pg_net/edge function, contrairement aux autres jobs cron du projet qui
-- déclenchent un traitement HTTP).
SELECT cron.schedule(
  'release-stale-ai-reservations-every-5min',
  '*/5 * * * *',
  $$ SELECT public.release_stale_ai_reservations(15); $$
);
