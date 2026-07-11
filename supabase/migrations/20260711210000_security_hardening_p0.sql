-- Durcissement P0 (advisors Supabase, 2026-07-11).
--
-- 1) search_couriers : CREATE FUNCTION accorde EXECUTE à PUBLIC par défaut — la
--    re-création (bascule UUID) avait réappliqué ce grant, rendant la fonction
--    SECURITY DEFINER appelable par `anon` malgré le REVOKE FROM anon (qui ne
--    retire que le grant direct, pas celui hérité de PUBLIC).
REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer) TO authenticated;

-- 2) st_estimatedextent (postgis, SECURITY DEFINER) : les grants appartiennent à
--    `supabase_admin` (propriétaire de l'extension) — un REVOKE émis par `postgres`
--    est un no-op silencieux. Non corrigeable côté projet : RISQUE ACCEPTÉ et
--    documenté dans docs/security.md (la fonction n'expose que des estimations
--    d'emprise de colonnes géométriques ; seule table concernée : quartiers).

-- 3) portal_form_submissions : RLS activée sans policy = deny-all pour l'API,
--    ce qui est voulu (table interne de rate-limiting, écrite par l'edge function
--    portal-form en service_role). Policy explicite pour documenter l'intention.
CREATE POLICY service_role_full ON public.portal_form_submissions FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE public.portal_form_submissions IS
  'Rate-limiting des soumissions portail. Accès service_role uniquement (edge function portal-form) — aucun accès client par design.';
