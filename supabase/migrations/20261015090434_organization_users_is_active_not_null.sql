-- organization_users.is_active : NOT NULL (dette P1.8).
--
-- Les helpers RLS (`is_member_of`, `is_admin_of`, `is_editor_of`, …) lisaient
-- `COALESCE(is_active, true)` — NULL = actif — quand les gardes des edge
-- functions filtrent `.eq("is_active", true)` — NULL = inactif. Un membre à
-- NULL passait donc la RLS mais était refusé par les edge functions. Aucune
-- ligne n'était à NULL au 2026-10-15 (26 sur 26 renseignées, défaut `true`) :
-- on ferme la question à la source. Les COALESCE restants deviennent inertes ;
-- ils ne sont pas réécrits (re-créer ces fonctions re-poserait le grant PUBLIC).

UPDATE public.organization_users SET is_active = true WHERE is_active IS NULL;

ALTER TABLE public.organization_users
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;
