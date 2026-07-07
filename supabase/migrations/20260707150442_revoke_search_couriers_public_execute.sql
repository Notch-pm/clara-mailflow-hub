-- Retire l'EXECUTE hérité de PUBLIC (source de l'accès anon). authenticated et
-- service_role conservent leur grant explicite.
REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, text, text, text[], date, date, integer, integer) FROM PUBLIC, anon;
