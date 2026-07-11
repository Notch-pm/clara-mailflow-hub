-- Inventaire RLS : tables exposées × policies × rôles × expressions.
-- Usage : exécuter via MCP execute_sql ou psql, revoir table par table
-- (chaque table métier doit avoir : select is_member_of, écritures is_admin_of
--  ou is_member_of selon le domaine, service_role_full pour les edge functions).
SELECT
  c.relname                                        AS table_name,
  c.relrowsecurity                                 AS rls_enabled,
  p.polname                                        AS policy,
  CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                WHEN '*' THEN 'ALL' END            AS command,
  ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)) AS roles,
  pg_get_expr(p.polqual, p.polrelid)               AS using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid)          AS check_expr
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname, p.polname;
