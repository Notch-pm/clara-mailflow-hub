-- prevent_superadmin_escalation (trigger sur users) et rls_auto_enable (event trigger DDL)
-- sont des fonctions de trigger : elles se déclenchent via le mécanisme de trigger,
-- indépendamment du privilège EXECUTE. Aucun rôle ne doit pouvoir les appeler via l'API.
REVOKE EXECUTE ON FUNCTION public.prevent_superadmin_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
