-- Écran « Courrier entrant » du gestionnaire courrier (service courrier).
--
-- 1. `organization_users.is_service_courrier` : profil « gestionnaire courrier »,
--    attribut INDÉPENDANT du rôle (comme `is_signataire`). Donne accès à l'écran ;
--    n'ouvre aucun droit d'écriture supplémentaire (RLS inchangée : `is_editor_of`).
--    Modifiable par un administrateur seulement (policy `admins_update_members`).
-- 2. `courier_analyses.suggested_service_confidence` / `suggested_service_alternatives` :
--    l'IA chiffre sa proposition de service (0–100) et cite jusqu'à deux autres
--    organisations plausibles. NULL / {} pour les analyses antérieures.
-- 3. `mailroom_member_ids(org)` : membres actifs du service courrier. Un agent de
--    service ne lit pas `organization_users` des autres (policy `org_users_select`) ;
--    il en a besoin pour proposer « renvoyer au service courrier » et le notifier.
-- 4. `mailroom_couriers(org, since)` : une ligne légère par courrier entrant non
--    résolu, ou résolu depuis `since`. Le classement en onglets (à qualifier, à
--    valider, à réorienter, en cours, en retard, traités) et le délai (jours ouvrés,
--    fériés) se font côté client (`src/lib/mailroom.ts`, `src/lib/courier-sla.ts`).
--
-- Événements de routage lus ici (courier_events.event_type) :
--   service_changed, service_transferred (existants), courier_routed (routage
--   depuis l'écran, y compris confirmation de l'organisation déjà posée),
--   service_returned (renvoi au service courrier, payload {from, done, todo}),
--   service_reminded (relance, payload {to}).
--
-- Rejouable : IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF EXISTS.

ALTER TABLE public.organization_users
  ADD COLUMN IF NOT EXISTS is_service_courrier boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_users.is_service_courrier IS
  'Profil « gestionnaire courrier » : accès à l''écran Courrier entrant. Indépendant du rôle.';

ALTER TABLE public.courier_analyses
  ADD COLUMN IF NOT EXISTS suggested_service_confidence smallint,
  ADD COLUMN IF NOT EXISTS suggested_service_alternatives uuid[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'courier_analyses_suggested_service_confidence_check'
  ) THEN
    ALTER TABLE public.courier_analyses
      ADD CONSTRAINT courier_analyses_suggested_service_confidence_check
      CHECK (suggested_service_confidence IS NULL OR suggested_service_confidence BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN public.courier_analyses.suggested_service_confidence IS
  'Confiance de l''IA dans la proposition de service (0–100). NULL : analyse antérieure ou pas de proposition.';
COMMENT ON COLUMN public.courier_analyses.suggested_service_alternatives IS
  'Autres organisations plausibles (ids revalidés contre le catalogue), au plus deux.';

-- ─── Membres du service courrier ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mailroom_member_ids(p_organization_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ou.user_id
  FROM organization_users ou
  WHERE ou.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND ou.is_service_courrier
    AND COALESCE(ou.is_active, true);
$function$;

REVOKE EXECUTE ON FUNCTION public.mailroom_member_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mailroom_member_ids(uuid) TO authenticated, service_role;

-- ─── Lignes de l'écran ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mailroom_couriers(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.mailroom_couriers(
  p_organization_id uuid,
  p_since timestamptz DEFAULT (now() - interval '30 days')
)
RETURNS TABLE(
  id uuid,
  chrono text,
  subject text,
  channel text,
  received_at timestamptz,
  created_at timestamptz,
  socle_organization_id uuid,
  assigned_service text,
  workflow_state_id uuid,
  state_is_initial boolean,
  state_category text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  sender_name text,
  analysis_status text,
  has_analysis boolean,
  suggested_socle_organization_id uuid,
  suggested_service_reason text,
  suggested_service_confidence smallint,
  suggested_service_alternatives uuid[],
  first_intent text,
  routed_at timestamptz,
  taken_at timestamptz,
  reminder_count integer,
  last_reminder_at timestamptz,
  returned_from text,
  returned_at timestamptz,
  returned_done text,
  returned_todo text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    c.chrono,
    c.subject,
    c.channel::text,
    c.received_at,
    c.created_at,
    c.socle_organization_id,
    c.assigned_service,
    c.workflow_state_id,
    COALESCE(ws.is_initial, false) AS state_is_initial,
    ws.category::text AS state_category,
    c.acknowledged_at,
    c.resolved_at,
    COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) AS sender_name,
    j.status AS analysis_status,
    (ca.id IS NOT NULL) AS has_analysis,
    ca.suggested_socle_organization_id,
    ca.suggested_service_reason,
    ca.suggested_service_confidence,
    COALESCE(ca.suggested_service_alternatives, '{}'::uuid[]) AS suggested_service_alternatives,
    CASE WHEN jsonb_typeof(ca.intents) = 'array' THEN ca.intents->>0 END AS first_intent,
    CASE WHEN lr.event_type <> 'service_returned' THEN lr.at END AS routed_at,
    tk.at AS taken_at,
    COALESCE(rm.n, 0)::integer AS reminder_count,
    rm.last_at AS last_reminder_at,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'from' END AS returned_from,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.at END AS returned_at,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'done' END AS returned_done,
    CASE WHEN lr.event_type = 'service_returned' THEN lr.payload->>'todo' END AS returned_todo
  FROM couriers c
  LEFT JOIN workflow_states ws ON ws.id = c.workflow_state_id
  LEFT JOIN courier_analyses ca ON ca.courier_id = c.id
  LEFT JOIN LATERAL (
    SELECT cp.first_name, cp.last_name, cp.name, cp.email
    FROM courier_participants cp
    WHERE cp.courier_id = c.id AND cp.role = 'sender'
    ORDER BY cp.id
    LIMIT 1
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT aj.status
    FROM courier_analysis_jobs aj
    WHERE aj.courier_id = c.id
    ORDER BY aj.created_at DESC
    LIMIT 1
  ) j ON true
  LEFT JOIN LATERAL (
    SELECT ce.event_type::text AS event_type, ce.payload, ce.created_at::timestamptz AS at
    FROM courier_events ce
    WHERE ce.courier_id = c.id
      AND ce.event_type IN ('service_changed', 'service_transferred', 'courier_routed', 'service_returned')
    ORDER BY ce.created_at DESC
    LIMIT 1
  ) lr ON true
  LEFT JOIN LATERAL (
    SELECT min(ce.created_at)::timestamptz AS at
    FROM courier_events ce
    WHERE ce.courier_id = c.id
      AND ce.event_type = 'instruction_started'
      AND (lr.at IS NULL OR ce.created_at::timestamptz >= lr.at)
  ) tk ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, max(ce.created_at)::timestamptz AS last_at
    FROM courier_events ce
    WHERE ce.courier_id = c.id
      AND ce.event_type = 'service_reminded'
      AND (lr.at IS NULL OR ce.created_at::timestamptz >= lr.at)
  ) rm ON true
  WHERE c.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND c.direction = 'inbound'
    AND (c.resolved_at IS NULL OR c.resolved_at >= p_since)
  ORDER BY COALESCE(c.received_at, c.created_at) DESC, c.id DESC
  LIMIT 8000;
$function$;

REVOKE EXECUTE ON FUNCTION public.mailroom_couriers(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mailroom_couriers(uuid, timestamptz) TO authenticated, service_role;
